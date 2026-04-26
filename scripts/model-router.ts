/**
 * Model Router — Central request router between cheap and strong models
 * with escalation heuristics based on confidence, response length,
 * and uncertainty detection.
 *
 * Cheap model:  Qwen3.6-35B-A3B via llama.cpp (OpenAI-compatible API)
 * Strong model: glm-5-turbo via ZAI API (OpenAI-compatible API)
 *
 * Both models use the openai npm package. No Ollama dependency.
 */

import { resolve } from "path";
import { existsSync, readFileSync } from "fs";
import OpenAI from "openai";

// ─── Types ──────────────────────────────────────────────────────────────────

type ModelTier = "cheap" | "strong";

interface RoutingDecision {
  finalModel: ModelTier;
  escalated: boolean;
  confidenceScore: number;       // 0-10
  heuristics: {
    shortResponse: boolean;       // длина < 30 символов
    uncertaintyDetected: boolean; // фразы неуверенности
    lowConfidence: boolean;       // score < 5
    errorOccurred: boolean;       // ошибка модели
  };
  escalationReason: string;
}

interface ModelResponse {
  content: string;
  model: string;
  tier: ModelTier;
  latencyMs: number;
  confidenceScore: number;
}

interface ModelRouterConfig {
  cheapBaseUrl?: string;      // default: "http://127.0.0.1:8080/v1"
  cheapApiKey?: string;       // default: "llama-cpp" (not validated by llama.cpp)
  cheapModel?: string;        // default: "model"
  cheapTimeout?: number;      // default: 120000

  strongBaseUrl?: string;     // default: "https://api.z.ai/api/coding/paas/v4"
  strongApiKey?: string;      // default: process.env.GLM_API_KEY
  strongModel?: string;       // default: "glm-5-turbo"
  strongTimeout?: number;     // default: 60000

  minResponseLength?: number; // default: 30
  minConfidence?: number;     // default: 5
  systemPrompt?: string;      // default: CONFIDENCE_SYSTEM_PROMPT
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_CHEAP_SYSTEM_PROMPT =
  "Ты полезный AI-ассистент. Отвечай на вопросы по-русски чётко и по существу.\n" +
  "После ответа, на отдельной строке, напиши: CONFIDENCE: <число от 1 до 10>\n" +
  "Где 1 — ты совершенно не уверен, 10 — абсолютно уверен.";

const STRONG_SYSTEM_PROMPT =
  "Ты опытный AI-ассистент. Отвечай на вопросы по-русски подробно и точно.";

// ─── Module-level functions ─────────────────────────────────────────────────

function extractConfidence(text: string): number {
  const patterns = [
    /CONFIDENCE:\s*(-?\d+(?:\.\d+)?)/i,
    /увереност[ьи]:\s*(-?\d+(?:\.\d+)?)/i,
    /confidence\s*[:=]\s*(-?\d+(?:\.\d+)?)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return Math.min(10, Math.max(0, Math.abs(Number(m[1]))));
  }
  return 5; // default
}

function stripConfidenceLine(text: string): string {
  return text
    .replace(
      /\n?(?:CONFIDENCE|увереност[ьи])\s*[:=]\s*-?\d+(?:\.\d+)?(?:\/\d+)?\s*$/i,
      "",
    )
    .trim();
}

function detectUncertainty(text: string): boolean {
  const patterns = [
    /не уверен/i,
    /не знаю/i,
    /трудно сказать/i,
    /могу ошибаться/i,
    /вероятно/i,
    /возможно/i,
    /не могу точно/i,
    /точный ответ/i,
    /нельзя точно сказать/i,
    /не хватает данных/i,
    /недостаточно информации/i,
    /не имеет однозначного/i,
    /зависит от контекста/i,
    /I'?m not sure/i,
    /I don'?t know/i,
    /uncertain/i,
  ];
  return patterns.some((p) => p.test(text));
}

// ─── ModelRouter ────────────────────────────────────────────────────────────

class ModelRouter {
  private readonly cheapClient: OpenAI;
  private readonly strongClient: OpenAI;
  private readonly config: Required<ModelRouterConfig>;

  constructor(config?: ModelRouterConfig) {
    this.loadEnvIfNeeded();

    const strongApiKey = config?.strongApiKey ?? process.env.GLM_API_KEY;
    if (!strongApiKey) {
      throw new Error(
        "GLM_API_KEY not set. Add it to .env or pass in config.",
      );
    }

    this.config = {
      cheapBaseUrl:
        config?.cheapBaseUrl ??
        `http://127.0.0.1:${process.env.LLAMA_SERVER_PORT ?? "8080"}/v1`,
      cheapApiKey: config?.cheapApiKey ?? "llama-cpp",
      cheapModel: config?.cheapModel ?? "model",
      cheapTimeout: config?.cheapTimeout ?? 120_000,
      strongBaseUrl:
        config?.strongBaseUrl ?? "https://api.z.ai/api/coding/paas/v4",
      strongApiKey: strongApiKey,
      strongModel: config?.strongModel ?? "glm-5-turbo",
      strongTimeout: config?.strongTimeout ?? 60_000,
      minResponseLength: config?.minResponseLength ?? 30,
      minConfidence: config?.minConfidence ?? 5,
      systemPrompt: config?.systemPrompt ?? DEFAULT_CHEAP_SYSTEM_PROMPT,
    };

    this.cheapClient = new OpenAI({
      baseURL: this.config.cheapBaseUrl,
      apiKey: this.config.cheapApiKey,
      timeout: this.config.cheapTimeout,
    });

    this.strongClient = new OpenAI({
      baseURL: this.config.strongBaseUrl,
      apiKey: this.config.strongApiKey,
      timeout: this.config.strongTimeout,
    });
  }

  // ── Main routing method: cheap → evaluate → optional strong ───────────

  async route(
    prompt: string,
  ): Promise<{
    response: ModelResponse;
    decision: RoutingDecision;
    cheapResponse?: ModelResponse;
  }> {
    // 1. Query cheap model
    let cheapResponse: ModelResponse;
    try {
      const start = Date.now();
      const completion = await this.cheapClient.chat.completions.create({
        model: this.config.cheapModel,
        messages: [
          { role: "system", content: this.config.systemPrompt },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 2048,
      });
      const content = completion.choices[0]?.message?.content ?? "";
      cheapResponse = {
        content,
        model: completion.model,
        tier: "cheap",
        latencyMs: Date.now() - start,
        confidenceScore: extractConfidence(content),
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorDecision: RoutingDecision = {
        finalModel: "strong",
        escalated: true,
        confidenceScore: 0,
        heuristics: {
          shortResponse: false,
          uncertaintyDetected: false,
          lowConfidence: false,
          errorOccurred: true,
        },
        escalationReason: `ошибка cheap model: ${errorMsg}`,
      };
      const strongResponse = await this.queryStrong(prompt);
      return { response: strongResponse, decision: errorDecision };
    }

    // 2. Evaluate heuristics
    const decision = this.evaluateHeuristics(cheapResponse.content);

    // 3. No escalation needed — return cheap response (stripped)
    if (!decision.escalated) {
      const finalResponse: ModelResponse = {
        ...cheapResponse,
        content: stripConfidenceLine(cheapResponse.content),
      };
      return { response: finalResponse, decision, cheapResponse };
    }

    // 4. Escalate to strong model
    const strongResponse = await this.queryStrong(prompt);
    return { response: strongResponse, decision, cheapResponse };
  }

  // ── Query strong model (ZAI glm-5-turbo) ──────────────────────────────

  async queryStrong(prompt: string): Promise<ModelResponse> {
    const start = Date.now();
    const completion = await this.strongClient.chat.completions.create({
      model: this.config.strongModel,
      messages: [
        { role: "system", content: STRONG_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 4096,
    });
    return {
      content: completion.choices[0]?.message?.content ?? "",
      model: completion.model,
      tier: "strong",
      latencyMs: Date.now() - start,
      confidenceScore: 10, // remote model — assumed confident
    };
  }

  // ── Evaluate heuristics on a response ──────────────────────────────────

  evaluateHeuristics(response: string): RoutingDecision {
    const confidence = extractConfidence(response);
    const cleanResponse = stripConfidenceLine(response);
    const shortResponse = cleanResponse.length < this.config.minResponseLength;
    const uncertainty = detectUncertainty(cleanResponse);
    const lowConfidence = confidence < this.config.minConfidence;

    const shouldEscalate = shortResponse || uncertainty || lowConfidence;

    const reasons: string[] = [];
    if (shortResponse) {
      reasons.push(`ответ слишком короткий (${cleanResponse.length} символов)`);
    }
    if (uncertainty) {
      reasons.push("обнаружена неуверенность в тексте");
    }
    if (lowConfidence) {
      reasons.push(`низкий confidence score (${confidence}/10)`);
    }

    return {
      finalModel: shouldEscalate ? "strong" : "cheap",
      escalated: shouldEscalate,
      confidenceScore: confidence,
      heuristics: {
        shortResponse,
        uncertaintyDetected: uncertainty,
        lowConfidence,
        errorOccurred: false,
      },
      escalationReason: reasons.length > 0 ? reasons.join("; ") : "none",
    };
  }

  // ── Health check for both models ───────────────────────────────────────

  async healthCheck(): Promise<{ cheap: boolean; strong: boolean }> {
    let cheap = false;
    let strong = false;

    try {
      const port = process.env.LLAMA_SERVER_PORT ?? "8080";
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      cheap = res.ok;
    } catch {
      cheap = false;
    }

    try {
      await this.strongClient.chat.completions.create({
        model: this.config.strongModel,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
      });
      strong = true;
    } catch {
      strong = false;
    }

    return { cheap, strong };
  }

  // ── Load .env file if not already loaded ───────────────────────────────

  private loadEnvIfNeeded(): void {
    try {
      const envPath = resolve(process.cwd(), ".env");
      if (!existsSync(envPath)) return;
      const content = readFileSync(envPath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx <= 0) continue;
        const key = trimmed.substring(0, eqIdx).trim();
        const val = trimmed.substring(eqIdx + 1).trim();
        if (process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
    } catch {
      /* ignore */
    }
  }
}

// ─── Exports ────────────────────────────────────────────────────────────────

export { ModelRouter };
export type { ModelTier, RoutingDecision, ModelResponse, ModelRouterConfig };
export { extractConfidence, stripConfidenceLine, detectUncertainty };

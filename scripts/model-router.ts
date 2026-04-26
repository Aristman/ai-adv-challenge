/**
 * Model Router — Central request router between cheap and strong models
 * with escalation heuristics based on confidence, response length,
 * and uncertainty detection.
 *
 * Cheap model:  Qwen3.6-35B-A3B via llama.cpp (OpenAI-compatible API on port 8081)
 * Strong model: phi4:14b via Ollama (native Ollama API on port 11434)
 */

import OpenAI from "openai";
import { OllamaClient } from "./ollama-client";

// ─── Types ──────────────────────────────────────────────────────────────────

type ModelTier = "cheap" | "strong" | "remote";

interface RoutingDecision {
  finalModel: ModelTier;
  escalated: boolean;
  confidenceScore: number;       // 0-10 from model response
  heuristics: {
    shortResponse: boolean;       // response < minResponseLength chars
    uncertaintyDetected: boolean; // uncertainty phrases found
    lowConfidence: boolean;       // explicit confidence < threshold
    errorOccurred: boolean;       // model error
  };
  escalationReason: string;       // why escalated (or "none")
}

interface ModelResponse {
  content: string;
  model: string;
  tier: ModelTier;
  latencyMs: number;
  confidenceScore: number;
}

interface ModelRouterConfig {
  // Cheap model (llama.cpp)
  cheapBaseUrl?: string;      // default: "http://127.0.0.1:8081/v1"
  cheapModel?: string;        // default: "model" (llama.cpp uses filename)
  cheapTimeout?: number;      // default: 120000 (large model, slow)

  // Strong model (Ollama)
  strongBaseUrl?: string;     // default: "http://localhost:11434"
  strongModel?: string;       // default: "phi4:14b"
  strongTimeout?: number;     // default: 60000

  // Heuristics thresholds
  minResponseLength?: number;     // default: 30
  minConfidence?: number;         // default: 5 (out of 10)
  confidenceExtraction?: boolean; // default: true
}

// ─── Constants ──────────────────────────────────────────────────────────────

const CHEAP_SYSTEM_PROMPT =
  "Ты полезный AI-ассистент. Отвечай на вопросы по-русски.\n" +
  "После ответа, на отдельной строке, напиши: CONFIDENCE: <число от 1 до 10>\n" +
  "Где 1 — ты совершенно не уверен, 10 — абсолютно уверен.";

const STRONG_SYSTEM_PROMPT =
  "Ты полезный AI-ассистент. Отвечай на вопросы по-русски подробно и точно.";

const UNCERTAINTY_PATTERNS: readonly RegExp[] = [
  /не уверен/i,
  /не знаю/i,
  /трудно сказать/i,
  /могу ошибаться/i,
  /вероятно/i,
  /возможно/i,
  /I'm not sure/i,
  /I don't know/i,
  /uncertain/i,
  /не могу точно/i,
  /точный ответ/i,
  /нельзя точно сказать/i,
  /не хватает данных/i,
  /недостаточно информации/i,
  /не имеет однозначного/i,
  /зависит от контекста/i,
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractConfidence(text: string): number {
  const patterns: readonly RegExp[] = [
    /CONFIDENCE:\s*(\d+(?:\.\d+)?)/i,
    /уверенност[ьи]:\s*(\d+(?:\.\d+)?)/i,
    /confidence\s*[:=]\s*(\d+(?:\.\d+)?)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return Math.min(10, Math.max(0, Number(match[1])));
    }
  }
  return 5; // default — average confidence if not found
}

function stripConfidenceLine(text: string): string {
  return text
    .replace(
      /\n?(?:CONFIDENCE|уверенност[ьи])\s*[:=]\s*\d+(?:\.\d+)?(?:\/\d+)?\s*$/i,
      "",
    )
    .trim();
}

function detectUncertainty(text: string): boolean {
  return UNCERTAINTY_PATTERNS.some((pattern) => pattern.test(text));
}

// ─── ModelRouter ────────────────────────────────────────────────────────────

class ModelRouter {
  private readonly config: Required<ModelRouterConfig>;
  private readonly cheapClient: OpenAI;
  private readonly strongClient: OllamaClient;

  constructor(config?: ModelRouterConfig) {
    this.config = {
      cheapBaseUrl: config?.cheapBaseUrl ?? "http://127.0.0.1:8081/v1",
      cheapModel: config?.cheapModel ?? "model",
      cheapTimeout: config?.cheapTimeout ?? 120_000,
      strongBaseUrl: config?.strongBaseUrl ?? "http://localhost:11434",
      strongModel: config?.strongModel ?? "phi4:14b",
      strongTimeout: config?.strongTimeout ?? 60_000,
      minResponseLength: config?.minResponseLength ?? 30,
      minConfidence: config?.minConfidence ?? 5,
      confidenceExtraction: config?.confidenceExtraction ?? true,
    };

    this.cheapClient = new OpenAI({
      baseURL: this.config.cheapBaseUrl,
      apiKey: "llama-cpp", // llama.cpp doesn't validate key, but field is required
      timeout: this.config.cheapTimeout,
    });

    this.strongClient = new OllamaClient({
      baseUrl: this.config.strongBaseUrl,
      model: this.config.strongModel,
      timeout: this.config.strongTimeout,
    });
  }

  // ── Main routing method ────────────────────────────────────────────────

  async route(
    prompt: string,
  ): Promise<{ response: ModelResponse; decision: RoutingDecision }> {
    // Step 1: Query cheap model
    const cheapResponse = await this.queryCheap(prompt);

    // Step 2: Evaluate heuristics on cheap response
    const decision = this.evaluateHeuristics(cheapResponse.content);

    // Step 3: If escalation needed, query strong model
    if (decision.escalated) {
      console.info(
        `[router] Escalating to strong model. Reason: ${decision.escalationReason}`,
      );

      const strongResponse = await this.queryStrong(prompt);

      const finalResponse: ModelResponse = {
        content: strongResponse.content,
        model: strongResponse.model,
        tier: "strong",
        latencyMs: cheapResponse.latencyMs + strongResponse.latencyMs,
        confidenceScore: strongResponse.confidenceScore,
      };

      return { response: finalResponse, decision };
    }

    return { response: cheapResponse, decision };
  }

  // ── Escalation to strong model ─────────────────────────────────────────

  async escalateToStrong(prompt: string): Promise<ModelResponse> {
    return this.queryStrong(prompt);
  }

  // ── Health check for both models ───────────────────────────────────────

  async healthCheck(): Promise<{ cheap: boolean; strong: boolean }> {
    let cheap = false;
    let strong = false;

    // Check cheap model (llama.cpp /v1/models endpoint)
    try {
      const res = await fetch(`${this.config.cheapBaseUrl.replace(/\/v1$/, "")}/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      cheap = res.ok;
    } catch {
      cheap = false;
    }

    // Check strong model (Ollama /api/tags)
    strong = await this.strongClient.healthCheck();

    return { cheap, strong };
  }

  // ── Evaluate heuristics on a response ──────────────────────────────────

  evaluateHeuristics(response: string): RoutingDecision {
    const confidence = this.config.confidenceExtraction
      ? extractConfidence(response)
      : 5;
    const cleanResponse = stripConfidenceLine(response);
    const shortResponse =
      cleanResponse.length < this.config.minResponseLength;
    const uncertainty = detectUncertainty(cleanResponse);
    const lowConfidence = confidence < this.config.minConfidence;

    // Decision: escalate if any heuristic triggers
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

  // ── Private: query cheap model via OpenAI-compatible API ───────────────

  private async queryCheap(prompt: string): Promise<ModelResponse> {
    const startMs = Date.now();

    console.info(
      `[router] Querying cheap model (${this.config.cheapModel}) via llama.cpp...`,
    );

    try {
      const completion = await this.cheapClient.chat.completions.create({
        model: this.config.cheapModel,
        messages: [
          { role: "system", content: CHEAP_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 2048,
      });

      const latencyMs = Date.now() - startMs;
      const rawContent = completion.choices[0]?.message?.content ?? "";
      const confidence = extractConfidence(rawContent);

      console.info(
        `[router] Cheap model responded in ${latencyMs}ms, confidence=${confidence}`,
      );

      return {
        content: rawContent,
        model: this.config.cheapModel,
        tier: "cheap",
        latencyMs,
        confidenceScore: confidence,
      };
    } catch (err) {
      const latencyMs = Date.now() - startMs;
      const errorMsg =
        err instanceof Error ? err.message : String(err);

      console.error(`[router] Cheap model error (${latencyMs}ms): ${errorMsg}`);

      // Return error response — heuristics will trigger escalation
      return {
        content: "",
        model: this.config.cheapModel,
        tier: "cheap",
        latencyMs,
        confidenceScore: 0,
      };
    }
  }

  // ── Private: query strong model via Ollama ─────────────────────────────

  private async queryStrong(prompt: string): Promise<ModelResponse> {
    const startMs = Date.now();

    console.info(
      `[router] Querying strong model (${this.config.strongModel}) via Ollama...`,
    );

    try {
      const ollamaResponse = await this.strongClient.chat([
        { role: "system", content: STRONG_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ]);

      const latencyMs = Date.now() - startMs;
      const content = ollamaResponse.message.content;

      console.info(
        `[router] Strong model responded in ${latencyMs}ms`,
      );

      return {
        content,
        model: ollamaResponse.model,
        tier: "strong",
        latencyMs,
        confidenceScore: 7, // default for strong model responses (no extraction)
      };
    } catch (err) {
      const latencyMs = Date.now() - startMs;
      const errorMsg =
        err instanceof Error ? err.message : String(err);

      console.error(`[router] Strong model error (${latencyMs}ms): ${errorMsg}`);

      return {
        content: `[Ошибка strong model: ${errorMsg}]`,
        model: this.config.strongModel,
        tier: "strong",
        latencyMs,
        confidenceScore: 0,
      };
    }
  }
}

// ─── Demo ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-require-imports
if (require.main === module) {
  (async () => {
    const router = new ModelRouter();

    console.info("Running health check...");
    const health = await router.healthCheck();
    console.info(`Cheap: ${health.cheap}, Strong: ${health.strong}`);

    if (!health.cheap && !health.strong) {
      console.error("No models available. Exiting.");
      process.exit(1);
    }

    console.info("\n--- Test query ---");
    const result = await router.route("Сколько будет 2 + 2?");

    console.info(`\nEscalated: ${result.decision.escalated}`);
    console.info(`Confidence: ${result.decision.confidenceScore}`);
    console.info(`Reason: ${result.decision.escalationReason}`);
    console.info(`Response (${result.response.tier}, ${result.response.latencyMs}ms):`);
    console.info(result.response.content);
  })();
}

export {
  ModelRouter,
  extractConfidence,
  stripConfidenceLine,
  detectUncertainty,
};
export type {
  ModelTier,
  RoutingDecision,
  ModelResponse,
  ModelRouterConfig,
};

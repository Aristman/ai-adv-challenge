/**
 * run-routing-test.ts — Full routing test pipeline
 *
 * 1. Reads .env (if exists)
 * 2. Starts llama-server via LlamaServerManager
 * 3. Checks Ollama health
 * 4. Creates ModelRouter
 * 5. Loads data/routing-testset.jsonl (30 examples)
 * 6. Routes each prompt, collects metrics
 * 7. Outputs results/routing-results.jsonl + results/routing-summary.json
 * 8. Prints console summary table
 * 9. Stops llama-server
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import OpenAI from "openai";
import { LlamaServerManager } from "./llama-server-manager";
import { OllamaClient } from "./ollama-client";
import { ModelRouter } from "./model-router";
import type { RoutingDecision, ModelResponse, ModelTier } from "./model-router";

// ─── Types ──────────────────────────────────────────────────────────────────

interface TestExample {
  id: number;
  category: string;
  prompt: string;
  expected_route: string;
  expected_keywords: string[];
  description: string;
}

interface RoutingResult {
  id: number;
  category: string;
  prompt: string;
  expectedRoute: string;
  actualRoute: ModelTier;
  escalated: boolean;
  decision: RoutingDecision;
  cheapResponse: ModelResponse;
  strongResponse: ModelResponse | null;
  matchedKeywords: string[];
  totalLatencyMs: number;
}

interface JsonlRow {
  id: number;
  category: string;
  prompt: string;
  expected_route: string;
  actual_route: ModelTier;
  escalated: boolean;
  confidence_score: number;
  cheap_response: string | null;
  strong_response: string | null;
  escalation_reason: string;
  matched_keywords: string[];
  cheap_latency_ms: number;
  strong_latency_ms: number;
  total_latency_ms: number;
}

interface RoutingSummary {
  timestamp: string;
  total_queries: number;
  model_config: {
    cheap: string;
    strong: string;
  };
  routing_metrics: {
    cheap_count: number;
    escalated_count: number;
    escalation_rate: number;
    correct_routing: number;
    routing_accuracy: number;
    accuracy_by_category: Record<string, number>;
  };
  quality_metrics: {
    keyword_match_rate: number;
    keyword_match_by_category: Record<string, number>;
    avg_confidence_cheap: number;
    avg_confidence_strong: number;
  };
  latency_metrics: {
    avg_cheap_ms: number;
    avg_escalated_ms: number;
    avg_total_ms: number;
    p50_ms: number;
    p95_ms: number;
  };
  heuristics_breakdown: {
    escalation_reasons: {
      short_response: number;
      uncertainty_detected: number;
      low_confidence: number;
      error_occurred: number;
    };
  };
}

// ─── Constants ──────────────────────────────────────────────────────────────

const CHEAP_SYSTEM_PROMPT =
  "Ты полезный AI-ассистент. Отвечай на вопросы по-русски.\n" +
  "После ответа, на отдельной строке, напиши: CONFIDENCE: <число от 1 до 10>\n" +
  "Где 1 — ты совершенно не уверен, 10 — абсолютно уверен.";

const STRONG_SYSTEM_PROMPT =
  "Ты полезный AI-ассистент. Отвечай на вопросы по-русски подробно и точно.";

const REQUEST_DELAY_MS = 2_000;

// ─── Helpers ────────────────────────────────────────────────────────────────

function loadEnv(): void {
  const envPath = resolve(process.cwd(), ".env");
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const eqIndex = trimmed.indexOf("=");
        if (eqIndex > 0) {
          const key = trimmed.substring(0, eqIndex).trim();
          const value = trimmed.substring(eqIndex + 1).trim();
          if (process.env[key] === undefined) {
            process.env[key] = value;
          }
        }
      }
    }
  }
}

function readJsonl<T>(filePath: string): T[] {
  const content = readFileSync(filePath, "utf-8");
  const lines = content
    .split("\n")
    .filter((line) => line.trim().length > 0);
  return lines.map((line) => JSON.parse(line) as T);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findMatchedKeywords(
  keywords: readonly string[],
  text: string,
): string[] {
  const lower = text.toLowerCase();
  return keywords.filter((kw) => lower.includes(kw.toLowerCase()));
}

function padEnd(s: string, len: number): string {
  return s.length >= len ? s : s + " ".repeat(len - s.length);
}

function padStartStr(s: string, len: number): string {
  return s.length >= len ? s : " ".repeat(len - s.length) + s;
}

function formatSec(ms: number): string {
  return (ms / 1000).toFixed(1) + "s";
}

function formatPct(numerator: number, denominator: number): string {
  if (denominator === 0) return "N/A";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.info("=== Model Routing Test ===\n");

  // 1. Load .env
  loadEnv();

  // 2. Start llama-server
  const llamaPort = process.env.LLAMA_SERVER_PORT
    ? Number(process.env.LLAMA_SERVER_PORT)
    : 8081;

  const llamaManager = new LlamaServerManager({ port: llamaPort });
  console.info("[test] Starting llama-server...");
  try {
    await llamaManager.start();
    console.info("[test] llama-server is running.\n");
  } catch (err) {
    console.error(
      `[test] Failed to start llama-server: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
  try {
  // 3. Check Ollama health
  console.info("[test] Checking Ollama health...");
  const ollamaClient = new OllamaClient();
  const ollamaHealthy = await ollamaClient.healthCheck();
  if (!ollamaHealthy) {
    console.error("[test] Ollama is not available. Exiting.");
    process.exit(1);
  }
  console.info("[test] Ollama is healthy.\n");

  // 4. Create ModelRouter (used for evaluateHeuristics)
  const router = new ModelRouter({
    cheapBaseUrl: `http://127.0.0.1:${llamaPort}/v1`,
    cheapModel: "model",
    cheapTimeout: 120_000,
  });

  // Create a separate cheap client for direct llama.cpp calls
  const cheapOpenAIClient = new OpenAI({
    baseURL: `http://127.0.0.1:${llamaPort}/v1`,
    apiKey: "llama-cpp",
    timeout: 120_000,
  });

  // 5. Load test dataset
  const datasetPath = resolve(process.cwd(), "data/routing-testset.jsonl");
  if (!existsSync(datasetPath)) {
    console.error(`[test] Dataset not found: ${datasetPath}`);
    process.exit(1);
  }
  const examples = readJsonl<TestExample>(datasetPath);
  console.info(`[test] Loaded ${examples.length} test examples.\n`);

  // 6. Run routing for each example
  const results: RoutingResult[] = [];
  const total = examples.length;

  for (let i = 0; i < total; i++) {
    const example = examples[i];
    const num = i + 1;
    const prefix = `[${String(num).padStart(2, " ")}/${total}]`;

    try {
      // Step A: Query cheap model (llama.cpp via OpenAI-compatible API)
      const cheapStartMs = Date.now();
      const cheapCompletion = await cheapOpenAIClient.chat.completions.create({
        model: "model",
        messages: [
          { role: "system", content: CHEAP_SYSTEM_PROMPT },
          { role: "user", content: example.prompt },
        ],
        temperature: 0.3,
        max_tokens: 2048,
      });
      const cheapLatencyMs = Date.now() - cheapStartMs;
      const cheapContent =
        cheapCompletion.choices[0]?.message?.content ?? "";

      const cheapResponse: ModelResponse = {
        content: cheapContent,
        model: "model",
        tier: "cheap",
        latencyMs: cheapLatencyMs,
        confidenceScore: 0, // will be set by evaluateHeuristics
      };

      // Step B: Evaluate heuristics
      const decision = router.evaluateHeuristics(cheapContent);
      cheapResponse.confidenceScore = decision.confidenceScore;

      // Step C: If escalation needed, query strong model (Ollama)
      let strongResponse: ModelResponse | null = null;
      let finalTier: ModelTier = "cheap";

      if (decision.escalated) {
        console.info(
          `[router] Escalating #${num}: ${decision.escalationReason}`,
        );

        const strongStartMs = Date.now();
        const strongRes = await ollamaClient.chat([
          { role: "system", content: STRONG_SYSTEM_PROMPT },
          { role: "user", content: example.prompt },
        ]);
        const strongLatencyMs = Date.now() - strongStartMs;

        strongResponse = {
          content: strongRes.message.content,
          model: strongRes.model,
          tier: "strong",
          latencyMs: strongLatencyMs,
          confidenceScore: 7,
        };
        finalTier = "strong";
      }

      // Step D: Check keyword matches against the final response
      const finalContent = strongResponse?.content ?? cheapContent;
      const matchedKeywords = findMatchedKeywords(
        example.expected_keywords,
        finalContent,
      );

      // Build result
      const result: RoutingResult = {
        id: example.id,
        category: example.category,
        prompt: example.prompt,
        expectedRoute: example.expected_route,
        actualRoute: finalTier,
        escalated: decision.escalated,
        decision,
        cheapResponse,
        strongResponse,
        matchedKeywords,
        totalLatencyMs: cheapLatencyMs + (strongResponse?.latencyMs ?? 0),
      };
      results.push(result);

      // Progress output
      const matched = result.actualRoute === result.expectedRoute;
      const checkMark = matched ? "✓" : "✗";
      const escSymbol = result.escalated ? "↑" : " ";
      const routeStr = result.escalated ? "strong" : "cheap";
      const truncPrompt =
        example.prompt.length > 45
          ? example.prompt.substring(0, 45) + "..."
          : example.prompt;

      console.info(
        `${prefix} ${padEnd(example.category, 6)} → ${padEnd(routeStr, 6)} ${checkMark}${escSymbol} conf=${decision.confidenceScore} ${padStartStr(formatSec(result.totalLatencyMs), 6)}  "${truncPrompt}"`,
      );

      if (result.escalated && decision.escalationReason !== "none") {
        console.info(
          `         (эскалация: ${decision.escalationReason})`,
        );
      }
    } catch (err) {
      console.error(
        `${prefix} ERROR: ${err instanceof Error ? err.message : String(err)}`,
      );

      results.push({
        id: example.id,
        category: example.category,
        prompt: example.prompt,
        expectedRoute: example.expected_route,
        actualRoute: "cheap",
        escalated: false,
        decision: {
          finalModel: "cheap",
          escalated: false,
          confidenceScore: 0,
          heuristics: {
            shortResponse: false,
            uncertaintyDetected: false,
            lowConfidence: false,
            errorOccurred: true,
          },
          escalationReason: "error_occurred",
        },
        cheapResponse: {
          content: "",
          model: "model",
          tier: "cheap",
          latencyMs: 0,
          confidenceScore: 0,
        },
        strongResponse: null,
        matchedKeywords: [],
        totalLatencyMs: 0,
      });
    }

    // Rate limiting between requests
    if (i < total - 1) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  // 7. Build and display summary
  console.info("\n--- Collecting metrics ---\n");
  const summary = buildSummary(results);
  printSummaryTable(summary);

  // 8. Save results to disk
  const resultsDir = resolve(process.cwd(), "results");
  if (!existsSync(resultsDir)) {
    mkdirSync(resultsDir, { recursive: true });
  }

  const jsonlRows: JsonlRow[] = results.map((r) => ({
    id: r.id,
    category: r.category,
    prompt: r.prompt,
    expected_route: r.expectedRoute,
    actual_route: r.actualRoute,
    escalated: r.escalated,
    confidence_score: r.decision.confidenceScore,
    cheap_response: r.cheapResponse.content || null,
    strong_response: r.strongResponse?.content ?? null,
    escalation_reason: r.decision.escalationReason,
    matched_keywords: r.matchedKeywords,
    cheap_latency_ms: r.cheapResponse.latencyMs,
    strong_latency_ms: r.strongResponse?.latencyMs ?? 0,
    total_latency_ms: r.totalLatencyMs,
  }));

  const jsonlPath = resolve(resultsDir, "routing-results.jsonl");
  writeFileSync(
    jsonlPath,
    jsonlRows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    "utf-8",
  );
  console.info(`[test] Results saved to ${jsonlPath}`);

  const summaryPath = resolve(resultsDir, "routing-summary.json");
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf-8");
  console.info(`[test] Summary saved to ${summaryPath}\n`);

  } finally {
    console.info("[test] Stopping llama-server...");
    await llamaManager.stop();
  }
  console.info("[test] Done.");
}

// ─── Summary builder ────────────────────────────────────────────────────────

function buildSummary(results: readonly RoutingResult[]): RoutingSummary {
  const total = results.length;
  const cheapResults = results.filter((r) => !r.escalated);
  const escalatedResults = results.filter((r) => r.escalated);

  // Routing accuracy
  const correctRouting = results.filter(
    (r) => r.actualRoute === r.expectedRoute,
  ).length;

  // Per-category breakdown
  const categories = ["easy", "medium", "hard"] as const;
  const accuracyByCategory: Record<string, number> = {};
  const keywordMatchByCategory: Record<string, number> = {};

  for (const cat of categories) {
    const catResults = results.filter((r) => r.category === cat);
    const catCount = catResults.length;
    if (catCount === 0) {
      accuracyByCategory[cat] = 0;
      keywordMatchByCategory[cat] = 0;
      continue;
    }

    accuracyByCategory[cat] =
      catResults.filter((r) => r.actualRoute === r.expectedRoute).length /
      catCount;
    keywordMatchByCategory[cat] =
      catResults.filter((r) => r.matchedKeywords.length > 0).length /
      catCount;
  }

  // Keyword match rate (overall)
  const totalKeywordMatch = results.filter(
    (r) => r.matchedKeywords.length > 0,
  ).length;

  // Confidence averages
  const cheapConfidences = cheapResults.map(
    (r) => r.decision.confidenceScore,
  );
  const strongConfidences = escalatedResults.map(
    (r) => r.strongResponse?.confidenceScore ?? 7,
  );
  const avgConfidenceCheap =
    cheapConfidences.length > 0
      ? cheapConfidences.reduce((a, b) => a + b, 0) / cheapConfidences.length
      : 0;
  const avgConfidenceStrong =
    strongConfidences.length > 0
      ? strongConfidences.reduce((a, b) => a + b, 0) / strongConfidences.length
      : 0;

  // Latency
  const cheapLatencies = cheapResults.map((r) => r.cheapResponse.latencyMs);
  const escalatedLatencies = escalatedResults.map((r) => r.totalLatencyMs);
  const allLatencies = results
    .map((r) => r.totalLatencyMs)
    .sort((a, b) => a - b);

  const avgCheapMs =
    cheapLatencies.length > 0
      ? cheapLatencies.reduce((a, b) => a + b, 0) / cheapLatencies.length
      : 0;
  const avgEscalatedMs =
    escalatedLatencies.length > 0
      ? escalatedLatencies.reduce((a, b) => a + b, 0) / escalatedLatencies.length
      : 0;
  const avgTotalMs =
    allLatencies.length > 0
      ? allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length
      : 0;

  // Escalation reasons breakdown (from heuristics flags)
  const escalationReasons = {
    short_response: 0,
    uncertainty_detected: 0,
    low_confidence: 0,
    error_occurred: 0,
  };

  for (const r of escalatedResults) {
    if (r.decision.heuristics.errorOccurred) {
      escalationReasons.error_occurred++;
    }
    if (r.decision.heuristics.shortResponse) {
      escalationReasons.short_response++;
    }
    if (r.decision.heuristics.uncertaintyDetected) {
      escalationReasons.uncertainty_detected++;
    }
    if (r.decision.heuristics.lowConfidence) {
      escalationReasons.low_confidence++;
    }
  }

  return {
    timestamp: new Date().toISOString(),
    total_queries: total,
    model_config: {
      cheap: "Qwen3.6-35B-A3B (llama.cpp port 8081)",
      strong: "phi4:14b (Ollama port 11434)",
    },
    routing_metrics: {
      cheap_count: cheapResults.length,
      escalated_count: escalatedResults.length,
      escalation_rate: total > 0 ? escalatedResults.length / total : 0,
      correct_routing: correctRouting,
      routing_accuracy: total > 0 ? correctRouting / total : 0,
      accuracy_by_category: accuracyByCategory,
    },
    quality_metrics: {
      keyword_match_rate: total > 0 ? totalKeywordMatch / total : 0,
      keyword_match_by_category: keywordMatchByCategory,
      avg_confidence_cheap: avgConfidenceCheap,
      avg_confidence_strong: avgConfidenceStrong,
    },
    latency_metrics: {
      avg_cheap_ms: Math.round(avgCheapMs),
      avg_escalated_ms: Math.round(avgEscalatedMs),
      avg_total_ms: Math.round(avgTotalMs),
      p50_ms: percentile(allLatencies, 50),
      p95_ms: percentile(allLatencies, 95),
    },
    heuristics_breakdown: {
      escalation_reasons: escalationReasons,
    },
  };
}

// ─── Console table printer ──────────────────────────────────────────────────

function printSummaryTable(summary: RoutingSummary): void {
  const W = 60;
  const hr = "╔" + "═".repeat(W) + "╗";
  const hr2 = "╠" + "═".repeat(W) + "╣";
  const hrEnd = "╚" + "═".repeat(W) + "╝";
  const row = (text: string) => "║ " + padEnd(text, W - 2) + "║";

  const m = summary.routing_metrics;
  const q = summary.quality_metrics;
  const l = summary.latency_metrics;
  const h = summary.heuristics_breakdown.escalation_reasons;

  console.info(hr);
  console.info(row("MODEL ROUTING TEST RESULTS"));
  console.info(hr2);
  console.info(row("Model config:"));
  console.info(row(`  Cheap:  ${summary.model_config.cheap}`));
  console.info(row(`  Strong: ${summary.model_config.strong}`));
  console.info(hr2);
  console.info(row("Routing:"));
  console.info(
    row(
      `  Cheap:      ${m.cheap_count}/${summary.total_queries} (${formatPct(m.cheap_count, summary.total_queries)})`,
    ),
  );
  console.info(
    row(
      `  Escalated:  ${m.escalated_count}/${summary.total_queries} (${formatPct(m.escalated_count, summary.total_queries)})`,
    ),
  );
  console.info(
    row(
      `  Accuracy:   ${m.correct_routing}/${summary.total_queries} (${formatPct(m.correct_routing, summary.total_queries)})`,
    ),
  );
  console.info(hr2);
  console.info(row("By category:"));

  const catLabels = ["easy", "medium", "hard"] as const;
  for (const cat of catLabels) {
    const acc = m.accuracy_by_category[cat] ?? 0;
    const kw = q.keyword_match_by_category[cat] ?? 0;
    const label = cat.charAt(0).toUpperCase() + cat.slice(1);
    console.info(
      row(
        `  ${padEnd(label + ":", 9)} ${formatPct(Math.round(acc * 100), 100)} accuracy, kw match ${formatPct(Math.round(kw * 100), 100)}`,
      ),
    );
  }

  console.info(hr2);
  console.info(row("Escalation reasons:"));
  console.info(row(`  Low confidence:     ${h.low_confidence}`));
  console.info(row(`  Uncertainty:        ${h.uncertainty_detected}`));
  console.info(row(`  Short response:     ${h.short_response}`));
  console.info(row(`  Error:              ${h.error_occurred}`));
  console.info(hr2);
  console.info(row("Latency:"));
  console.info(row(`  Cheap avg:    ${formatSec(l.avg_cheap_ms)}`));
  console.info(row(`  Escalated avg: ${formatSec(l.avg_escalated_ms)}`));
  console.info(row(`  Total avg:    ${formatSec(l.avg_total_ms)}`));
  console.info(row(`  P50:          ${formatSec(l.p50_ms)}`));
  console.info(row(`  P95:          ${formatSec(l.p95_ms)}`));
  console.info(hrEnd);
}

// ─── Entry point ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-require-imports
if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}

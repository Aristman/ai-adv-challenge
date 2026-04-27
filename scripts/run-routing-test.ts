/**
 * run-routing-test.ts — Full routing test pipeline
 *
 * 1. Load .env
 * 2. Health check: llama.cpp + ZAI API
 * 3. If llama.cpp not running → start via LlamaServerManager
 * 4. Create ModelRouter
 * 5. Load data/routing-testset.jsonl (30 examples)
 * 6. Route each prompt via router.route()
 * 7. Collect metrics
 * 8. Save results/routing-results.jsonl + results/routing-summary.json
 * 9. Print summary table
 *
 * No Ollama. Both models via openai npm package.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { LlamaServerManager } from "./llama-server-manager";
import { ModelRouter } from "./model-router";
import type {
  RoutingDecision,
  ModelResponse,
  ModelTier,
} from "./model-router";

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
  escalated: boolean;
  decision: RoutingDecision;
  cheapResponse: ModelResponse | undefined;
  response: ModelResponse;
  matchedKeywords: string[];
  totalLatencyMs: number;
  error: boolean;
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
    p99_ms: number;
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

const REQUEST_DELAY_MS = 1_000;

// ─── Helpers ────────────────────────────────────────────────────────────────

function loadEnv(): void {
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
}

function readJsonl<T>(filePath: string): T[] {
  const content = readFileSync(filePath, "utf-8");
  return content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
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

/** Right-pad string to exact length */
function padEnd(s: string, len: number): string {
  return s.length >= len ? s.substring(0, len) : s + " ".repeat(len - s.length);
}

/** Left-pad string to exact length */
function padStartStr(s: string, len: number): string {
  return s.length >= len
    ? s.substring(s.length - len)
    : " ".repeat(len - s.length) + s;
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

/**
 * "remote" expected_route is treated as "strong" for accuracy purposes.
 */
function needsEscalation(expectedRoute: string): boolean {
  return expectedRoute === "strong" || expectedRoute === "remote";
}

function isCorrectRouting(expectedRoute: string, escalated: boolean): boolean {
  if (expectedRoute === "cheap" && !escalated) return true;
  if (needsEscalation(expectedRoute) && escalated) return true;
  return false;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.info("=== Model Routing Test ===\n");

  // 1. Load .env
  loadEnv();

  const port = Number(process.env.LLAMA_SERVER_PORT ?? "8080");

  // 2. Health check: llama.cpp
  console.info("[test] Checking llama.cpp health...");
  let llamaHealthy = false;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    llamaHealthy = res.ok;
  } catch {
    llamaHealthy = false;
  }

  // 3. Auto-start llama.cpp if not running
  let llamaStarted = false;
  const llamaManager = new LlamaServerManager({
    port,
    modelPath: process.env.LLAMA_MODEL_PATH,
    ngl: Number(process.env.LLAMA_NGL ?? "28"),
    ctxSize: Number(process.env.LLAMA_CTX_SIZE ?? "4096"),
  });

  if (!llamaHealthy) {
    console.info(
      `llama.cpp not responding on port ${port}. Starting...`,
    );
    try {
      await llamaManager.start();
      llamaStarted = true;
      console.info("[test] llama.cpp started.\n");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[test] Failed to start llama.cpp: ${msg}`);
      process.exit(1);
    }
  } else {
    console.info("[test] llama.cpp is healthy.\n");
  }

  try {
    // 4. Create ModelRouter (constructor loads .env internally too)
    const router = new ModelRouter();

    // Quick health check via router (validates both endpoints)
    console.info("[test] Checking ZAI API health via router...");
    const health = await router.healthCheck();
    console.info(
      `[test] Health: llama.cpp=${health.cheap}, ZAI=${health.strong}\n`,
    );

    if (!health.strong) {
      console.error(
        "[test] ZAI API not available. Check GLM_API_KEY in .env.",
      );
      process.exit(1);
    }

    // 5. Load test dataset
    const datasetPath = resolve(process.cwd(), "data/routing-testset.jsonl");
    if (!existsSync(datasetPath)) {
      console.error(`[test] Dataset not found: ${datasetPath}`);
      process.exit(1);
    }
    const examples = readJsonl<TestExample>(datasetPath);
    console.info(`[test] Loaded ${examples.length} test examples.\n`);

    // 6. Route each prompt
    const results: RoutingResult[] = [];
    const total = examples.length;

    for (let i = 0; i < total; i++) {
      const example = examples[i];
      const num = i + 1;
      const prefix = `[${String(num).padStart(2, " ")}/${total}]`;

      try {
        const routeStart = Date.now();
        const routeResult = await router.route(example.prompt);
        const routeLatencyMs = Date.now() - routeStart;

        // Check keyword matches against the final response
        const finalContent = routeResult.response.content;
        const matchedKeywords = findMatchedKeywords(
          example.expected_keywords,
          finalContent,
        );

        const cheapLatencyMs = routeResult.cheapResponse?.latencyMs ?? 0;
        const strongLatencyMs =
          routeResult.response.tier === "strong"
            ? routeResult.response.latencyMs
            : 0;

        const result: RoutingResult = {
          id: example.id,
          category: example.category,
          prompt: example.prompt,
          expectedRoute: example.expected_route,
          escalated: routeResult.decision.escalated,
          decision: routeResult.decision,
          cheapResponse: routeResult.cheapResponse,
          response: routeResult.response,
          matchedKeywords,
          totalLatencyMs: routeLatencyMs,
          error: false,
        };
        results.push(result);

        // Progress output
        const matched = isCorrectRouting(
          example.expected_route,
          routeResult.decision.escalated,
        );
        const checkMark = matched ? "✓" : "✗";
        const escSymbol = routeResult.decision.escalated ? "↑" : " ";
        const routeStr = routeResult.decision.escalated
          ? "strong"
          : "cheap";
        const truncPrompt =
          example.prompt.length > 45
            ? example.prompt.substring(0, 45) + "..."
            : example.prompt;

        console.info(
          `${prefix} ${padEnd(example.category, 6)} → ${padEnd(routeStr, 6)} ${checkMark}${escSymbol} conf=${routeResult.decision.confidenceScore} ${padStartStr(formatSec(routeLatencyMs), 6)}  "${truncPrompt}"`,
        );

        if (
          routeResult.decision.escalated &&
          routeResult.decision.escalationReason !== "none"
        ) {
          console.info(
            `         (эскалация: ${routeResult.decision.escalationReason})`,
          );
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`${prefix} ERROR: ${errorMsg}`);

        results.push({
          id: example.id,
          category: example.category,
          prompt: example.prompt,
          expectedRoute: example.expected_route,
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
          cheapResponse: undefined,
          response: {
            content: "",
            model: "error",
            tier: "cheap",
            latencyMs: 0,
            confidenceScore: 0,
          },
          matchedKeywords: [],
          totalLatencyMs: 0,
          error: true,
        });
      }

      // Rate limiting: 1s delay between requests
      if (i < total - 1) {
        await sleep(REQUEST_DELAY_MS);
      }
    }

    // 7. Build summary
    console.info("\n--- Collecting metrics ---\n");
    const summary = buildSummary(results, port);

    // 8. Print table
    printSummaryTable(summary);

    // 9. Save results to disk
    const resultsDir = resolve(process.cwd(), "results");
    if (!existsSync(resultsDir)) {
      mkdirSync(resultsDir, { recursive: true });
    }

    const jsonlRows: JsonlRow[] = results.map((r) => ({
      id: r.id,
      category: r.category,
      prompt: r.prompt,
      expected_route: r.expectedRoute,
      actual_route: r.response.tier,
      escalated: r.escalated,
      confidence_score: r.decision.confidenceScore,
      cheap_response: r.cheapResponse?.content ?? null,
      strong_response:
        r.response.tier === "strong" ? r.response.content : null,
      escalation_reason: r.decision.escalationReason,
      matched_keywords: r.matchedKeywords,
      cheap_latency_ms: r.cheapResponse?.latencyMs ?? 0,
      strong_latency_ms:
        r.response.tier === "strong" ? r.response.latencyMs : 0,
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
    writeFileSync(
      summaryPath,
      JSON.stringify(summary, null, 2) + "\n",
      "utf-8",
    );
    console.info(`[test] Summary saved to ${summaryPath}\n`);
  } finally {
    // Stop llama.cpp if we started it
    if (llamaStarted) {
      await llamaManager.stop();
      console.info("[test] llama.cpp stopped.");
    }
  }

  console.info("[test] Done.");
}

// ─── Summary builder ────────────────────────────────────────────────────────

function buildSummary(
  results: readonly RoutingResult[],
  port: number,
): RoutingSummary {
  const total = results.length;
  if (total === 0) {
    return emptySummary(port);
  }

  const cheapResults = results.filter((r) => !r.escalated);
  const escalatedResults = results.filter((r) => r.escalated);

  // Routing accuracy (treat "remote" as "strong")
  const correctRouting = results.filter((r) =>
    isCorrectRouting(r.expectedRoute, r.escalated),
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
      catResults.filter((r) =>
        isCorrectRouting(r.expectedRoute, r.escalated),
      ).length / catCount;
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
  const strongConfidences = escalatedResults.map((r) => {
    if (r.response.tier === "strong") {
      return r.response.confidenceScore;
    }
    return 10; // fallback
  });
  const avgConfidenceCheap =
    cheapConfidences.length > 0
      ? cheapConfidences.reduce((a, b) => a + b, 0) /
        cheapConfidences.length
      : 0;
  const avgConfidenceStrong =
    strongConfidences.length > 0
      ? strongConfidences.reduce((a, b) => a + b, 0) /
        strongConfidences.length
      : 0;

  // Latency
  const cheapLatencies = cheapResults.map(
    (r) => r.cheapResponse?.latencyMs ?? r.totalLatencyMs,
  );
  const escalatedLatencies = escalatedResults.map(
    (r) => r.totalLatencyMs,
  );
  const allLatencies = results
    .map((r) => r.totalLatencyMs)
    .sort((a, b) => a - b);

  const avgCheapMs =
    cheapLatencies.length > 0
      ? cheapLatencies.reduce((a, b) => a + b, 0) / cheapLatencies.length
      : 0;
  const avgEscalatedMs =
    escalatedLatencies.length > 0
      ? escalatedLatencies.reduce((a, b) => a + b, 0) /
        escalatedLatencies.length
      : 0;
  const avgTotalMs =
    allLatencies.length > 0
      ? allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length
      : 0;

  // Escalation reasons breakdown
  const escalationReasons = {
    short_response: 0,
    uncertainty_detected: 0,
    low_confidence: 0,
    error_occurred: 0,
  };
  for (const r of escalatedResults) {
    if (r.decision.heuristics.errorOccurred) escalationReasons.error_occurred++;
    if (r.decision.heuristics.shortResponse) escalationReasons.short_response++;
    if (r.decision.heuristics.uncertaintyDetected) escalationReasons.uncertainty_detected++;
    if (r.decision.heuristics.lowConfidence) escalationReasons.low_confidence++;
  }

  return {
    timestamp: new Date().toISOString(),
    total_queries: total,
    model_config: {
      cheap: `Qwen3.6-35B-A3B (llama.cpp :${port})`,
      strong: "glm-5-turbo (ZAI API)",
    },
    routing_metrics: {
      cheap_count: cheapResults.length,
      escalated_count: escalatedResults.length,
      escalation_rate: escalatedResults.length / total,
      correct_routing: correctRouting,
      routing_accuracy: correctRouting / total,
      accuracy_by_category: accuracyByCategory,
    },
    quality_metrics: {
      keyword_match_rate: totalKeywordMatch / total,
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
      p99_ms: percentile(allLatencies, 99),
    },
    heuristics_breakdown: {
      escalation_reasons: escalationReasons,
    },
  };
}

function emptySummary(port: number): RoutingSummary {
  return {
    timestamp: new Date().toISOString(),
    total_queries: 0,
    model_config: {
      cheap: `Qwen3.6-35B-A3B (llama.cpp :${port})`,
      strong: "glm-5-turbo (ZAI API)",
    },
    routing_metrics: {
      cheap_count: 0,
      escalated_count: 0,
      escalation_rate: 0,
      correct_routing: 0,
      routing_accuracy: 0,
      accuracy_by_category: {},
    },
    quality_metrics: {
      keyword_match_rate: 0,
      keyword_match_by_category: {},
      avg_confidence_cheap: 0,
      avg_confidence_strong: 0,
    },
    latency_metrics: {
      avg_cheap_ms: 0,
      avg_escalated_ms: 0,
      avg_total_ms: 0,
      p50_ms: 0,
      p95_ms: 0,
      p99_ms: 0,
    },
    heuristics_breakdown: {
      escalation_reasons: {
        short_response: 0,
        uncertainty_detected: 0,
        low_confidence: 0,
        error_occurred: 0,
      },
    },
  };
}

// ─── Console table printer ──────────────────────────────────────────────────

function printSummaryTable(summary: RoutingSummary): void {
  const W = 62; // inner width
  const BORDER = `╔${"═".repeat(W)}╗`;
  const MID = `╠${"═".repeat(W)}╣`;
  const END = `╚${"═".repeat(W)}╝`;
  const ROW = (s: string) => `║ ${padEnd(s, W - 2)} ║`;

  const m = summary.routing_metrics;
  const q = summary.quality_metrics;
  const l = summary.latency_metrics;
  const h = summary.heuristics_breakdown.escalation_reasons;

  console.info(BORDER);
  console.info(ROW("MODEL ROUTING TEST RESULTS"));
  console.info(MID);
  console.info(ROW("Model config:"));
  console.info(ROW(`  Cheap:  ${summary.model_config.cheap}`));
  console.info(ROW(`  Strong: ${summary.model_config.strong}`));
  console.info(MID);
  console.info(ROW("Routing:"));
  console.info(
    ROW(
      `  Cheap:      ${m.cheap_count}/${summary.total_queries} (${formatPct(m.cheap_count, summary.total_queries)})`,
    ),
  );
  console.info(
    ROW(
      `  Escalated:  ${m.escalated_count}/${summary.total_queries} (${formatPct(m.escalated_count, summary.total_queries)})`,
    ),
  );
  console.info(
    ROW(
      `  Accuracy:   ${m.correct_routing}/${summary.total_queries} (${formatPct(m.correct_routing, summary.total_queries)})`,
    ),
  );
  console.info(MID);
  console.info(ROW("By category:"));

  const catLabels = ["easy", "medium", "hard"] as const;
  for (const cat of catLabels) {
    const acc = m.accuracy_by_category[cat] ?? 0;
    const kw = q.keyword_match_by_category[cat] ?? 0;
    const label = cat.charAt(0).toUpperCase() + cat.slice(1);
    console.info(
      ROW(
        `  ${padEnd(label + ":", 9)} ${formatPct(Math.round(acc * 100), 100)} accuracy, kw match ${formatPct(Math.round(kw * 100), 100)}`,
      ),
    );
  }

  console.info(MID);
  console.info(ROW("Escalation reasons:"));
  console.info(ROW(`  Low confidence:     ${h.low_confidence}`));
  console.info(ROW(`  Uncertainty:        ${h.uncertainty_detected}`));
  console.info(ROW(`  Short response:     ${h.short_response}`));
  console.info(ROW(`  Error:              ${h.error_occurred}`));
  console.info(MID);
  console.info(ROW("Latency:"));
  console.info(ROW(`  Cheap avg:     ${formatSec(l.avg_cheap_ms)}`));
  console.info(ROW(`  Escalated avg: ${formatSec(l.avg_escalated_ms)}`));
  console.info(ROW(`  Total avg:     ${formatSec(l.avg_total_ms)}`));
  console.info(ROW(`  P50:           ${formatSec(l.p50_ms)}`));
  console.info(ROW(`  P95:           ${formatSec(l.p95_ms)}`));
  console.info(ROW(`  P99:           ${formatSec(l.p99_ms)}`));
  console.info(END);
}

// ─── Entry point ────────────────────────────────────────────────────────────

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}

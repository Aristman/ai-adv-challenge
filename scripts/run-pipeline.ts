/**
 * Full evaluation pipeline.
 *
 * Runs every NER testset example through:
 *   1. Self-check extraction + verification
 *   2. Constraint-based validation
 *   3. Combined confidence assessment
 *
 * Measures precision, recall, F1, latency.
 * Saves detailed results to results/full-run.jsonl
 * and aggregated metrics to results/summary.json.
 */

import fs from "fs";
import path from "path";

import { OllamaClient } from "./ollama-client";
import { selfCheck } from "./self-check";
import type { Entity, SelfCheckResult } from "./self-check";
import { validateConstraints } from "./constraint-validator";
import type { ConstraintResult } from "./constraint-validator";
import { assessConfidence } from "./confidence";
import type { ConfidenceReport, Decision } from "./confidence";

// ─── Interfaces ─────────────────────────────────────────────────────────────

interface ExpectedEntity {
  type: Entity["type"];
  value: string;
  start: number;
  end: number;
}

interface TestItem {
  id: number;
  category: "correct" | "boundary" | "hard";
  text: string;
  expected_entities: ExpectedEntity[];
}

interface PipelineResult {
  id: number;
  category: string;
  text: string;
  expected_entities: ExpectedEntity[];
  extracted_entities: Entity[];
  verified_entities: Entity[];
  decision: Decision;
  confidence: number;
  self_check_confidence: number;
  constraint_score: number;
  constraint_errors: number;
  constraint_warnings: number;
  precision: number;
  recall: number;
  f1: number;
  latency_self_check_ms: number;
  latency_total_ms: number;
  explanation: string;
}

interface SummaryJson {
  model: string;
  total_examples: number;
  timestamp: string;
  overall_metrics: {
    avg_precision: number;
    avg_recall: number;
    avg_f1: number;
    precision_by_category: Record<string, number>;
    recall_by_category: Record<string, number>;
  };
  confidence_metrics: {
    avg_confidence: number;
    accepted: number;
    review: number;
    rejected: number;
    accept_rate: number;
    reject_rate: number;
  };
  latency_metrics: {
    avg_self_check_ms: number;
    avg_total_ms: number;
    p50_ms: number;
    p95_ms: number;
    p99_ms: number;
  };
  constraint_metrics: {
    avg_errors: number;
    avg_warnings: number;
    perfect_constraint_rate: number;
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(p / 100 * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

// ─── Fuzzy entity matching ─────────────────────────────────────────────────

function fuzzyMatch(
  extracted: Entity,
  expected: Entity,
): boolean {
  if (extracted.type !== expected.type) return false;

  const eLower = extracted.value.toLowerCase().trim();
  const xLower = expected.value.toLowerCase().trim();

  if (eLower === xLower) return true;

  // One contains the other (partial extractions)
  if (eLower.includes(xLower) || xLower.includes(eLower)) return true;

  // ≥60% word overlap
  const eWords = eLower.split(/\s+/);
  const xWords = xLower.split(/\s+/);
  const overlap = eWords.filter((w) =>
    xWords.some((xw) => xw.includes(w) || w.includes(xw)),
  );
  return overlap.length / Math.max(eWords.length, xWords.length) >= 0.6;
}

// ─── Precision / Recall / F1 ───────────────────────────────────────────────

interface MatchMetrics {
  precision: number;
  recall: number;
  f1: number;
}

function computeMetrics(
  extracted: Entity[],
  expected: Entity[],
): MatchMetrics {
  if (extracted.length === 0 && expected.length === 0) {
    return { precision: 1.0, recall: 1.0, f1: 1.0 };
  }
  if (extracted.length === 0) {
    return { precision: 0.0, recall: 0.0, f1: 0.0 };
  }
  if (expected.length === 0) {
    return { precision: 0.0, recall: 0.0, f1: 0.0 };
  }

  const usedExpected = new Set<number>();
  let matched = 0;

  for (const ext of extracted) {
    for (let i = 0; i < expected.length; i++) {
      if (usedExpected.has(i)) continue;
      if (fuzzyMatch(ext, expected[i])) {
        matched++;
        usedExpected.add(i);
        break;
      }
    }
  }

  const precision = matched / extracted.length;
  const recall = matched / expected.length;
  const f1 =
    precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : 0.0;

  return { precision, recall, f1 };
}

// ─── Load dataset ──────────────────────────────────────────────────────────

function loadDataset(filePath: string): TestItem[] {
  const raw = fs.readFileSync(filePath, "utf-8").trim();
  const lines = raw.split("\n");
  const items: TestItem[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const parsed = JSON.parse(trimmed) as TestItem;
    items.push(parsed);
  }

  return items;
}

// ─── Main pipeline ──────────────────────────────────────────────────────────

async function runPipeline(): Promise<void> {
  const client = new OllamaClient({ model: "phi4:14b" });

  // Health check
  console.info("Checking Ollama availability...");
  const healthy = await client.healthCheck();
  if (!healthy) {
    console.error("Error: Ollama is not available. Exiting.");
    process.exit(1);
  }
  console.info("Ollama is available.\n");

  // Load dataset
  const datasetPath = path.resolve("data", "ner-testset.jsonl");
  const dataset = loadDataset(datasetPath);
  console.info(`Loaded ${dataset.length} examples from ${datasetPath}\n`);

  // Ensure results directory
  const resultsDir = path.resolve("results");
  fs.mkdirSync(resultsDir, { recursive: true });

  // Run each example
  const results: PipelineResult[] = [];
  const totalExamples = dataset.length;

  for (let i = 0; i < totalExamples; i++) {
    const item = dataset[i];
    const index = i + 1;

    const totalStart = performance.now();

    // Step 1: Self-check
    const selfCheckResult: SelfCheckResult = await selfCheck(
      item.text,
      client,
    );

    const selfCheckEnd = performance.now();
    const latencySelfCheck = Math.round(selfCheckEnd - totalStart);

    const extractedEntities = selfCheckResult.original.entities;
    const verifiedEntities = selfCheckResult.verified_entities;

    // Step 2: Constraint validation
    const constraintResult: ConstraintResult = validateConstraints(
      verifiedEntities,
      item.text,
    );

    // Step 3: Confidence assessment
    const confidenceReport: ConfidenceReport = assessConfidence({
      text: item.text,
      entities: verifiedEntities,
      selfCheckResult,
      constraintResult,
    });

    const totalEnd = performance.now();
    const latencyTotal = Math.round(totalEnd - totalStart);

    // Step 4: Precision / Recall
    const expectedEntities: Entity[] = item.expected_entities.map((e) => ({
      type: e.type,
      value: e.value,
    }));
    const metrics = computeMetrics(verifiedEntities, expectedEntities);

    // Build result
    const result: PipelineResult = {
      id: item.id,
      category: item.category,
      text: item.text,
      expected_entities: item.expected_entities,
      extracted_entities: extractedEntities,
      verified_entities: verifiedEntities,
      decision: confidenceReport.decision,
      confidence: Math.round(confidenceReport.confidence * 1000) / 1000,
      self_check_confidence: Math.round(confidenceReport.self_check_confidence * 1000) / 1000,
      constraint_score: Math.round(confidenceReport.constraint_score * 1000) / 1000,
      constraint_errors: constraintResult.summary.errors,
      constraint_warnings: constraintResult.summary.warnings,
      precision: Math.round(metrics.precision * 1000) / 1000,
      recall: Math.round(metrics.recall * 1000) / 1000,
      f1: Math.round(metrics.f1 * 1000) / 1000,
      latency_self_check_ms: latencySelfCheck,
      latency_total_ms: latencyTotal,
      explanation: confidenceReport.reason,
    };

    results.push(result);

    // Progress line
    const shortText = truncateText(item.text, 40);
    console.info(
      `[${index}/${totalExamples}] category=${item.category} ` +
        `text="${shortText}" → ${result.decision} ` +
        `(confidence=${result.confidence}, P=${result.precision}, R=${result.recall})`,
    );

    // Delay between Ollama requests (skip delay on last item)
    if (i < totalExamples - 1) {
      await sleep(DELAY_MS);
    }
  }

  // ── Aggregate metrics ──────────────────────────────────────────────────

  const categories = ["correct", "boundary", "hard"] as const;

  // Overall metrics
  const totalPrecision = results.reduce((sum, r) => sum + r.precision, 0);
  const totalRecall = results.reduce((sum, r) => sum + r.recall, 0);
  const totalF1 = results.reduce((sum, r) => sum + r.f1, 0);

  const precisionByCategory: Record<string, number> = {};
  const recallByCategory: Record<string, number> = {};
  for (const cat of categories) {
    const catResults = results.filter((r) => r.category === cat);
    if (catResults.length > 0) {
      precisionByCategory[cat] =
        Math.round(
          (catResults.reduce((s, r) => s + r.precision, 0) /
            catResults.length) *
            10000,
        ) / 10000;
      recallByCategory[cat] =
        Math.round(
          (catResults.reduce((s, r) => s + r.recall, 0) /
            catResults.length) *
            10000,
        ) / 10000;
    } else {
      precisionByCategory[cat] = 0;
      recallByCategory[cat] = 0;
    }
  }

  // Confidence metrics
  const totalConfidence = results.reduce((s, r) => s + r.confidence, 0);
  const acceptedCount = results.filter((r) => r.decision === "ACCEPT").length;
  const reviewCount = results.filter((r) => r.decision === "REVIEW").length;
  const rejectedCount = results.filter((r) => r.decision === "REJECT").length;

  // Latency metrics
  const selfCheckLatencies = results.map((r) => r.latency_self_check_ms);
  const totalLatencies = results.map((r) => r.latency_total_ms);

  // Constraint metrics
  const totalConstraintErrors = results.reduce(
    (s, r) => s + r.constraint_errors,
    0,
  );
  const totalConstraintWarnings = results.reduce(
    (s, r) => s + r.constraint_warnings,
    0,
  );
  const perfectConstraintCount = results.filter(
    (r) => r.constraint_errors === 0 && r.constraint_warnings === 0,
  ).length;

  const summary: SummaryJson = {
    model: "phi4:14b",
    total_examples: results.length,
    timestamp: new Date().toISOString(),
    overall_metrics: {
      avg_precision:
        Math.round((totalPrecision / results.length) * 10000) / 10000,
      avg_recall:
        Math.round((totalRecall / results.length) * 10000) / 10000,
      avg_f1: Math.round((totalF1 / results.length) * 10000) / 10000,
      precision_by_category: precisionByCategory,
      recall_by_category: recallByCategory,
    },
    confidence_metrics: {
      avg_confidence:
        Math.round((totalConfidence / results.length) * 10000) / 10000,
      accepted: acceptedCount,
      review: reviewCount,
      rejected: rejectedCount,
      accept_rate:
        Math.round((acceptedCount / results.length) * 10000) / 10000,
      reject_rate:
        Math.round((rejectedCount / results.length) * 10000) / 10000,
    },
    latency_metrics: {
      avg_self_check_ms:
        Math.round(
          selfCheckLatencies.reduce((s, v) => s + v, 0) /
            selfCheckLatencies.length,
        ),
      avg_total_ms:
        Math.round(
          totalLatencies.reduce((s, v) => s + v, 0) / totalLatencies.length,
        ),
      p50_ms: percentile(totalLatencies, 50),
      p95_ms: percentile(totalLatencies, 95),
      p99_ms: percentile(totalLatencies, 99),
    },
    constraint_metrics: {
      avg_errors:
        Math.round((totalConstraintErrors / results.length) * 10000) /
        10000,
      avg_warnings:
        Math.round((totalConstraintWarnings / results.length) * 10000) /
        10000,
      perfect_constraint_rate:
        Math.round(
          (perfectConstraintCount / results.length) * 10000,
        ) / 10000,
    },
  };

  // ── Save results ───────────────────────────────────────────────────────

  const fullRunPath = path.join(resultsDir, "full-run.jsonl");
  const fullRunLines = results.map((r) => JSON.stringify(r));
  fs.writeFileSync(fullRunPath, fullRunLines.join("\n") + "\n", "utf-8");
  console.info(`\nDetailed results saved to ${fullRunPath}`);

  const summaryPath = path.join(resultsDir, "summary.json");
  fs.writeFileSync(
    summaryPath,
    JSON.stringify(summary, null, 2),
    "utf-8",
  );
  console.info(`Summary saved to ${summaryPath}`);

  // ── Print summary table ────────────────────────────────────────────────

  console.info("\n╔══════════════════════════════════════════════════════════════╗");
  console.info("║                  EVALUATION SUMMARY                         ║");
  console.info("╠══════════════════════════════════════════════════════════════╣");
  console.info(`║  Model:    ${summary.model.padEnd(48)}║`);
  console.info(`║  Examples: ${String(summary.total_examples).padEnd(48)}║`);
  console.info("╠══════════════════════════════════════════════════════════════╣");
  console.info("║  OVERALL METRICS                                              ║");
  console.info(`║    Precision:    ${summary.overall_metrics.avg_precision.toFixed(4).padEnd(42)}║`);
  console.info(`║    Recall:       ${summary.overall_metrics.avg_recall.toFixed(4).padEnd(42)}║`);
  console.info(`║    F1:           ${summary.overall_metrics.avg_f1.toFixed(4).padEnd(42)}║`);
  console.info("╠══════════════════════════════════════════════════════════════╣");
  console.info("║  PRECISION BY CATEGORY                                        ║");
  for (const cat of categories) {
    const val = summary.overall_metrics.precision_by_category[cat];
    console.info(
      `║    ${cat.padEnd(12)} ${val.toFixed(4).padEnd(35)}║`,
    );
  }
  console.info("╠══════════════════════════════════════════════════════════════╣");
  console.info("║  RECALL BY CATEGORY                                           ║");
  for (const cat of categories) {
    const val = summary.overall_metrics.recall_by_category[cat];
    console.info(
      `║    ${cat.padEnd(12)} ${val.toFixed(4).padEnd(35)}║`,
    );
  }
  console.info("╠══════════════════════════════════════════════════════════════╣");
  console.info("║  CONFIDENCE METRICS                                           ║");
  console.info(
    `║    Avg Confidence: ${summary.confidence_metrics.avg_confidence.toFixed(4).padEnd(36)}║`,
  );
  console.info(
    `║    ACCEPT: ${String(summary.confidence_metrics.accepted).padEnd(6)} REVIEW: ${String(summary.confidence_metrics.review).padEnd(6)} REJECT: ${String(summary.confidence_metrics.rejected).padEnd(6)}║`,
  );
  console.info(
    `║    Accept Rate: ${summary.confidence_metrics.accept_rate.toFixed(4).padEnd(37)}║`,
  );
  console.info("╠══════════════════════════════════════════════════════════════╣");
  console.info("║  LATENCY METRICS                                              ║");
  console.info(
    `║    Avg Self-Check: ${String(summary.latency_metrics.avg_self_check_ms).padEnd(7)}ms${"".padEnd(30)}║`,
  );
  console.info(
    `║    Avg Total:      ${String(summary.latency_metrics.avg_total_ms).padEnd(7)}ms${"".padEnd(30)}║`,
  );
  console.info(
    `║    p50: ${String(summary.latency_metrics.p50_ms).padEnd(7)}ms  p95: ${String(summary.latency_metrics.p95_ms).padEnd(7)}ms  p99: ${String(summary.latency_metrics.p99_ms).padEnd(7)}ms║`,
  );
  console.info("╠══════════════════════════════════════════════════════════════╣");
  console.info("║  CONSTRAINT METRICS                                           ║");
  console.info(
    `║    Avg Errors:    ${summary.constraint_metrics.avg_errors.toFixed(4).padEnd(37)}║`,
  );
  console.info(
    `║    Avg Warnings:  ${summary.constraint_metrics.avg_warnings.toFixed(4).padEnd(37)}║`,
  );
  console.info(
    `║    Perfect Rate:  ${summary.constraint_metrics.perfect_constraint_rate.toFixed(4).padEnd(37)}║`,
  );
  console.info("╚══════════════════════════════════════════════════════════════╝");
}

// ─── Entry point ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-require-imports
if (require.main === module) {
  runPipeline().catch((err: unknown) => {
    console.error(
      "Pipeline failed:",
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  });
}

export { fuzzyMatch };

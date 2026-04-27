/**
 * Two-level NER pipeline: micro-model → LLM fallback.
 *
 * Flow:
 *   1. Run regex/heuristic micro-model (extractMicro) — always
 *   2. If status "OK" → accept result, no LLM call
 *   3. If status "UNSURE" or "EMPTY" → call phi4:14b via Ollama
 *   4. Merge results, collect metrics
 *
 * CLI:
 *   npx ts-node scripts/two-level-pipeline.ts --text "Иван Петров приехал в Москву"
 *   npx ts-node scripts/two-level-pipeline.ts --input data/ner-testset.jsonl --output results/two-level-results.jsonl
 */

import * as fs from "fs";
import * as path from "path";

import { extractMicro, type Entity, type MicroStatus } from "./micro-model";
import { OllamaClient } from "./ollama-client";

// ─── Types ──────────────────────────────────────────────────────────────────

interface PipelineResult {
  text: string;
  entities: Entity[];
  confidence: number;
  llm_used: boolean;
  latency_ms: number;
  latency_micro_ms: number;
  latency_llm_ms: number;
  micro_status: MicroStatus;
  llm_response?: string;
}

interface PipelineStats {
  total_queries: number;
  micro_only: number;
  llm_fallback: number;
  total_llm_calls: number;
  total_latency_ms: number;
  avg_latency_ms: number;
  avg_micro_latency_ms: number;
  avg_llm_latency_ms: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const ENTITY_TYPES = ["person", "date", "money", "email", "phone", "location"] as const;

const LLM_SYSTEM_PROMPT = [
  "You are a Named Entity Recognition system. Extract entities from Russian text.",
  "Entity types: person, date, money, email, phone, location.",
  'Return JSON: {"entities": [{"type": "...", "value": "..."}]}',
  'If no entities found, return {"entities": []}',
].join("\n");

// ─── Helpers ────────────────────────────────────────────────────────────────

function isValidEntityType(type: string): type is Entity["type"] {
  return (ENTITY_TYPES as readonly string[]).includes(type);
}

function sanitizeEntities(raw: unknown[]): Entity[] {
  const result: Entity[] = [];
  for (const item of raw) {
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      const obj = item as Record<string, unknown>;
      const type = String(obj["type"] ?? "");
      const value = String(obj["value"] ?? "");
      if (type && value && isValidEntityType(type)) {
        result.push({ type, value });
      }
    }
  }
  return result;
}

/**
 * Try to extract JSON array from an LLM response that may contain
 * markdown fences or other wrapping text.
 */
function extractJSONEntities(raw: string): Entity[] | null {
  // 1. Try direct parse
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.entities)) {
      return sanitizeEntities(parsed.entities);
    }
    return null;
  } catch {
    // not direct JSON, continue
  }

  // 2. Try to find JSON in markdown code fences
  const fenceRe = /```(?:json)?\s*\n?([\s\S]*?)\n?```/g;
  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = fenceRe.exec(raw)) !== null) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.entities)) {
        return sanitizeEntities(parsed.entities);
      }
    } catch {
      // try next fence
    }
  }

  // 3. Try to find a JSON object with "entities" key anywhere in the text
  const braceRe = /\{[^{}]*"entities"\s*:\s*\[[\s\S]*?\][^{}]*\}/g;
  let braceMatch: RegExpExecArray | null;
  while ((braceMatch = braceRe.exec(raw)) !== null) {
    try {
      const parsed = JSON.parse(braceMatch[0]);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.entities)) {
        return sanitizeEntities(parsed.entities);
      }
    } catch {
      // try next match
    }
  }

  return null;
}

// ─── LLM Fallback ───────────────────────────────────────────────────────────

async function llmFallback(
  text: string,
  client: OllamaClient,
): Promise<{ entities: Entity[]; rawResponse: string }> {
  const messages = [
    { role: "system" as const, content: LLM_SYSTEM_PROMPT },
    { role: "user" as const, content: text },
  ];

  const { data, meta } = await client.chatJSON<{ entities: unknown[] }>(
    messages,
    { format: "json" },
  );

  const rawResponse = JSON.stringify(data);
  const entities = sanitizeEntities(data.entities ?? []);

  console.info(
    `[pipeline] LLM returned ${entities.length} entities in ${meta.evalDurationMs}ms`,
  );

  return { entities, rawResponse };
}

// ─── Pipeline ───────────────────────────────────────────────────────────────

export async function runPipeline(text: string): Promise<PipelineResult> {
  const pipelineStart = performance.now();

  // Step 1: Always run micro-model
  const microStart = performance.now();
  const microResult = await extractMicro(text);
  const microEnd = performance.now();
  const latencyMicroMs = Math.round(microEnd - microStart);

  // Step 2: If OK, return micro-model result directly
  if (microResult.status === "OK") {
    const pipelineEnd = performance.now();
    return {
      text,
      entities: microResult.entities,
      confidence: microResult.confidence,
      llm_used: false,
      latency_ms: Math.round(pipelineEnd - pipelineStart),
      latency_micro_ms: latencyMicroMs,
      latency_llm_ms: 0,
      micro_status: microResult.status,
    };
  }

  // Step 3: UNSURE or EMPTY → LLM fallback
  const client = new OllamaClient({ model: "phi4:14b" });
  const llmStart = performance.now();
  let llmEntities: Entity[] | null = null;
  let llmRawResponse: string | undefined;

  try {
    const llmResult = await llmFallback(text, client);
    llmEntities = llmResult.entities;
    llmRawResponse = llmResult.rawResponse;
  } catch (err) {
    console.warn(
      `[pipeline] LLM fallback failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const llmEnd = performance.now();
  const latencyLlmMs = Math.round(llmEnd - llmStart);

  if (llmEntities !== null && llmEntities.length > 0) {
    const pipelineEnd = performance.now();
    return {
      text,
      entities: llmEntities,
      confidence: 0.8, // LLM fallback confidence
      llm_used: true,
      latency_ms: Math.round(pipelineEnd - pipelineStart),
      latency_micro_ms: latencyMicroMs,
      latency_llm_ms: latencyLlmMs,
      micro_status: microResult.status,
      llm_response: llmRawResponse,
    };
  }

  // LLM returned empty or failed → try to parse raw response if available
  if (llmRawResponse !== undefined) {
    const extracted = extractJSONEntities(llmRawResponse);
    if (extracted !== null && extracted.length > 0) {
      const pipelineEnd = performance.now();
      return {
        text,
        entities: extracted,
        confidence: 0.6,
        llm_used: true,
        latency_ms: Math.round(pipelineEnd - pipelineStart),
        latency_micro_ms: latencyMicroMs,
        latency_llm_ms: latencyLlmMs,
        micro_status: microResult.status,
        llm_response: llmRawResponse,
      };
    }
  }

  // Fallback: return micro-model result (even if empty)
  const pipelineEnd = performance.now();
  return {
    text,
    entities: microResult.entities,
    confidence: microResult.confidence,
    llm_used: false, // LLM didn't produce useful results
    latency_ms: Math.round(pipelineEnd - pipelineStart),
    latency_micro_ms: latencyMicroMs,
    latency_llm_ms: latencyLlmMs,
    micro_status: microResult.status,
    llm_response: llmRawResponse,
  };
}

// ─── Batch ───────────────────────────────────────────────────────────────────

export async function runBatch(
  items: Array<{ id: number; text: string; expected?: Entity[] }>,
): Promise<{ results: PipelineResult[]; stats: PipelineStats }> {
  const results: PipelineResult[] = [];
  const client = new OllamaClient({ model: "phi4:14b" });

  // Check health once
  const healthy = await client.healthCheck();
  if (!healthy) {
    console.warn("[pipeline] Ollama health check failed — LLM fallback will not be available");
  }

  let microOnlyCount = 0;
  let llmFallbackCount = 0;
  let totalLlmCalls = 0;
  let totalLatencyMs = 0;
  let totalMicroLatencyMs = 0;
  let totalLlmLatencyMs = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    console.info(`[batch] Processing ${i + 1}/${items.length} (id=${item.id})...`);

    const result = await runPipelineWithClient(item.text, client, healthy);
    results.push(result);

    totalLatencyMs += result.latency_ms;
    totalMicroLatencyMs += result.latency_micro_ms;

    if (result.llm_used) {
      llmFallbackCount++;
      totalLlmCalls++;
      totalLlmLatencyMs += result.latency_llm_ms;
    } else {
      microOnlyCount++;
    }
  }

  const stats: PipelineStats = {
    total_queries: results.length,
    micro_only: microOnlyCount,
    llm_fallback: llmFallbackCount,
    total_llm_calls: totalLlmCalls,
    total_latency_ms: totalLatencyMs,
    avg_latency_ms: results.length > 0 ? Math.round(totalLatencyMs / results.length) : 0,
    avg_micro_latency_ms: results.length > 0 ? Math.round(totalMicroLatencyMs / results.length) : 0,
    avg_llm_latency_ms: totalLlmCalls > 0 ? Math.round(totalLlmLatencyMs / totalLlmCalls) : 0,
  };

  return { results, stats };
}

/**
 * Internal: run a single pipeline step with a shared OllamaClient.
 */
async function runPipelineWithClient(
  text: string,
  client: OllamaClient,
  llmAvailable: boolean,
): Promise<PipelineResult> {
  const pipelineStart = performance.now();

  // Step 1: Always run micro-model
  const microStart = performance.now();
  const microResult = await extractMicro(text);
  const microEnd = performance.now();
  const latencyMicroMs = Math.round(microEnd - microStart);

  // Step 2: If OK, return micro-model result directly
  if (microResult.status === "OK") {
    const pipelineEnd = performance.now();
    return {
      text,
      entities: microResult.entities,
      confidence: microResult.confidence,
      llm_used: false,
      latency_ms: Math.round(pipelineEnd - pipelineStart),
      latency_micro_ms: latencyMicroMs,
      latency_llm_ms: 0,
      micro_status: microResult.status,
    };
  }

  // Step 3: UNSURE or EMPTY → LLM fallback
  if (!llmAvailable) {
    const pipelineEnd = performance.now();
    return {
      text,
      entities: microResult.entities,
      confidence: microResult.confidence,
      llm_used: false,
      latency_ms: Math.round(pipelineEnd - pipelineStart),
      latency_micro_ms: latencyMicroMs,
      latency_llm_ms: 0,
      micro_status: microResult.status,
    };
  }

  const llmStart = performance.now();
  let llmEntities: Entity[] | null = null;
  let llmRawResponse: string | undefined;

  try {
    const llmResult = await llmFallback(text, client);
    llmEntities = llmResult.entities;
    llmRawResponse = llmResult.rawResponse;
  } catch (err) {
    console.warn(
      `[pipeline] LLM fallback failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const llmEnd = performance.now();
  const latencyLlmMs = Math.round(llmEnd - llmStart);

  if (llmEntities !== null && llmEntities.length > 0) {
    const pipelineEnd = performance.now();
    return {
      text,
      entities: llmEntities,
      confidence: 0.8,
      llm_used: true,
      latency_ms: Math.round(pipelineEnd - pipelineStart),
      latency_micro_ms: latencyMicroMs,
      latency_llm_ms: latencyLlmMs,
      micro_status: microResult.status,
      llm_response: llmRawResponse,
    };
  }

  // LLM returned empty or failed → try to parse raw response
  if (llmRawResponse !== undefined) {
    const extracted = extractJSONEntities(llmRawResponse);
    if (extracted !== null && extracted.length > 0) {
      const pipelineEnd = performance.now();
      return {
        text,
        entities: extracted,
        confidence: 0.6,
        llm_used: true,
        latency_ms: Math.round(pipelineEnd - pipelineStart),
        latency_micro_ms: latencyMicroMs,
        latency_llm_ms: latencyLlmMs,
        micro_status: microResult.status,
        llm_response: llmRawResponse,
      };
    }
  }

  // Fallback: return micro-model result
  const pipelineEnd = performance.now();
  return {
    text,
    entities: microResult.entities,
    confidence: microResult.confidence,
    llm_used: false,
    latency_ms: Math.round(pipelineEnd - pipelineStart),
    latency_micro_ms: latencyMicroMs,
    latency_llm_ms: latencyLlmMs,
    micro_status: microResult.status,
    llm_response: llmRawResponse,
  };
}

// ─── CLI ────────────────────────────────────────────────────────────────────

interface JsonlRow {
  id: number;
  category?: string;
  text: string;
  expected_entities?: Array<{ type: string; value: string; start?: number; end?: number }>;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);

    const textIdx = args.indexOf("--text");
    const inputIdx = args.indexOf("--input");
    const outputIdx = args.indexOf("--output");

    // Single text mode
    if (textIdx !== -1 && args[textIdx + 1]) {
      const inputText = args[textIdx + 1];
      console.info(`[cli] Processing single text: "${inputText.substring(0, 80)}..."`);

      const result = await runPipeline(inputText);
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // Batch mode
    if (inputIdx !== -1 && args[inputIdx + 1]) {
      const inputPath = args[inputIdx + 1];
      const outputPath = outputIdx !== -1 && args[outputIdx + 1]
        ? args[outputIdx + 1]
        : "results/two-level-results.jsonl";

      if (!fs.existsSync(inputPath)) {
        console.error(`[cli] Input file not found: ${inputPath}`);
        process.exit(1);
      }

      const inputLines = fs.readFileSync(inputPath, "utf-8").split("\n").filter(Boolean);
      const items: Array<{ id: number; text: string; expected?: Entity[] }> = [];

      for (const line of inputLines) {
        const row = JSON.parse(line) as JsonlRow;
        const expected: Entity[] | undefined = row.expected_entities
          ? row.expected_entities
              .filter((e) => e.type && e.value)
              .map((e) => ({
                type: isValidEntityType(e.type) ? e.type : ("person" as const),
                value: e.value,
              }))
          : undefined;
        items.push({ id: row.id, text: row.text, expected });
      }

      console.info(`[cli] Loaded ${items.length} items from ${inputPath}`);

      const { results, stats } = await runBatch(items);

      // Write results
      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const outputLines = results.map((r) => JSON.stringify(r));
      fs.writeFileSync(outputPath, outputLines.join("\n") + "\n");

      // Print summary
      console.info(`\n${"=".repeat(60)}`);
      console.info("Pipeline Summary");
      console.info("=".repeat(60));
      console.info(`Total queries:     ${stats.total_queries}`);
      console.info(`Micro only:        ${stats.micro_only}`);
      console.info(`LLM fallback:      ${stats.llm_fallback}`);
      console.info(`Total LLM calls:   ${stats.total_llm_calls}`);
      console.info(`Total latency:     ${stats.total_latency_ms}ms`);
      console.info(`Avg latency:       ${stats.avg_latency_ms}ms`);
      console.info(`Avg micro latency: ${stats.avg_micro_latency_ms}ms`);
      console.info(`Avg LLM latency:   ${stats.avg_llm_latency_ms}ms`);
      console.info(`\nResults written to: ${outputPath}`);
      return;
    }

    // No valid args
    console.error("Usage:");
    console.error("  npx ts-node scripts/two-level-pipeline.ts --text \"Иван Петров приехал в Москву\"");
    console.error("  npx ts-node scripts/two-level-pipeline.ts --input data/ner-testset.jsonl --output results/two-level-results.jsonl");
    process.exit(1);
  })();
}

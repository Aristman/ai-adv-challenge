/**
 * Self-check approach for NER validation.
 *
 * The model extracts entities from text, then verifies its own extraction
 * by re-examining the original text alongside the extracted entities.
 */

import { OllamaClient } from "./ollama-client";

// ─── Interfaces ─────────────────────────────────────────────────────────────

interface Entity {
  type: "person" | "date" | "money" | "email" | "phone" | "location";
  value: string;
}

interface ExtractionResult {
  entities: Entity[];
  rawText: string;
}

interface SelfCheckVerification {
  verified_entities: Entity[];
  removed: Array<{ type: string; value: string; reason: string }>;
  added: Entity[];
  explanation: string;
  confidence: number;
}

interface SelfCheckResult {
  original: ExtractionResult;
  verified_entities: Entity[];
  removed_entities: Entity[];
  added_entities: Entity[];
  explanation: string;
  confidence: number; // 0.0 - 1.0
  self_check_duration_ms: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const ENTITY_TYPES = ["person", "date", "money", "email", "phone", "location"] as const;

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

// ─── Step 1: Extract entities ──────────────────────────────────────────────

async function extractEntities(
  text: string,
  client: OllamaClient,
): Promise<ExtractionResult> {
  const messages = [
    {
      role: "system" as const,
      content: [
        "You are a Named Entity Recognition system. Extract entities from the text.",
        "Entity types: person, date, money, email, phone, location.",
        'Return JSON: {"entities": [{"type": "...", "value": "..."}]}',
        'If no entities found, return {"entities": []}',
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: text,
    },
  ];

  const { data } = await client.chatJSON<{ entities: unknown[] }>(messages, {
    format: "json",
  });

  const entities = sanitizeEntities(data.entities ?? []);

  return { entities, rawText: text };
}

// ─── Step 2: Self-check verification ───────────────────────────────────────

async function verifyExtraction(
  text: string,
  extraction: ExtractionResult,
  client: OllamaClient,
): Promise<SelfCheckVerification> {
  const messages = [
    {
      role: "system" as const,
      content: [
        "You are a verification system for Named Entity Recognition.",
        "You will receive the original text and entities that were extracted from it.",
        "Your task:",
        "1. Check each entity: does the value actually appear in the text? Is the type correct?",
        "2. Check for missed entities: are there any entities in the text that were not extracted?",
        "3. Return your verdict.",
        "",
        "Return JSON:",
        '{',
        '  "verified_entities": [{"type": "...", "value": "..."}],',
        '  "removed": [{"type": "...", "value": "...", "reason": "..."}],',
        '  "added": [{"type": "...", "value": "..."}],',
        '  "explanation": "...",',
        '  "confidence": 0.0-1.0',
        "}",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: [
        `Original text: ${text}`,
        `Extracted entities: ${JSON.stringify(extraction.entities)}`,
      ].join("\n"),
    },
  ];

  const { data } = await client.chatJSON<SelfCheckVerification>(messages, {
    format: "json",
  });

  const verifiedEntities = sanitizeEntities(data.verified_entities ?? []);
  const addedEntities = sanitizeEntities(data.added ?? []);
  const confidence = typeof data.confidence === "number"
    ? Math.max(0, Math.min(1, data.confidence))
    : 0.5;

  return {
    verified_entities: verifiedEntities,
    removed: data.removed ?? [],
    added: addedEntities,
    explanation: String(data.explanation ?? ""),
    confidence,
  };
}

// ─── Main function ──────────────────────────────────────────────────────────

async function selfCheck(
  text: string,
  client: OllamaClient,
): Promise<SelfCheckResult> {
  const startTime = performance.now();

  try {
    // Step 1: Extract
    console.info("[self-check] Step 1: Extracting entities...");
    const extraction = await extractEntities(text, client);
    console.info(
      `[self-check] Extracted ${extraction.entities.length} entities`,
    );

    // Step 2: Verify
    console.info("[self-check] Step 2: Running self-verification...");
    const verification = await verifyExtraction(text, extraction, client);

    const endTime = performance.now();
    const durationMs = Math.round(endTime - startTime);

    console.info(
      `[self-check] Verified ${verification.verified_entities.length} entities, ` +
        `confidence=${verification.confidence.toFixed(2)}, ` +
        `duration=${durationMs}ms`,
    );

    return {
      original: extraction,
      verified_entities: verification.verified_entities,
      removed_entities: verification.removed.map((r) => ({
        type: (isValidEntityType(r.type) ? r.type : "person") as Entity["type"],
        value: r.value,
      })),
      added_entities: verification.added,
      explanation: verification.explanation,
      confidence: verification.confidence,
      self_check_duration_ms: durationMs,
    };
  } catch (err) {
    const endTime = performance.now();
    const durationMs = Math.round(endTime - startTime);

    console.error(
      "[self-check] Error during self-check:",
      err instanceof Error ? err.message : String(err),
    );

    return {
      original: { entities: [], rawText: text },
      verified_entities: [],
      removed_entities: [],
      added_entities: [],
      explanation: `Self-check failed: ${err instanceof Error ? err.message : String(err)}`,
      confidence: 0.0,
      self_check_duration_ms: durationMs,
    };
  }
}

// ─── Demo (run directly) ───────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-require-imports
if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    let textIndex = args.indexOf("--text");

    let inputText: string;
    if (textIndex !== -1 && args[textIndex + 1]) {
      inputText = args[textIndex + 1];
    } else {
      inputText = "Иван Петров приехал в Москву 15 марта 2025 года.";
    }

    console.info(`[self-check] Input text: "${inputText}"`);

    const client = new OllamaClient({ model: "phi4:14b" });

    const healthy = await client.healthCheck();
    if (!healthy) {
      console.error("[self-check] Ollama is not available. Exiting.");
      process.exit(1);
    }

    const result = await selfCheck(inputText, client);

    console.info("\n=== Self-Check Results ===");
    console.info("Original entities:", JSON.stringify(result.original.entities, null, 2));
    console.info("Verified entities:", JSON.stringify(result.verified_entities, null, 2));
    console.info("Removed entities:", JSON.stringify(result.removed_entities, null, 2));
    console.info("Added entities:", JSON.stringify(result.added_entities, null, 2));
    console.info(`Confidence: ${result.confidence.toFixed(2)}`);
    console.info(`Explanation: ${result.explanation}`);
    console.info(`Duration: ${result.self_check_duration_ms}ms`);
  })();
}

export { selfCheck };
export type { Entity, ExtractionResult, SelfCheckResult, SelfCheckVerification };

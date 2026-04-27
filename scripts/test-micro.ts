/**
 * Quick test of micro-model against all NER examples.
 * Run: npx ts-node scripts/test-micro.ts
 */

import * as fs from "fs";
import { extractMicro } from "./micro-model";

interface ExpectedEntity {
  type: string;
  value: string;
}

interface TestItem {
  id: number;
  category: string;
  text: string;
  expected_entities: ExpectedEntity[];
}

async function main(): Promise<void> {
  const raw = fs.readFileSync("data/ner-testset.jsonl", "utf-8");
  const items: TestItem[] = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  let ok = 0;
  let unsure = 0;
  let empty = 0;
  let exact = 0;
  let partial = 0;
  let total = 0;

  const details: string[] = [];

  for (const item of items) {
    const result = await extractMicro(item.text);
    total++;

    if (result.status === "OK") ok++;
    else if (result.status === "UNSURE") unsure++;
    else empty++;

    const expectedSet = new Set(
      item.expected_entities.map((e: ExpectedEntity) => `${e.type}:${e.value}`),
    );
    const actualSet = new Set(
      result.entities.map((e) => `${e.type}:${e.value}`),
    );

    const matchCount = [...expectedSet].filter((e) => actualSet.has(e)).length;

    if (
      matchCount === expectedSet.size &&
      expectedSet.size > 0 &&
      matchCount === actualSet.size
    ) {
      exact++;
    } else if (matchCount > 0) {
      partial++;
    }

    const sym = result.status === "OK" ? "✓" : result.status === "UNSURE" ? "⚠" : "·";
    details.push(
      `[${sym}] id=${String(item.id).padStart(2)} cat=${item.category.padEnd(8)} ` +
        `conf=${result.confidence.toFixed(2)} ${result.status.padEnd(6)} ` +
        `found=${result.entities.length} expected=${item.expected_entities.length} ` +
        `match=${matchCount}`,
    );
  }

  for (const d of details) {
    console.log(d);
  }

  console.log("\n=== Summary ===");
  console.log(`Total:    ${total}`);
  console.log(`OK:       ${ok} (${(ok / total * 100).toFixed(1)}%)`);
  console.log(`UNSURE:   ${unsure} (${(unsure / total * 100).toFixed(1)}%)`);
  console.log(`EMPTY:    ${empty} (${(empty / total * 100).toFixed(1)}%)`);
  console.log(`Exact:    ${exact} (${(exact / total * 100).toFixed(1)}%)`);
  console.log(`Partial:  ${partial} (${(partial / total * 100).toFixed(1)}%)`);
}

main().catch((err: unknown) => {
  console.error("Error:", err);
  process.exit(1);
});

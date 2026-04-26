import * as fs from "fs";
import * as path from "path";

// --- Types ---

interface Message {
  role: string;
  content: string;
}

interface DatasetRow {
  messages: Message[];
}

interface ValidationError {
  line: number;
  reason: string;
}

interface ValidationStats {
  total: number;
  valid: number;
  invalid: number;
  duplicates: number;
  minContentLength: number;
  maxContentLength: number;
  roleDistribution: Record<string, number>;
}

// --- Helpers ---

function parseArgs(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const value = argv[i + 1] ?? "";
      args.set(key, value);
      i++;
    }
  }
  return args;
}

function computeStats(
  lines: DatasetRow[],
  errors: ValidationError[]
): ValidationStats {
  const validLines = lines.filter((_, idx) => {
    return !errors.some((e) => e.line === idx);
  });

  const assistantContents = validLines
    .map((row) => {
      const assistant = row.messages.find((m) => m.role === "assistant");
      return assistant?.content ?? "";
    })
    .filter((c) => c.length > 0);

  const duplicateSet = new Set<string>();
  let duplicateCount = 0;
  for (const content of assistantContents) {
    if (duplicateSet.has(content)) {
      duplicateCount++;
    } else {
      duplicateSet.add(content);
    }
  }

  const allContents = validLines.flatMap((row) =>
    row.messages.map((m) => m.content)
  );
  const lengths = allContents.map((c) => c.length);
  const minContentLength = lengths.length > 0 ? Math.min(...lengths) : 0;
  const maxContentLength = lengths.length > 0 ? Math.max(...lengths) : 0;

  const roleDistribution: Record<string, number> = {};
  for (const row of validLines) {
    for (const msg of row.messages) {
      roleDistribution[msg.role] = (roleDistribution[msg.role] ?? 0) + 1;
    }
  }

  return {
    total: lines.length,
    valid: validLines.length,
    invalid: errors.length,
    duplicates: duplicateCount,
    minContentLength,
    maxContentLength,
    roleDistribution,
  };
}

// --- Validation ---

function validateLine(
  raw: string,
  lineIndex: number,
  lineNum: number,
  seenAssistantContents: Set<string>
): ValidationError | null {
  // 1. Valid JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { line: lineIndex, reason: "invalid JSON" };
  }

  // 2. "messages" field exists and is an array
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as Record<string, unknown>).messages)
  ) {
    return { line: lineIndex, reason: "'messages' missing or not an array" };
  }

  const row = parsed as DatasetRow;
  const messages = row.messages;

  // 3. Roles in order: system, user, assistant
  const expectedRoles = ["system", "user", "assistant"];
  if (messages.length !== 3) {
    return { line: lineIndex, reason: `expected 3 messages, got ${messages.length}` };
  }
  for (let i = 0; i < 3; i++) {
    if (messages[i].role !== expectedRoles[i]) {
      return {
        line: lineIndex,
        reason: `expected role '${expectedRoles[i]}' at position ${i}, got '${messages[i].role}'`,
      };
    }
  }

  // 4. All content non-empty and not null
  for (const msg of messages) {
    if (msg.content === null || msg.content === undefined || msg.content === "") {
      return {
        line: lineIndex,
        reason: `${msg.role} content is empty or null`,
      };
    }
  }

  // 5. No duplicates (by assistant content)
  const assistantContent = messages[2].content;
  if (seenAssistantContents.has(assistantContent)) {
    return {
      line: lineIndex,
      reason: "duplicate assistant content",
    };
  }
  seenAssistantContents.add(assistantContent);

  // 6. Minimum content length >= 10 characters
  for (const msg of messages) {
    if (msg.content.length < 10) {
      return {
        line: lineIndex,
        reason: `${msg.role} content length ${msg.content.length} < 10`,
      };
    }
  }

  return null;
}

// --- Main ---

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const inputPath = args.get("input");

  if (!inputPath) {
    console.error("Usage: npx ts-node scripts/validate.ts --input <path>");
    process.exit(1);
  }

  const resolvedPath = path.resolve(inputPath);

  if (!fs.existsSync(resolvedPath)) {
    console.error(`File not found: ${resolvedPath}`);
    process.exit(1);
  }

  console.info(`Validating ${inputPath}...`);

  const rawContent = fs.readFileSync(resolvedPath, "utf-8");
  const rawLines = rawContent
    .split("\n")
    .filter((line) => line.trim().length > 0);

  const totalLines = rawLines.length;
  const errors: ValidationError[] = [];
  const seenAssistantContents = new Set<string>();
  const parsedRows: DatasetRow[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const lineNum = i + 1;
    const error = validateLine(raw, i, lineNum, seenAssistantContents);

    if (error) {
      errors.push(error);
      console.info(`[${lineNum}/${totalLines}] FAIL: ${error.reason}`);
    } else {
      parsedRows.push(JSON.parse(raw) as DatasetRow);
      console.info(`[${lineNum}/${totalLines}] PASS`);
    }
  }

  // Compute stats
  const stats = computeStats(parsedRows, errors);

  console.info("");
  console.info(`✓ Valid lines: ${stats.valid}/${stats.total}`);
  console.info(`✗ Invalid lines: ${stats.invalid}/${stats.total}`);
  console.info(`✓ Duplicates: ${stats.duplicates}`);
  console.info(`✓ Min content length: ${stats.minContentLength}`);
  console.info(`✓ Max content length: ${stats.maxContentLength}`);

  // Role distribution
  const roleKeys = Object.keys(stats.roleDistribution).sort();
  if (roleKeys.length > 0) {
    const roleParts = roleKeys.map((r) => `${r}: ${stats.roleDistribution[r]}`);
    console.info(`  Roles: ${roleParts.join(", ")}`);
  }

  console.info("");

  if (stats.invalid > 0) {
    console.info(`RESULT: FAIL (${stats.invalid} errors found)`);
    process.exit(1);
  } else {
    console.info("RESULT: PASS (all lines valid)");
    process.exit(0);
  }
}

main().catch((err: unknown) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});

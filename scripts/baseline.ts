import * as fs from "fs";
import * as path from "path";
import OpenAI from "openai";

// --- Types ---

interface EvalMessage {
  role: string;
  content: string;
}

interface EvalRow {
  messages: EvalMessage[];
}

interface BaselineResult {
  id: number;
  user: string;
  expected: string;
  model: string;
  model_response: string;
  error?: string;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Main ---

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const inputPath = args.get("input");
  const outputPath = args.get("output");

  if (!inputPath || !outputPath) {
    console.error(
      "Usage: npx ts-node scripts/baseline.ts --input <path> --output <path>"
    );
    process.exit(1);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("Error: OPENAI_API_KEY environment variable is not set");
    process.exit(1);
  }

  const resolvedInput = path.resolve(inputPath);
  const resolvedOutput = path.resolve(outputPath);

  if (!fs.existsSync(resolvedInput)) {
    console.error(`File not found: ${resolvedInput}`);
    process.exit(1);
  }

  // Ensure output directory exists
  const outputDir = path.dirname(resolvedOutput);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Read eval data
  const rawContent = fs.readFileSync(resolvedInput, "utf-8");
  const rawLines = rawContent
    .split("\n")
    .filter((line) => line.trim().length > 0);

  const evalRows: EvalRow[] = rawLines.map((line) => JSON.parse(line) as EvalRow);
  const totalExamples = evalRows.length;

  console.info(`Loaded ${totalExamples} examples from ${inputPath}`);

  const client = new OpenAI({ apiKey });
  const results: BaselineResult[] = [];

  for (let i = 0; i < evalRows.length; i++) {
    const row = evalRows[i];
    const id = i + 1;
    const userMessage = row.messages.find((m) => m.role === "user");
    const assistantMessage = row.messages.find((m) => m.role === "assistant");

    if (!userMessage || !assistantMessage) {
      console.warn(`[${id}/${totalExamples}] SKIP: missing user or assistant message`);
      continue;
    }

    const result: BaselineResult = {
      id,
      user: userMessage.content,
      expected: assistantMessage.content,
      model: "gpt-4o-mini",
      model_response: "",
    };

    try {
      // Baseline intentionally omits the system prompt to measure the model's raw ability
      // without style/format guidance. The fine-tuned model has these patterns baked in
      // from training data, so comparing "raw" vs "fine-tuned" is meaningful.
      const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0,
        messages: [
          { role: "user", content: userMessage.content },
        ],
      });

      const modelResponse = response.choices[0]?.message?.content ?? "";
      result.model_response = modelResponse;
      console.info(`[${id}/${totalExamples}] OK`);
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : String(err);
      result.error = errorMessage;
      console.error(`[${id}/${totalExamples}] ERROR: ${errorMessage}`);
    }

    results.push(result);

    // Rate limiting: 1 second between requests
    if (i < evalRows.length - 1) {
      await sleep(1000);
    }
  }

  // Write results
  const outputLines = results.map((r) => JSON.stringify(r));
  fs.writeFileSync(resolvedOutput, outputLines.join("\n") + "\n", "utf-8");

  console.info(`\nResults saved to ${outputPath}`);
  console.info(`Total: ${results.length} responses`);

  const okCount = results.filter((r) => !r.error).length;
  const errorCount = results.filter((r) => r.error).length;
  console.info(`  OK: ${okCount}, Errors: ${errorCount}`);
}

main().catch((err: unknown) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});

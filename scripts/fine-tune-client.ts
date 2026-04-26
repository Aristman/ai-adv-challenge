import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import OpenAI from "openai";

// --- Types ---

interface FineTuneJobStatus {
  id: string;
  status: string;
  fineTunedModel: string | null;
  error: string | null;
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

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 2000
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const isRateLimit =
        err instanceof Error && err.message.includes("rate_limit");
      if (isRateLimit && attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        console.info(`  Rate limited, retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`);
        await sleep(delay);
      } else {
        throw err;
      }
    }
  }
  throw lastError;
}

// --- Steps ---

async function validateFile(filePath: string): Promise<void> {
  const scriptPath = path.resolve(__dirname, "validate.ts");
  try {
    const output = execSync(
      `npx ts-node "${scriptPath}" --input "${filePath}"`,
      { encoding: "utf-8", stdio: "pipe" }
    );
    // Extract line count from validation output
    const match = output.match(/Valid lines:\s*(\d+)/);
    const lineCount = match ? match[1] : "?";
    console.info(`  ✓ Validation passed (${lineCount} lines)`);
  } catch (err: unknown) {
    const stderr =
      err instanceof Error && "stderr" in err
        ? (err as { stderr: string }).stderr
        : String(err);
    console.error(`  ✗ Validation failed:\n${stderr}`);
    throw new Error(`Validation failed for ${filePath}`);
  }
}

async function uploadFile(
  client: OpenAI,
  filePath: string
): Promise<{ fileId: string; exampleCount: number }> {
  const rawContent = fs.readFileSync(filePath, "utf-8");
  const lineCount = rawContent
    .split("\n")
    .filter((line) => line.trim().length > 0).length;

  const fileStream = fs.createReadStream(filePath);

  const file = await retryWithBackoff(() =>
    client.files.create({
      file: fileStream,
      purpose: "fine-tune",
    })
  );

  console.info(`  ✓ File uploaded: ${file.id} (${lineCount} examples)`);
  return { fileId: file.id, exampleCount: lineCount };
}

async function createFineTuningJob(
  client: OpenAI,
  fileId: string,
  model: string
): Promise<{ jobId: string }> {
  const job = await retryWithBackoff(() =>
    client.fineTuning.jobs.create({
      training_file: fileId,
      model: model,
    })
  );

  console.info(`  ✓ Job created: ${job.id}`);
  console.info(`  Model: ${model}`);

  // Estimated cost (gpt-4o-mini fine-tuning: ~$3/million tokens training)
  console.info(`  Estimated cost: ~$0.85`);

  return { jobId: job.id };
}

async function monitorJob(
  client: OpenAI,
  jobId: string,
  pollIntervalMs: number = 30000
): Promise<string> {
  console.info("");

  while (true) {
    const job = await client.fineTuning.jobs.retrieve(jobId);

    const elapsedLabel = `${pollIntervalMs / 1000}s`;
    const statusStr = job.status;

    if (statusStr === "succeeded") {
      const modelId = job.fine_tuned_model ?? "unknown";
      console.info(`  [${elapsedLabel}] Status: succeeded`);
      return modelId;
    }

    if (statusStr === "failed" || statusStr === "cancelled") {
      const errorMsg = job.error?.message ?? "unknown error";
      console.error(`  [${elapsedLabel}] Status: ${statusStr} — ${errorMsg}`);
      throw new Error(`Fine-tuning job ${statusStr}: ${errorMsg}`);
    }

    // Extract progress if available
    let progressInfo = "";
    if (job.fine_tuning_job) {
      const ftJob = job.fine_tuning_job;
      if (ftJob.current_epoch && ftJob.total_epochs) {
        progressInfo = ` (epoch ${ftJob.current_epoch}/${ftJob.total_epochs})`;
      }
    }

    console.info(`  [${elapsedLabel}] Status: ${statusStr}${progressInfo}`);
    await sleep(pollIntervalMs);
  }
}

async function checkJobStatus(client: OpenAI, jobId: string): Promise<void> {
  console.info(`Checking status of job: ${jobId}`);

  try {
    const job = await client.fineTuning.jobs.retrieve(jobId);
    console.info(`  Status: ${job.status}`);

    if (job.fine_tuned_model) {
      console.info(`  Fine-tuned model: ${job.fine_tuned_model}`);
    }

    if (job.error) {
      console.error(`  Error: ${job.error.message}`);
    }

    if (job.fine_tuning_job) {
      const ftJob = job.fine_tuning_job;
      if (ftJob.current_epoch && ftJob.total_epochs) {
        console.info(`  Epoch: ${ftJob.current_epoch}/${ftJob.total_epochs}`);
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  Failed to retrieve job: ${message}`);
    process.exit(1);
  }
}

// --- Main ---

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const filePath = args.get("file");
  const statusJobId = args.get("status");

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("Error: OPENAI_API_KEY environment variable is not set");
    process.exit(1);
  }

  const client = new OpenAI({ apiKey });

  // --status mode: just check job status
  if (statusJobId) {
    await checkJobStatus(client, statusJobId);
    return;
  }

  // Normal mode: validate → upload → create job → monitor
  if (!filePath) {
    console.error(
      "Usage:\n" +
        "  npx ts-node scripts/fine-tune-client.ts --file <path>\n" +
        "  npx ts-node scripts/fine-tune-client.ts --status <job_id>"
    );
    process.exit(1);
  }

  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`File not found: ${resolvedPath}`);
    process.exit(1);
  }

  const model = "gpt-4o-mini-2024-07-18";

  // Step 1: Validate
  console.info("Step 1/4: Validating data/dataset.jsonl...");
  await validateFile(resolvedPath);

  // Step 2: Upload
  console.info("\nStep 2/4: Uploading file...");
  const { fileId } = await uploadFile(client, resolvedPath);

  // Step 3: Create fine-tuning job
  console.info("\nStep 3/4: Creating fine-tuning job...");
  const { jobId } = await createFineTuningJob(client, fileId, model);

  // Step 4: Monitor
  console.info("\nStep 4/4: Monitoring progress...");
  const fineTunedModel = await monitorJob(client, jobId);

  console.info("");
  console.info("✓ Fine-tuning complete!");
  console.info(`  Fine-tuned model: ${fineTunedModel}`);
}

main().catch((err: unknown) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});

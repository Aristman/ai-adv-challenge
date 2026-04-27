import { spawn, type ChildProcess } from "node:child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LlamaServerConfig {
  serverPath?: string; // default: ~/llama.cpp/build/bin/llama-server
  modelPath?: string; // default: ~/llm/models/Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf
  port?: number; // default: 8081
  host?: string; // default: 127.0.0.1
  ngl?: number; // default: 28 (GPU layers)
  ctxSize?: number; // default: 4096
}

interface LlamaServerStatus {
  running: boolean;
  port: number;
  pid?: number;
  modelLoaded: boolean;
  uptimeSeconds?: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_SERVER_PATH = "~/llama.cpp/build/bin/llama-server";
const DEFAULT_MODEL_PATH =
  "~/llm/models/Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf";
const DEFAULT_PORT = 8081;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_NGL = 28;
const DEFAULT_CTX_SIZE = 4096;
const HEALTH_POLL_INTERVAL_MS = 1000;
const DEFAULT_START_TIMEOUT_MS = 120_000; // 2 minutes — large model
const STOP_GRACE_MS = 5000;
const THREADS = 8;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Expand leading ~/ to the user's home directory. */
function expandHome(p: string): string {
  if (p.startsWith("~/")) {
    const home = process.env.HOME ?? process.env.USERPROFILE;
    if (home) {
      return home + p.slice(1);
    }
  }
  return p;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// LlamaServerManager
// ---------------------------------------------------------------------------

class LlamaServerManager {
  private readonly serverPath: string;
  private readonly modelPath: string;
  private readonly port: number;
  private readonly host: string;
  private readonly ngl: number;
  private readonly ctxSize: number;

  private process: ChildProcess | null = null;
  private startTime: number | null = null;

  constructor(config?: LlamaServerConfig) {
    this.serverPath = expandHome(
      config?.serverPath ?? DEFAULT_SERVER_PATH,
    );
    this.modelPath = expandHome(
      config?.modelPath ?? DEFAULT_MODEL_PATH,
    );
    this.port = config?.port ?? DEFAULT_PORT;
    this.host = config?.host ?? DEFAULT_HOST;
    this.ngl = config?.ngl ?? DEFAULT_NGL;
    this.ctxSize = config?.ctxSize ?? DEFAULT_CTX_SIZE;
  }

  // -----------------------------------------------------------------------
  // start
  // -----------------------------------------------------------------------

  /** Start the llama-server process. Returns once the health check passes. */
  async start(timeoutMs: number = DEFAULT_START_TIMEOUT_MS): Promise<void> {
    // If already running (port occupied), just verify health.
    if (await this.healthCheck()) {
      console.info(
        `[llama-server] Already running on port ${this.port}, skipping start.`,
      );
      return;
    }

    const args = [
      "-m", this.modelPath,
      "-c", String(this.ctxSize),
      "-ngl", String(this.ngl),
      "-np", "1",
      "--cache-ram", "0",
      "--port", String(this.port),
      "--host", this.host,
      "--threads", String(THREADS),
    ];

    console.info(
      `[llama-server] Spawning: ${this.serverPath} ${args.join(" ")}`,
    );

    this.process = spawn(this.serverPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    const pid = this.process.pid;
    if (pid != null) {
      console.info(`[llama-server] PID: ${pid}`);
    }

    // Pipe stdout / stderr for debugging.
    this.process.stdout?.on("data", (chunk: Buffer) => {
      console.info(`[llama-server:stdout] ${chunk.toString("utf-8")}`);
    });

    this.process.stderr?.on("data", (chunk: Buffer) => {
      console.warn(`[llama-server:stderr] ${chunk.toString("utf-8")}`);
    });

    this.process.on("error", (err: Error) => {
      console.error(`[llama-server] Process error: ${err.message}`);
    });

    this.process.on("exit", (code, signal) => {
      const reason = code != null ? `code ${code}` : `signal ${signal}`;
      console.info(`[llama-server] Exited (${reason}).`);
      this.process = null;
      this.startTime = null;
    });

    // Wait for health endpoint.
    this.startTime = Date.now();

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.healthCheck()) {
        console.info(
          `[llama-server] Health check passed after ${((Date.now() - this.startTime) / 1000).toFixed(1)}s.`,
        );
        return;
      }
      await sleep(HEALTH_POLL_INTERVAL_MS);
    }

    // Timeout — kill the process we just spawned.
    console.error(
      `[llama-server] Health check did not pass within ${timeoutMs / 1000}s. Killing process.`,
    );
    await this.stop();
    throw new Error(
      `llama-server failed to start within ${timeoutMs / 1000}s.`,
    );
  }

  // -----------------------------------------------------------------------
  // stop
  // -----------------------------------------------------------------------

  /** Stop the llama-server process (SIGTERM → 5 s → SIGKILL). */
  async stop(): Promise<void> {
    const proc = this.process;
    if (proc == null || proc.exitCode != null) {
      this.process = null;
      this.startTime = null;
      return;
    }

    const pid = proc.pid;
    console.info(`[llama-server] Sending SIGTERM (pid=${pid}).`);
    proc.kill("SIGTERM");

    const exited = await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), STOP_GRACE_MS);
      proc.on("exit", () => {
        clearTimeout(timeout);
        resolve(true);
      });
    });

    if (!exited) {
      console.warn(`[llama-server] Did not exit in ${STOP_GRACE_MS}ms, sending SIGKILL.`);
      proc.kill("SIGKILL");
    }

    this.process = null;
    this.startTime = null;
  }

  // -----------------------------------------------------------------------
  // healthCheck
  // -----------------------------------------------------------------------

  /** Returns true if the health endpoint responds with OK. */
  async healthCheck(): Promise<boolean> {
    try {
      const url = `http://${this.host}:${this.port}/health`;
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // getStatus
  // -----------------------------------------------------------------------

  getStatus(): LlamaServerStatus {
    const running = this.process != null && this.process.exitCode == null;
    const uptimeSeconds =
      this.startTime != null && running
        ? Math.round((Date.now() - this.startTime) / 1000)
        : undefined;

    return {
      running,
      port: this.port,
      pid: this.process?.pid,
      modelLoaded: running,
      uptimeSeconds,
    };
  }

  // -----------------------------------------------------------------------
  // getBaseUrl
  // -----------------------------------------------------------------------

  getBaseUrl(): string {
    return `http://${this.host}:${this.port}`;
  }
}

// ---------------------------------------------------------------------------
// Demo (run directly: npx ts-node scripts/llama-server-manager.ts)
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const mgr = new LlamaServerManager();
  console.info("Starting llama-server...");
  await mgr.start();
  console.info(`Status: ${JSON.stringify(mgr.getStatus())}`);
  await mgr.stop();
  console.info("Server stopped.");
}

// Run demo only when executed directly (ts-node / node).
if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}

export { LlamaServerManager, type LlamaServerConfig, type LlamaServerStatus };

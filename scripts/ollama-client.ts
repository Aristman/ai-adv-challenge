/**
 * Ollama API client — TypeScript, Node.js 24+ built-in fetch
 *
 * Entity types for NER: person, date, money, email, phone, location
 */

// ─── Interfaces ─────────────────────────────────────────────────────────────

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OllamaResponse {
  model: string;
  message: ChatMessage;
  done: boolean;
  total_duration: number;  // nanoseconds
  eval_count: number;
  eval_duration: number;   // nanoseconds
}

interface OllamaClientConfig {
  baseUrl?: string;       // default: http://localhost:11434
  model?: string;         // default: phi4:14b
  timeout?: number;       // default: 60 000 ms
}

interface ChatOptions {
  /** "json" for JSON mode, or a JSON Schema object for structured output */
  format?: "json" | Record<string, unknown>;
  temperature?: number;
}

// ─── Client ─────────────────────────────────────────────────────────────────

class OllamaClient {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeout: number;

  constructor(config?: OllamaClientConfig) {
    this.baseUrl = config?.baseUrl ?? "http://localhost:11434";
    this.model = config?.model ?? "phi4:14b";
    this.timeout = config?.timeout ?? 60_000;
  }

  // ── Core chat method ────────────────────────────────────────────────────

  async chat(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): Promise<OllamaResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: false,
    };

    if (options?.format !== undefined) {
      body.format = options.format;
    }

    if (options?.temperature !== undefined) {
      body.options = { temperature: options.temperature };
    }

    console.info(`[ollama] POST ${this.baseUrl}/api/chat  model=${this.model}`);

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `Ollama API error ${response.status}: ${text}`,
        );
      }

      const data = await response.json() as OllamaResponse;

      console.info(
        `[ollama] done  model=${data.model}  eval_count=${data.eval_count}  ` +
          `eval_duration=${Math.round(data.eval_duration / 1_000_000)}ms`,
      );

      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Structured output helper ────────────────────────────────────────────

  async chatJSON<T>(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): Promise<{
    data: T;
    meta: {
      evalCount: number;
      evalDurationMs: number;
      totalDurationMs: number;
      model: string;
    };
  }> {
    const response = await this.chat(messages, options);

    const raw = response.message.content;
    let parsed: T;

    try {
      parsed = JSON.parse(raw) as T;
    } catch (parseErr) {
      console.error("[ollama] failed to parse JSON from response:", raw);
      throw new Error(
        `Failed to parse JSON from Ollama response: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
      );
    }

    return {
      data: parsed,
      meta: {
        evalCount: response.eval_count,
        evalDurationMs: Math.round(response.eval_duration / 1_000_000),
        totalDurationMs: Math.round(response.total_duration / 1_000_000),
        model: response.model,
      },
    };
  }

  // ── Health check ────────────────────────────────────────────────────────

  async healthCheck(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: controller.signal,
      });

      return response.ok;
    } catch (err) {
      console.error("[ollama] health check failed:", err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ─── Demo (run directly) ───────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-require-imports
if (require.main === module) {
  (async () => {
    const client = new OllamaClient({ model: "phi4:14b" });

    const healthy = await client.healthCheck();
    console.info(`Ollama health: ${healthy}`);

    if (!healthy) {
      console.error("Ollama is not available. Exiting.");
      process.exit(1);
    }

    const result = await client.chatJSON<{ test: string }>(
      [
        { role: "user", content: "Return JSON: {\"test\": \"hello\"}" },
      ],
      { format: "json" },
    );

    console.info(JSON.stringify(result, null, 2));
  })();
}

export { OllamaClient };
export type { ChatMessage, ChatOptions, OllamaClientConfig, OllamaResponse };

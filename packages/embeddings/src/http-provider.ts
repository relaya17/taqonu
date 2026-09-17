import type { EmbeddingKind, EmbeddingProvider } from "./provider.js";

export interface HttpEmbeddingProviderOptions {
  readonly name: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  readonly dims?: number;
  readonly fetchImpl?: typeof fetch;
}

type EmbeddingsApiItem = {
  readonly embedding?: unknown;
  readonly index?: unknown;
};

type EmbeddingsApiResponse = {
  readonly data?: unknown;
};

function asFiniteVector(value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("embedding provider returned an empty or non-array vector");
  }
  const vec: number[] = [];
  for (const item of value) {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      throw new Error("embedding provider returned a non-finite vector component");
    }
    vec.push(item);
  }
  return vec;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/**
 * OpenAI-compatible `POST /v1/embeddings` client.
 * Works with OpenAI, Ollama (`/v1`), Groq-compatible, and other local servers.
 * This is the production semantic path — not a hash fallback.
 */
export class HttpEmbeddingProvider implements EmbeddingProvider {
  readonly name: string;
  readonly kind: EmbeddingKind = "semantic";
  readonly dims: number | null;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpEmbeddingProviderOptions) {
    this.name = options.name;
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.dims = options.dims ?? null;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async embed(texts: readonly string[]): Promise<readonly number[][]> {
    if (texts.length === 0) return [];
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          input: [...texts],
        }),
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`embedding HTTP ${response.status} from ${this.name}`);
    }

    const json = (await response.json()) as EmbeddingsApiResponse;
    if (!Array.isArray(json.data)) {
      throw new Error(`embedding provider ${this.name} returned no data array`);
    }

    const items = json.data.map((raw) => {
      if (raw == null || typeof raw !== "object") {
        throw new Error(`embedding provider ${this.name} returned a non-object item`);
      }
      const item = raw as EmbeddingsApiItem;
      const index = typeof item.index === "number" ? item.index : Number.NaN;
      return {
        index: Number.isInteger(index) ? index : 0,
        embedding: asFiniteVector(item.embedding),
      };
    });

    items.sort((a, b) => a.index - b.index);
    if (items.length !== texts.length) {
      throw new Error(
        `embedding provider ${this.name} returned ${items.length} vectors for ${texts.length} texts`,
      );
    }
    return items.map((item) => item.embedding);
  }
}

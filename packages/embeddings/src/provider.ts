import { assertNoSecrets } from "@atlas/agent-core";
import { createHash } from "node:crypto";

/** Default local-hash width — must match knowledge_chunks.embedding vector(64). */
export const LOCAL_EMBEDDING_DIMS = 64 as const;

export interface EmbeddingProvider {
  readonly name: string;
  embed(texts: readonly string[]): Promise<readonly number[][]>;
}

/** Provider-agnostic embedding interface. Secrets must never be embedded. */
export async function safeEmbed(
  provider: EmbeddingProvider,
  texts: readonly string[],
): Promise<readonly number[][]> {
  for (const text of texts) {
    assertNoSecrets(text, "embedding");
  }
  return provider.embed(texts);
}

/**
 * Synchronous core of the local hash-trick embedding — same deterministic,
 * pure-computation hash-of-tokens vector `LocalHashEmbeddingProvider` uses,
 * exposed directly (no `Promise`) for callers on a synchronous request path
 * (e.g. `retrieveMemories()` in `@atlas/api`) that cannot `await` the async
 * `EmbeddingProvider` interface — that interface stays `Promise`-returning
 * because it's provider-agnostic and a future provider might do real I/O;
 * this local one never does, so a sync entry point is safe to offer.
 */
export function embedTextLocalSync(
  text: string,
  dims: number = LOCAL_EMBEDDING_DIMS,
): number[] {
  const vec = new Array<number>(dims).fill(0);
  const tokens = text.toLowerCase().split(/[^a-z0-9א-ת]+/i).filter(Boolean);
  for (const tok of tokens) {
    const h = createHash("sha256").update(tok).digest();
    for (let i = 0; i < dims; i += 1) {
      vec[i] = (vec[i] ?? 0) + (h[i % h.length]! / 255 - 0.5);
    }
  }
  const norm = Math.sqrt(vec.reduce((a, b) => a + b * b, 0)) || 1;
  return vec.map((v) => v / norm);
}

/** Deterministic local embedding — hybrid RAG without paid APIs. */
export class LocalHashEmbeddingProvider implements EmbeddingProvider {
  readonly name = "local-hash";
  constructor(private readonly dims: number = LOCAL_EMBEDDING_DIMS) {}

  async embed(texts: readonly string[]): Promise<readonly number[][]> {
    return texts.map((text) => embedTextLocalSync(text, this.dims));
  }
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

const DEFAULT_PROVIDER = new LocalHashEmbeddingProvider();

export function getDefaultEmbeddingProvider(): EmbeddingProvider {
  return DEFAULT_PROVIDER;
}

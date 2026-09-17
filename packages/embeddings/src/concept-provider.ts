import type { EmbeddingKind, EmbeddingProvider } from "./provider.js";

/**
 * Hand-built concept axes for tests and offline ranking proofs.
 * Each cluster is one dimension; synonym tokens share that axis.
 * This is a real (tiny, deterministic) embedding function — not hash-trick
 * vectors pretending to be semantic.
 */
export const DEFAULT_CONCEPT_CLUSTERS: readonly (readonly string[])[] = [
  [
    "login",
    "logins",
    "signin",
    "sign-in",
    "auth",
    "authentication",
    "authorization",
    "credential",
    "credentials",
    "password",
    "session",
    "oauth",
  ],
  [
    "error",
    "broken",
    "fail",
    "fails",
    "failure",
    "throw",
    "throws",
    "exception",
    "crash",
    "bug",
  ],
  ["weather", "forecast", "rain", "temperature", "climate", "sunny"],
  ["webhook", "webhooks", "idempotency", "idempotent"],
  ["payment", "billing", "invoice", "charge", "stripe"],
];

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9א-ת]+/i)
    .filter(Boolean);
}

function l2Normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vec.map((value) => value / norm);
}

/**
 * Deterministic concept-axis embedder. Inject into retrieval tests so
 * synonym-related text ranks above unrelated text via cosine similarity.
 */
export class DeterministicConceptEmbeddingProvider implements EmbeddingProvider {
  readonly name = "concept-axes";
  readonly kind: EmbeddingKind = "semantic";
  readonly dims: number;
  private readonly tokenToAxis: ReadonlyMap<string, number>;

  constructor(clusters: readonly (readonly string[])[] = DEFAULT_CONCEPT_CLUSTERS) {
    const tokenToAxis = new Map<string, number>();
    clusters.forEach((cluster, axis) => {
      for (const token of cluster) {
        tokenToAxis.set(token.toLowerCase(), axis);
      }
    });
    this.tokenToAxis = tokenToAxis;
    this.dims = clusters.length;
  }

  async embed(texts: readonly string[]): Promise<readonly number[][]> {
    return texts.map((text) => {
      const vec = new Array<number>(this.dims).fill(0);
      for (const token of tokenize(text)) {
        const axis = this.tokenToAxis.get(token);
        if (axis !== undefined) {
          vec[axis] = (vec[axis] ?? 0) + 1;
        }
      }
      return l2Normalize(vec);
    });
  }
}

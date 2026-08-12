import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  LocalHashEmbeddingProvider,
  LOCAL_EMBEDDING_DIMS,
  safeEmbed,
} from "./provider.js";

describe("LocalHashEmbeddingProvider", () => {
  it("produces unit vectors of LOCAL_EMBEDDING_DIMS", async () => {
    const provider = new LocalHashEmbeddingProvider();
    const [vec] = await provider.embed(["webhook idempotency key"]);
    expect(vec).toHaveLength(LOCAL_EMBEDDING_DIMS);
    const norm = Math.sqrt((vec ?? []).reduce((a, b) => a + b * b, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("is deterministic for the same text", async () => {
    const provider = new LocalHashEmbeddingProvider();
    const a = await provider.embed(["authz defense"]);
    const b = await provider.embed(["authz defense"]);
    expect(a[0]).toEqual(b[0]);
  });

  it("cosineSimilarity is higher for related phrases", async () => {
    const provider = new LocalHashEmbeddingProvider();
    const [q, close, far] = await provider.embed([
      "webhook idempotency",
      "webhook idempotency keys",
      "typography kerning",
    ]);
    expect(cosineSimilarity(q!, close!)).toBeGreaterThan(
      cosineSimilarity(q!, far!),
    );
  });

  it("safeEmbed rejects secret-like payloads via assertNoSecrets", async () => {
    const provider = new LocalHashEmbeddingProvider();
    await expect(
      safeEmbed(provider, ["api_key=abcdefghijklmnopqrstuvwxyz012345"]),
    ).rejects.toThrow(/Secret detected/);
  });
});

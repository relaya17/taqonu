import { describe, expect, it, vi } from "vitest";
import {
  cosineSimilarity,
  DeterministicConceptEmbeddingProvider,
  HttpEmbeddingProvider,
  LocalHashEmbeddingProvider,
  LOCAL_EMBEDDING_DIMS,
  resolveEmbeddingProvider,
  safeEmbed,
} from "./index.js";

describe("LocalHashEmbeddingProvider", () => {
  it("is labeled lexical-hash, never semantic", async () => {
    const provider = new LocalHashEmbeddingProvider();
    expect(provider.kind).toBe("lexical-hash");
    expect(provider.name).toBe("local-hash");
    expect(provider.dims).toBe(LOCAL_EMBEDDING_DIMS);
  });

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

  it("cosineSimilarity is higher for overlapping hashed tokens, not synonyms", async () => {
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

describe("DeterministicConceptEmbeddingProvider", () => {
  it("is labeled semantic and ranks synonym-related text above unrelated text", async () => {
    const provider = new DeterministicConceptEmbeddingProvider();
    expect(provider.kind).toBe("semantic");
    const [query, related, unrelated] = await provider.embed([
      "user login is broken",
      "authentication flow throws an exception",
      "weather forecast for the weekend",
    ]);
    expect(cosineSimilarity(query!, related!)).toBeGreaterThan(
      cosineSimilarity(query!, unrelated!),
    );
    expect(cosineSimilarity(query!, related!)).toBeGreaterThan(0.5);
  });
});

describe("HttpEmbeddingProvider", () => {
  it("posts to an OpenAI-compatible embeddings endpoint and preserves order", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          data: [
            { index: 1, embedding: [0, 1] },
            { index: 0, embedding: [1, 0] },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const provider = new HttpEmbeddingProvider({
      name: "openai-embeddings",
      baseUrl: "https://api.openai.com/v1",
      model: "text-embedding-3-small",
      apiKey: "sk-test",
      fetchImpl,
    });
    expect(provider.kind).toBe("semantic");
    const vectors = await provider.embed(["alpha", "beta"]);
    expect(vectors).toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://api.openai.com/v1/embeddings");
    expect(init?.method).toBe("POST");
  });

  it("rejects a non-OK HTTP response", async () => {
    const provider = new HttpEmbeddingProvider({
      name: "openai-embeddings",
      baseUrl: "https://api.openai.com/v1",
      model: "text-embedding-3-small",
      apiKey: "sk-test",
      fetchImpl: async () => new Response("nope", { status: 401 }),
    });
    await expect(provider.embed(["hello"])).rejects.toThrow(/HTTP 401/);
  });
});

describe("resolveEmbeddingProvider", () => {
  it("falls back to lexical-hash when nothing is configured", () => {
    const provider = resolveEmbeddingProvider({});
    expect(provider.kind).toBe("lexical-hash");
    expect(provider.name).toBe("local-hash");
  });

  it("does not treat a chat OPENAI_API_KEY as an embedding provider", () => {
    const provider = resolveEmbeddingProvider({ OPENAI_API_KEY: "sk-chat" });
    expect(provider.kind).toBe("lexical-hash");
  });

  it("uses OpenAI-compatible HTTP embeddings when explicitly selected", () => {
    const provider = resolveEmbeddingProvider({
      ATLAS_EMBEDDING_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-embed",
    });
    expect(provider.kind).toBe("semantic");
    expect(provider.name).toBe("openai-embeddings");
  });

  it("falls back to hash when openai is selected without a key", () => {
    const provider = resolveEmbeddingProvider({
      ATLAS_EMBEDDING_PROVIDER: "openai",
    });
    expect(provider.kind).toBe("lexical-hash");
  });

  it("uses HTTP embeddings when ATLAS_EMBEDDING_API_KEY is set", () => {
    const provider = resolveEmbeddingProvider({
      ATLAS_EMBEDDING_API_KEY: "sk-embed",
    });
    expect(provider.kind).toBe("semantic");
    expect(provider.name).toBe("http-embeddings");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetKnowledgeCorpusToSeed,
  ingestKnowledgeDocument,
} from "@atlas/knowledge";

const offlineEnv = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "replace-me",
};

const liveEnv = {
  SUPABASE_URL: "https://xyz.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key-longer-than-twenty",
};

describe("hybrid-rag closed loop", () => {
  afterEach(() => {
    resetKnowledgeCorpusToSeed();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("local search returns INSUFFICIENT_EVIDENCE when nothing matches", async () => {
    const { searchKnowledgeClosedLoop } = await import("./hybrid-rag.js");
    const result = await searchKnowledgeClosedLoop(offlineEnv, {
      query: "zzzz-no-such-topic-xyz",
      minAuthority: 0.99,
    });
    expect(result.hits).toHaveLength(0);
    expect(result.retrievalBackend).toBe("local");
    expect(result.plainLanguage).toMatch(/INSUFFICIENT_EVIDENCE/);
  });

  it("offline ingest writes file corpus and reports pgvector=false", async () => {
    const { ingestKnowledgeClosedLoop } = await import("./hybrid-rag.js");
    const { document, pgvector } = await ingestKnowledgeClosedLoop(offlineEnv, {
      title: "Hybrid RAG test chunk",
      excerpt: "Closed-loop dual-write verification excerpt.",
      sourceClass: "REPOSITORY_SOURCE",
    });
    expect(document.id.startsWith("kf_")).toBe(true);
    expect(pgvector).toBe(false);
    expect(document.embedding?.length).toBe(64);
  });

  it("live empty pgvector answer stays INSUFFICIENT_EVIDENCE (no local invent)", async () => {
    vi.doMock("@atlas/database", async () => {
      const actual = await vi.importActual<typeof import("@atlas/database")>(
        "@atlas/database",
      );
      return {
        ...actual,
        isLiveKnowledgeStore: () => true,
        tryHybridSearchKnowledgeChunks: vi.fn().mockResolvedValue([]),
        tryPersistKnowledgeChunk: vi.fn().mockResolvedValue(null),
      };
    });
    const { searchKnowledgeClosedLoop } = await import("./hybrid-rag.js");
    const result = await searchKnowledgeClosedLoop(liveEnv, {
      query: "webhook idempotency",
    });
    expect(result.hits).toHaveLength(0);
    expect(result.retrievalBackend).toBe("pgvector");
    expect(result.plainLanguage).toMatch(/INSUFFICIENT_EVIDENCE/);
  });

  it("live pgvector hits merge similarity+keyword into fabric scores", async () => {
    ingestKnowledgeDocument({
      title: "seed keep",
      excerpt: "placeholder",
      sourceClass: "REPOSITORY_SOURCE",
    });
    vi.doMock("@atlas/database", async () => {
      const actual = await vi.importActual<typeof import("@atlas/database")>(
        "@atlas/database",
      );
      return {
        ...actual,
        isLiveKnowledgeStore: () => true,
        tryHybridSearchKnowledgeChunks: vi.fn().mockResolvedValue([
          {
            id: "kf_pg",
            title: "Webhook idempotency lesson",
            excerpt: "Use idempotency keys on external webhooks.",
            sourceClass: "REPOSITORY_SOURCE",
            url: null,
            sourceUpdatedAt: "2026-08-12T00:00:00.000Z",
            projectScoped: false,
            contentHash: "pghash01",
            embedding: Array.from({ length: 64 }, () => 0.01),
            embeddingProvider: "local-hash",
            embeddingDims: 64,
            metadata: {},
            similarity: 0.8,
            keywordRank: 0.2,
          },
        ]),
        tryPersistKnowledgeChunk: vi.fn().mockResolvedValue(null),
      };
    });
    const { searchKnowledgeClosedLoop } = await import("./hybrid-rag.js");
    const result = await searchKnowledgeClosedLoop(liveEnv, {
      query: "webhook idempotency",
      minAuthority: 0.3,
    });
    expect(result.retrievalBackend).toBe("pgvector");
    expect(result.hits.some((h) => h.id === "kf_pg")).toBe(true);
  });
});

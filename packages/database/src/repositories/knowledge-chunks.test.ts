import { describe, expect, it, vi } from "vitest";
import {
  KnowledgeChunkRepository,
  KNOWLEDGE_EMBEDDING_DIMS,
} from "./knowledge-chunks.js";

function vec(seed: number): number[] {
  return Array.from({ length: KNOWLEDGE_EMBEDDING_DIMS }, (_, i) =>
    ((seed + i) % 17) / 17 - 0.5,
  );
}

describe("KnowledgeChunkRepository", () => {
  it("upserts with vector literal and maps row back", async () => {
    const embedding = vec(3);
    const upsert = vi.fn().mockReturnValue({
      select: () => ({
        single: async () => ({
          data: {
            id: "kf_abc",
            title: "Webhook idempotency",
            excerpt: "Use idempotency keys",
            source_class: "REPOSITORY_SOURCE",
            url: null,
            source_updated_at: "2026-08-12T00:00:00.000Z",
            project_scoped: false,
            content_hash: "abc",
            embedding: `[${embedding.join(",")}]`,
            embedding_provider: "local-hash",
            embedding_dims: KNOWLEDGE_EMBEDDING_DIMS,
            metadata: {},
          },
          error: null,
        }),
      }),
    });
    const client = {
      from: vi.fn().mockReturnValue({ upsert }),
      rpc: vi.fn(),
    };

    const repo = new KnowledgeChunkRepository(client as never);
    const row = await repo.upsert({
      id: "kf_abc",
      title: "Webhook idempotency",
      excerpt: "Use idempotency keys",
      sourceClass: "REPOSITORY_SOURCE",
      contentHash: "abc",
      embedding,
    });

    expect(client.from).toHaveBeenCalledWith("knowledge_chunks");
    expect(upsert).toHaveBeenCalled();
    const payload = upsert.mock.calls[0]?.[0] as {
      embedding: string;
      source_class: string;
    };
    expect(payload.source_class).toBe("REPOSITORY_SOURCE");
    expect(payload.embedding.startsWith("[")).toBe(true);
    expect(row.id).toBe("kf_abc");
    expect(row.embedding).toHaveLength(KNOWLEDGE_EMBEDDING_DIMS);
  });

  it("rejects wrong embedding dims", async () => {
    const repo = new KnowledgeChunkRepository({
      from: vi.fn(),
      rpc: vi.fn(),
    } as never);
    await expect(
      repo.upsert({
        id: "kf_bad",
        title: "x",
        excerpt: "y",
        sourceClass: "REPOSITORY_SOURCE",
        contentHash: "bad",
        embedding: [0.1, 0.2],
      }),
    ).rejects.toThrow(/dims must be 64/);
  });

  it("matchHybrid maps similarity + keyword_rank", async () => {
    const embedding = vec(1);
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          id: "kf_1",
          title: "AuthZ",
          excerpt: "defense in depth",
          source_class: "REPOSITORY_SOURCE",
          url: null,
          source_updated_at: null,
          project_scoped: false,
          content_hash: "h1",
          embedding,
          similarity: 0.82,
          keyword_rank: 0.1,
        },
      ],
      error: null,
    });
    const repo = new KnowledgeChunkRepository({ from: vi.fn(), rpc } as never);
    const matches = await repo.matchHybrid({
      queryEmbedding: embedding,
      queryText: "authz",
    });
    expect(rpc).toHaveBeenCalledWith(
      "match_knowledge_chunks",
      expect.objectContaining({ query_text: "authz" }),
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.similarity).toBeCloseTo(0.82);
    expect(matches[0]?.keywordRank).toBeCloseTo(0.1);
  });
});

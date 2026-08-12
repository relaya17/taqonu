import type { SupabaseClient } from "@supabase/supabase-js";

/** Local-hash embedding dims — must match migration vector(64) + LocalHashEmbeddingProvider. */
export const KNOWLEDGE_EMBEDDING_DIMS = 64 as const;

export interface KnowledgeChunkRecord {
  readonly id: string;
  readonly title: string;
  readonly excerpt: string;
  readonly sourceClass: string;
  readonly url: string | null;
  readonly sourceUpdatedAt: string | null;
  readonly projectScoped: boolean;
  readonly contentHash: string;
  readonly embedding: number[] | null;
  readonly embeddingProvider: string;
  readonly embeddingDims: number;
  readonly metadata: Record<string, unknown>;
}

export interface KnowledgeChunkMatch extends KnowledgeChunkRecord {
  readonly similarity: number;
  readonly keywordRank: number;
}

function toVectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.join(",")}]`;
}

function parseEmbedding(raw: unknown): number[] | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    return raw.map((n) => Number(n)).filter((n) => Number.isFinite(n));
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim().replace(/^\[/, "").replace(/\]$/, "");
    if (!trimmed) return [];
    return trimmed
      .split(",")
      .map((p) => Number(p.trim()))
      .filter((n) => Number.isFinite(n));
  }
  return null;
}

function mapRow(row: Record<string, unknown>): KnowledgeChunkRecord {
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    excerpt: String(row.excerpt ?? ""),
    sourceClass: String(row.source_class ?? "TECHNICAL_ARTICLE"),
    url: row.url == null ? null : String(row.url),
    sourceUpdatedAt:
      row.source_updated_at == null ? null : String(row.source_updated_at),
    projectScoped: Boolean(row.project_scoped),
    contentHash: String(row.content_hash ?? ""),
    embedding: parseEmbedding(row.embedding),
    embeddingProvider: String(row.embedding_provider ?? "local-hash"),
    embeddingDims: Number(row.embedding_dims ?? KNOWLEDGE_EMBEDDING_DIMS),
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {},
  };
}

export class KnowledgeChunkRepository {
  constructor(private readonly client: SupabaseClient) {}

  async upsert(chunk: {
    id: string;
    title: string;
    excerpt: string;
    sourceClass: string;
    url?: string | null;
    sourceUpdatedAt?: string | null;
    projectScoped?: boolean;
    contentHash: string;
    embedding?: readonly number[] | null;
    embeddingProvider?: string;
    metadata?: Record<string, unknown>;
  }): Promise<KnowledgeChunkRecord> {
    const embedding = chunk.embedding?.length
      ? [...chunk.embedding]
      : null;
    if (embedding && embedding.length !== KNOWLEDGE_EMBEDDING_DIMS) {
      throw new Error(
        `knowledge embedding dims must be ${KNOWLEDGE_EMBEDDING_DIMS}, got ${embedding.length}`,
      );
    }
    const payload = {
      id: chunk.id,
      title: chunk.title,
      excerpt: chunk.excerpt,
      source_class: chunk.sourceClass,
      url: chunk.url ?? null,
      source_updated_at: chunk.sourceUpdatedAt ?? null,
      project_scoped: chunk.projectScoped ?? false,
      content_hash: chunk.contentHash,
      embedding: embedding ? toVectorLiteral(embedding) : null,
      embedding_provider: chunk.embeddingProvider ?? "local-hash",
      embedding_dims: embedding?.length ?? KNOWLEDGE_EMBEDDING_DIMS,
      metadata: chunk.metadata ?? {},
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await this.client
      .from("knowledge_chunks")
      .upsert(payload, { onConflict: "id" })
      .select("*")
      .single();
    if (error) throw error;
    return mapRow(data as Record<string, unknown>);
  }

  async matchHybrid(input: {
    queryEmbedding: readonly number[];
    queryText: string;
    matchThreshold?: number;
    matchCount?: number;
  }): Promise<readonly KnowledgeChunkMatch[]> {
    if (input.queryEmbedding.length !== KNOWLEDGE_EMBEDDING_DIMS) {
      throw new Error(
        `query embedding dims must be ${KNOWLEDGE_EMBEDDING_DIMS}, got ${input.queryEmbedding.length}`,
      );
    }
    const { data, error } = await this.client.rpc("match_knowledge_chunks", {
      query_embedding: toVectorLiteral(input.queryEmbedding),
      query_text: input.queryText,
      match_threshold: input.matchThreshold ?? 0.2,
      match_count: input.matchCount ?? 40,
    });
    if (error) throw error;
    const rows = (data ?? []) as Record<string, unknown>[];
    return rows.map((row) => ({
      ...mapRow(row),
      similarity: Number(row.similarity ?? 0),
      keywordRank: Number(row.keyword_rank ?? 0),
    }));
  }
}

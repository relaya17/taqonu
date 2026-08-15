import type { KnowledgeSearchResult } from "@atlas/shared";
import {
  cosineSimilarity,
  getDefaultEmbeddingProvider,
  safeEmbed,
} from "@atlas/embeddings";
import {
  getKnowledgeCorpusSource,
  ingestKnowledgeDocument,
  listKnowledgeCorpus,
  searchKnowledgeFabric,
  upsertKnowledgeDocument,
  type CorpusDoc,
} from "@atlas/knowledge";
import {
  isLiveKnowledgeStore,
  tryHybridSearchKnowledgeChunks,
  tryPersistKnowledgeChunk,
  type KnowledgeStoreEnv,
} from "@atlas/database";

export type HybridRagEnv = KnowledgeStoreEnv;

function chunkToCorpusDoc(row: {
  id: string;
  title: string;
  excerpt: string;
  sourceClass: string;
  url: string | null;
  sourceUpdatedAt: string | null;
  projectScoped: boolean;
  contentHash: string;
  embedding: number[] | null;
}): CorpusDoc {
  return {
    id: row.id,
    title: row.title,
    excerpt: row.excerpt,
    sourceClass: row.sourceClass,
    url: row.url,
    sourceUpdatedAt: row.sourceUpdatedAt,
    projectScoped: row.projectScoped,
    contentHash: row.contentHash,
    ...(row.embedding?.length ? { embedding: [...row.embedding] } : {}),
  };
}

/** Embed + ingest to file corpus; dual-write to pgvector when live. */
export async function ingestKnowledgeClosedLoop(
  env: HybridRagEnv,
  input: {
    id?: string;
    title: string;
    excerpt: string;
    sourceClass: string;
    url?: string | null;
    sourceUpdatedAt?: string | null;
    projectScoped?: boolean;
  },
): Promise<{
  document: CorpusDoc;
  corpus: "seed" | "persisted";
  pgvector: boolean;
}> {
  const provider = getDefaultEmbeddingProvider();
  const [embedding] = await safeEmbed(provider, [
    `${input.title}\n${input.excerpt}`,
  ]);
  const payload = {
    title: input.title,
    excerpt: input.excerpt,
    sourceClass: input.sourceClass,
    ...(input.url !== undefined ? { url: input.url } : {}),
    ...(input.sourceUpdatedAt !== undefined
      ? { sourceUpdatedAt: input.sourceUpdatedAt }
      : {}),
    ...(input.projectScoped != null
      ? { projectScoped: input.projectScoped }
      : {}),
    ...(embedding ? { embedding: [...embedding] } : {}),
  };
  const doc = input.id
    ? upsertKnowledgeDocument({ id: input.id, ...payload })
    : ingestKnowledgeDocument(payload);

  const cloud = await tryPersistKnowledgeChunk(env, {
    id: doc.id,
    title: doc.title,
    excerpt: doc.excerpt,
    sourceClass: doc.sourceClass,
    url: doc.url,
    sourceUpdatedAt: doc.sourceUpdatedAt,
    projectScoped: doc.projectScoped,
    contentHash: doc.contentHash,
    embedding: doc.embedding ?? embedding ?? null,
    embeddingProvider: provider.name,
  });

  return {
    document: doc,
    corpus: getKnowledgeCorpusSource(),
    pgvector: cloud != null,
  };
}

async function localHybridSearch(input: {
  query: string;
  maxResults?: number;
  minAuthority?: number;
  allowStale?: boolean;
}): Promise<KnowledgeSearchResult> {
  const corpus = listKnowledgeCorpus();
  const provider = getDefaultEmbeddingProvider();
  const texts = [input.query, ...corpus.map((d) => `${d.title}\n${d.excerpt}`)];
  const vectors = await safeEmbed(provider, texts);
  const queryVec = vectors[0] ?? [];
  const vectorScores: Record<string, number> = {};
  corpus.forEach((doc, i) => {
    const cached = doc.embedding;
    const docVec =
      cached && cached.length > 0 ? cached : (vectors[i + 1] ?? []);
    vectorScores[doc.id] = cosineSimilarity(queryVec, docVec);
  });
  return searchKnowledgeFabric({
    query: input.query,
    ...(input.maxResults !== undefined ? { maxResults: input.maxResults } : {}),
    ...(input.minAuthority !== undefined
      ? { minAuthority: input.minAuthority }
      : {}),
    ...(input.allowStale !== undefined ? { allowStale: input.allowStale } : {}),
    vectorScores,
    retrievalBackend: "local",
  });
}

/**
 * Closed-loop hybrid search: prefer pgvector when live; else local embeddings + file corpus.
 * Empty hits → INSUFFICIENT_EVIDENCE (never invent packages).
 */
export async function searchKnowledgeClosedLoop(
  env: HybridRagEnv,
  input: {
    query: string;
    maxResults?: number;
    minAuthority?: number;
    allowStale?: boolean;
  },
): Promise<KnowledgeSearchResult> {
  const provider = getDefaultEmbeddingProvider();
  const [queryEmbedding] = await safeEmbed(provider, [input.query]);
  if (!queryEmbedding || !isLiveKnowledgeStore(env)) {
    return localHybridSearch(input);
  }

  const matches = await tryHybridSearchKnowledgeChunks(env, {
    queryEmbedding,
    queryText: input.query,
    matchThreshold: 0.2,
    matchCount: Math.max((input.maxResults ?? 20) * 3, 40),
  });

  // null = store offline/error → local fallback. [] = live INSUFFICIENT_EVIDENCE.
  if (matches == null) {
    return localHybridSearch(input);
  }

  const corpus = matches.map(chunkToCorpusDoc);
  const vectorScores: Record<string, number> = {};
  for (const m of matches) {
    // Align with match_knowledge_chunks SQL (0.7 cosine + 0.3 keyword); floor
    // keeps FTS-only hits above fabric's 0.35 vector gate.
    const kw = Math.min(1, Math.max(0, m.keywordRank));
    const merged = m.similarity * 0.7 + kw * 0.3;
    const keywordFloor = m.keywordRank > 0 ? 0.4 : 0;
    vectorScores[m.id] = Math.min(1, Math.max(merged, m.similarity, keywordFloor));
  }

  return searchKnowledgeFabric({
    query: input.query,
    ...(input.maxResults !== undefined ? { maxResults: input.maxResults } : {}),
    ...(input.minAuthority !== undefined
      ? { minAuthority: input.minAuthority }
      : {}),
    ...(input.allowStale !== undefined ? { allowStale: input.allowStale } : {}),
    corpus,
    vectorScores,
    retrievalBackend: "pgvector",
  });
}

import { createDatabaseClients } from "./client.js";
import { isLiveSupabase } from "./persist.js";
import {
  KnowledgeChunkRepository,
  type KnowledgeChunkMatch,
  type KnowledgeChunkRecord,
} from "./repositories/knowledge-chunks.js";

export type KnowledgeStoreEnv = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  /** Present for ops/docs; dual-write uses live Supabase (hosts pgvector). */
  DATABASE_URL?: string;
};

function serviceClient(env: KnowledgeStoreEnv) {
  return createDatabaseClients({
    url: env.SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  }).service;
}

/** True when Supabase (and thus pgvector) is configured for dual-write/retrieval. */
export function isLiveKnowledgeStore(env: KnowledgeStoreEnv): boolean {
  return isLiveSupabase(env);
}

/**
 * Dual-write a knowledge chunk + embedding to pgvector when live.
 * Never throws unless `requireSuccess` — file corpus remains the offline fallback.
 */
export async function tryPersistKnowledgeChunk(
  env: KnowledgeStoreEnv,
  chunk: {
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
  },
  options?: { readonly requireSuccess?: boolean },
): Promise<KnowledgeChunkRecord | null> {
  if (!isLiveKnowledgeStore(env)) {
    if (options?.requireSuccess) {
      throw new Error(
        "Knowledge pgvector store is not configured (set live SUPABASE_* / DATABASE_URL)",
      );
    }
    return null;
  }
  try {
    const repo = new KnowledgeChunkRepository(serviceClient(env));
    return await repo.upsert(chunk);
  } catch (error) {
    if (options?.requireSuccess) throw error;
    return null;
  }
}

/**
 * Hybrid (keyword + vector) retrieve from pgvector when live.
 * Returns null when store is offline or the RPC fails — callers fall back to local corpus.
 * Empty array means live store answered with no evidence (INSUFFICIENT_EVIDENCE — do not invent).
 */
export async function tryHybridSearchKnowledgeChunks(
  env: KnowledgeStoreEnv,
  input: {
    queryEmbedding: readonly number[];
    queryText: string;
    matchThreshold?: number;
    matchCount?: number;
    ownerId?: string | null;
    tenantId?: string | null;
    projectId?: string | null;
    applicationId?: string | null;
  },
): Promise<readonly KnowledgeChunkMatch[] | null> {
  if (!isLiveKnowledgeStore(env)) return null;
  try {
    const repo = new KnowledgeChunkRepository(serviceClient(env));
    return await repo.matchHybrid(input);
  } catch {
    return null;
  }
}

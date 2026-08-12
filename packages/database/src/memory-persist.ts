import type { Memory } from "@atlas/shared";
import { createDatabaseClients, createUserScopedClient } from "./client.js";
import { isLiveSupabase } from "./persist.js";
import { MemoryRepository } from "./repositories/memories.js";

export type MemoryStoreEnv = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

function resolveClient(env: MemoryStoreEnv, userAccessToken?: string | null) {
  if (userAccessToken) {
    return createUserScopedClient({
      url: env.SUPABASE_URL,
      anonKey: env.SUPABASE_ANON_KEY,
      accessToken: userAccessToken,
    });
  }
  return createDatabaseClients({
    url: env.SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  }).service;
}

/**
 * Dual-write a memory to Supabase when configured. Mirrors
 * `tryPersistProjectToSupabase` — never throws unless `requireSuccess`;
 * the local `osStore` memories map remains the offline-first source of
 * truth (see `apps/api/src/services/memory-pipeline.ts`).
 */
export async function tryPersistMemoryToSupabase(
  env: MemoryStoreEnv,
  memory: Memory,
  ownerId: string,
  options?: { readonly requireSuccess?: boolean; readonly userAccessToken?: string | null },
): Promise<Memory | null> {
  if (!isLiveSupabase(env)) {
    if (options?.requireSuccess) {
      throw new Error("Cloud database is not configured (set live SUPABASE_* keys)");
    }
    return null;
  }
  try {
    const repo = new MemoryRepository(resolveClient(env, options?.userAccessToken));
    return await repo.create(memory, ownerId);
  } catch (error) {
    if (options?.requireSuccess) throw error;
    return null;
  }
}

/** Mirror an approve transition to the cloud row. Best-effort — never throws. */
export async function tryApproveMemoryInSupabase(
  env: MemoryStoreEnv,
  memoryId: string,
  patch: {
    epistemicState: string;
    observationMode: string;
    confidence: number;
    reason: readonly string[];
    updatedAt: string;
  },
  userAccessToken?: string | null,
): Promise<boolean> {
  if (!isLiveSupabase(env)) return false;
  try {
    const repo = new MemoryRepository(resolveClient(env, userAccessToken));
    return await repo.approve(memoryId, patch);
  } catch {
    return false;
  }
}

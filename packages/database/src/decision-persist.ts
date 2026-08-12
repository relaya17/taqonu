import type { Decision } from "@atlas/shared";
import { createDatabaseClients, createUserScopedClient } from "./client.js";
import { isLiveSupabase } from "./persist.js";
import { DecisionRepository } from "./repositories/decisions.js";

export type DecisionStoreEnv = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

function resolveClient(env: DecisionStoreEnv, userAccessToken?: string | null) {
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
 * Dual-write a decision to Supabase when live. Local osStore remains source of
 * truth; never throws unless `requireSuccess`.
 */
export async function tryPersistDecisionToSupabase(
  env: DecisionStoreEnv,
  decision: Decision,
  ownerId: string,
  options?: { readonly requireSuccess?: boolean; readonly userAccessToken?: string | null },
): Promise<Decision | null> {
  if (!isLiveSupabase(env)) {
    if (options?.requireSuccess) {
      throw new Error("Cloud database is not configured (set live SUPABASE_* keys)");
    }
    return null;
  }
  try {
    const repo = new DecisionRepository(resolveClient(env, options?.userAccessToken));
    return await repo.upsert(decision, ownerId);
  } catch (error) {
    if (options?.requireSuccess) throw error;
    return null;
  }
}

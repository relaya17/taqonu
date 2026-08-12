import { createDatabaseClients, createUserScopedClient } from "./client.js";
import { isLiveSupabase } from "./persist.js";
import {
  AccountPlanRepository,
  type AccountPlanRecord,
} from "./repositories/account-plans.js";

export type AccountPlanStoreEnv = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

function resolveClient(
  env: AccountPlanStoreEnv,
  userAccessToken?: string | null,
) {
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
 * Dual-write freemium/tenant plan to `account_plans` when Supabase is live.
 * Prefer service-role for Stripe webhooks (no user JWT); pass a token when
 * updating from an authenticated settings request.
 */
export async function tryPersistAccountPlanToSupabase(
  env: AccountPlanStoreEnv,
  plan: AccountPlanRecord,
  options?: { readonly requireSuccess?: boolean; readonly userAccessToken?: string | null },
): Promise<AccountPlanRecord | null> {
  if (!isLiveSupabase(env)) {
    if (options?.requireSuccess) {
      throw new Error("Cloud database is not configured (set live SUPABASE_* keys)");
    }
    return null;
  }
  try {
    const repo = new AccountPlanRepository(resolveClient(env, options?.userAccessToken));
    return await repo.upsert(plan);
  } catch (error) {
    if (options?.requireSuccess) throw error;
    return null;
  }
}

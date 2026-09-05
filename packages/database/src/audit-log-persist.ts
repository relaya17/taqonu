import { createDatabaseClients, createUserScopedClient } from "./client.js";
import { isLiveSupabase } from "./persist.js";
import {
  AuditLogRepository,
  type AuditLogAppendInput,
  type AuditLogRow,
} from "./repositories/audit-log.js";

export type AuditLogStoreEnv = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

function resolveClient(env: AuditLogStoreEnv, userAccessToken?: string | null) {
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

export type AuditLogPersistResult =
  | { readonly ok: true; readonly row: AuditLogRow }
  | {
      readonly ok: false;
      readonly reason: "NOT_CONFIGURED" | "WRITE_FAILED";
      readonly error: string | null;
    };

/**
 * Canonical audit dual-write target for the P0 persistence fix.
 *
 * Unlike the other `tryPersistXToSupabase` helpers in this package (which
 * are always best-effort and never throw), this one always reports
 * success/failure back to the caller instead of swallowing it —
 * `apps/api/src/services/audit-log.ts` is the one place that decides
 * whether a Postgres failure here means fail-closed (Vercel production) or
 * degrade-with-NDJSON-secondary (private VM), and it cannot make that
 * decision correctly if the failure is hidden from it here.
 */
export async function persistAuditLogToSupabase(
  env: AuditLogStoreEnv,
  entry: AuditLogAppendInput,
  options?: { readonly userAccessToken?: string | null },
): Promise<AuditLogPersistResult> {
  if (!isLiveSupabase(env)) {
    return { ok: false, reason: "NOT_CONFIGURED", error: null };
  }
  try {
    const repo = new AuditLogRepository(resolveClient(env, options?.userAccessToken));
    const row = await repo.append(entry);
    return { ok: true, row };
  } catch (error) {
    return {
      ok: false,
      reason: "WRITE_FAILED",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

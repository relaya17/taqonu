import { createDatabaseClients } from "./client.js";
import { isLiveSupabase } from "./persist.js";
import {
  GovernedExecutionReceiptRepository,
  type ClaimGovernedExecutionInput,
  type FinalizeGovernedExecutionInput,
  type GovernedExecutionClaim,
  type GovernedExecutionReceiptRow,
} from "./repositories/governed-execution-receipt.js";

export type GovernedExecutionReceiptStoreEnv = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

function resolveServiceClient(env: GovernedExecutionReceiptStoreEnv) {
  // Service-role only, deliberately: this table has no owner-scoped policy
  // at all (see the migration) -- there is no user-scoped variant to offer.
  return createDatabaseClients({
    url: env.SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  }).service;
}

export type ClaimGovernedExecutionReceiptResult =
  | { readonly ok: true; readonly claim: GovernedExecutionClaim }
  | {
      readonly ok: false;
      readonly reason: "NOT_CONFIGURED" | "WRITE_FAILED";
      readonly error: string | null;
    };

export type FinalizeGovernedExecutionReceiptResult =
  | { readonly ok: true; readonly row: GovernedExecutionReceiptRow | null }
  | {
      readonly ok: false;
      readonly reason: "NOT_CONFIGURED" | "WRITE_FAILED";
      readonly error: string | null;
    };

/**
 * Durable claim step for the P0.1 no-approval execution-safety fix.
 *
 * Like `persistAuditLogToSupabase` (and unlike the older, always-best-
 * effort `tryPersistXToSupabase` helpers in this package), this always
 * reports success/failure back to the caller instead of swallowing it —
 * `apps/api/src/services/governed-execution.ts` is the one place that
 * decides whether a claim failure here means fail-closed (Vercel
 * production — refuse to execute the action at all) or degrade to the
 * existing in-process `governedIdempotency` mechanism (private VM), and it
 * cannot make that decision correctly if the failure is hidden here.
 */
export async function claimGovernedExecutionReceipt(
  env: GovernedExecutionReceiptStoreEnv,
  input: ClaimGovernedExecutionInput,
): Promise<ClaimGovernedExecutionReceiptResult> {
  if (!isLiveSupabase(env)) {
    return { ok: false, reason: "NOT_CONFIGURED", error: null };
  }
  try {
    const repo = new GovernedExecutionReceiptRepository(resolveServiceClient(env));
    const claim = await repo.claim(input);
    return { ok: true, claim };
  } catch (error) {
    return {
      ok: false,
      reason: "WRITE_FAILED",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Durable finalize step. See `claimGovernedExecutionReceipt` for why this
 * reports failure back to the caller rather than swallowing it — a
 * finalize failure here means the durable receipt may be left stuck in
 * STARTED, which the caller needs to know about (even though, per the
 * DURABLE CLAIM → REAL EXECUTION → DURABLE FINALIZE → CANONICAL AUDIT
 * ordering, the real action has already run by the time this is called and
 * that outcome must still be returned to the original caller regardless of
 * whether this durable bookkeeping step itself succeeds).
 */
export async function finalizeGovernedExecutionReceipt(
  env: GovernedExecutionReceiptStoreEnv,
  input: FinalizeGovernedExecutionInput,
): Promise<FinalizeGovernedExecutionReceiptResult> {
  if (!isLiveSupabase(env)) {
    return { ok: false, reason: "NOT_CONFIGURED", error: null };
  }
  try {
    const repo = new GovernedExecutionReceiptRepository(resolveServiceClient(env));
    const row = await repo.finalize(input);
    return { ok: true, row };
  } catch (error) {
    return {
      ok: false,
      reason: "WRITE_FAILED",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

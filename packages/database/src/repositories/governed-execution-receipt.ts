import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Durable no-approval-path execution receipt — P0.1 (Correction Design
 * Gate, Issue B).
 *
 * `public.governed_execution_receipts` (schema:
 * `20260905030000_governed_execution_receipts.sql`) is the durable claim
 * ledger for governed actions that do NOT go through the approval-gated
 * claim/execute/finalize state machine (`approval_requests`, via
 * `apps/api/src/services/governed-claimed-execution.ts` — that path is
 * already fully durable and is untouched by this repository). This
 * repository exists solely to give the no-approval path the same
 * DURABLE CLAIM → REAL EXECUTION → DURABLE FINALIZE safety property,
 * independent of the in-process, file-backed `governedIdempotency` Map in
 * `apps/api/src/services/governed-execution.ts` (which has the same
 * ephemeral-Vercel-filesystem durability gap the original P0 fix closed
 * for audit evidence, but here for execution safety).
 *
 * Deliberately narrow: `claim`, `finalize`, `reclaimAfterFailure`, and
 * `getByIdempotencyKey` are the only operations a caller needs. There is no
 * update-in-place of a STARTED row's fields, no delete, and no listing —
 * none of those are needed by the one caller
 * (`apps/api/src/services/governed-execution.ts`) this repository serves.
 */
export type GovernedExecutionReceiptStatus =
  | "STARTED"
  | "EXECUTED"
  | "FAILED"
  | "OUTCOME_UNKNOWN";

export interface GovernedExecutionReceiptRow {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly ownerId: string | null;
  readonly projectId: string | null;
  readonly entityType: string | null;
  readonly action: string | null;
  readonly artifactHash: string;
  readonly status: GovernedExecutionReceiptStatus;
  readonly outcome: Record<string, unknown> | null;
  readonly startedAt: string;
  readonly finalizedAt: string | null;
  readonly createdAt: string;
}

export interface ClaimGovernedExecutionInput {
  /** Pre-generated id for the new row. Only consumed if the claim succeeds. */
  readonly id: string;
  readonly idempotencyKey: string;
  readonly ownerId: string | null;
  readonly projectId: string | null;
  readonly entityType: string | null;
  readonly action: string | null;
  readonly artifactHash: string;
}

/**
 * `CLAIMED` — this call won the claim; the caller must execute and then
 * call `finalize`.
 * `REPLAY_EXECUTED` — a durable receipt for this idempotency_key already
 * reached EXECUTED. The caller must NOT execute again; `row.outcome` is
 * the durably-recorded prior result.
 * `ARTIFACT_MISMATCH` — this idempotency_key was already claimed (in any
 * status) against a DIFFERENT artifact_hash. Reusing an idempotency key
 * for a different action is refused, mirroring the existing in-process
 * `governedIdempotency` Map's same check.
 * `IN_FLIGHT_OUTCOME_UNKNOWN` — a receipt for this idempotency_key exists
 * in status STARTED (another attempt is genuinely still executing, or a
 * prior attempt crashed before it could finalize). Whether the real action
 * already ran is unknown; the caller must refuse to execute again rather
 * than guess. Reconciling a stuck STARTED row is intentionally out of
 * scope for this pass — see the P0.1 migration's header comment.
 */
export type GovernedExecutionClaim =
  | { readonly kind: "CLAIMED"; readonly row: GovernedExecutionReceiptRow }
  | { readonly kind: "REPLAY_EXECUTED"; readonly row: GovernedExecutionReceiptRow }
  | { readonly kind: "ARTIFACT_MISMATCH"; readonly row: GovernedExecutionReceiptRow }
  | { readonly kind: "IN_FLIGHT_OUTCOME_UNKNOWN"; readonly row: GovernedExecutionReceiptRow };

export interface FinalizeGovernedExecutionInput {
  readonly idempotencyKey: string;
  readonly status: "EXECUTED" | "FAILED";
  readonly outcome: Record<string, unknown> | null;
}

const UNIQUE_VIOLATION = "23505";

export class GovernedExecutionReceiptRepository {
  constructor(private readonly client: SupabaseClient) {}

  /**
   * Claim occupancy of one idempotency_key for the no-approval execution
   * path. A plain insert (never upsert) so a conflict is a real Postgres
   * unique_violation the caller can distinguish from "inserted fine" —
   * unlike `AuditLogRepository.append()`, which deliberately treats a
   * conflict as a silent, successful no-op (that method's job is "this
   * event happened, exactly once"; this method's job is "who gets to
   * execute", which must be an explicit, observable decision).
   */
  async claim(input: ClaimGovernedExecutionInput): Promise<GovernedExecutionClaim> {
    const { data, error } = await this.client
      .from("governed_execution_receipts")
      .insert({
        id: input.id,
        idempotency_key: input.idempotencyKey,
        owner_id: input.ownerId,
        project_id: input.projectId,
        entity_type: input.entityType,
        action: input.action,
        artifact_hash: input.artifactHash,
        status: "STARTED",
      })
      .select("*")
      .single();

    if (!error) {
      return { kind: "CLAIMED", row: mapGovernedExecutionReceiptRow(data) };
    }
    if (error.code !== UNIQUE_VIOLATION) throw error;

    // Lost the claim race (or this is a genuine retry) — the authoritative
    // answer is whatever is now durably in the table, not the local error.
    const existing = await this.getByIdempotencyKey(input.idempotencyKey);
    if (!existing) {
      // A unique_violation implies a row exists; a read-after-write miss
      // here would mean a replica-lag/read-your-own-write violation this
      // repository cannot reason about safely.
      throw new Error(
        `governed_execution_receipts insert for idempotency_key=${input.idempotencyKey} reported a conflict but the row could not be read back`,
      );
    }
    if (existing.artifactHash !== input.artifactHash) {
      return { kind: "ARTIFACT_MISMATCH", row: existing };
    }
    if (existing.status === "EXECUTED") {
      return { kind: "REPLAY_EXECUTED", row: existing };
    }
    if (existing.status === "STARTED") {
      return { kind: "IN_FLIGHT_OUTCOME_UNKNOWN", row: existing };
    }
    if (existing.status === "OUTCOME_UNKNOWN") {
      return { kind: "IN_FLIGHT_OUTCOME_UNKNOWN", row: existing };
    }
    // status === "FAILED": the prior attempt's executeOnce failed (or was
    // refused) before any durable EXECUTED result — safe to retry. Reclaim
    // it back to STARTED so this attempt can proceed; if that race is lost
    // too (another concurrent retrier reclaimed first), fall back to
    // whatever the row now durably says rather than guessing.
    const reclaimed = await this.reclaimAfterFailure(input.idempotencyKey);
    if (reclaimed) {
      return { kind: "CLAIMED", row: reclaimed };
    }
    const afterReclaimAttempt = await this.getByIdempotencyKey(input.idempotencyKey);
    if (!afterReclaimAttempt) {
      throw new Error(
        `governed_execution_receipts row for idempotency_key=${input.idempotencyKey} disappeared during a reclaim attempt`,
      );
    }
    if (afterReclaimAttempt.status === "EXECUTED") {
      return { kind: "REPLAY_EXECUTED", row: afterReclaimAttempt };
    }
    // STARTED (someone else's reclaim), or still FAILED (this reclaim's
    // UPDATE affected zero rows for a reason other than a race, which
    // should not happen but must not be treated as a silent license to
    // execute) — conservatively refuse rather than double-execute.
    return { kind: "IN_FLIGHT_OUTCOME_UNKNOWN", row: afterReclaimAttempt };
  }

  /**
   * Conditional STARTED -> terminal transition. Race-safe by construction:
   * the `status = 'STARTED'` predicate can match at most once across any
   * number of concurrent callers (see the migration's header comment and
   * the paired SQL test, scenario 3). Returns null if nothing was in
   * STARTED state to finalize (this call lost a race, or is a stray
   * duplicate finalize) — the caller must not treat that as an error, only
   * as "someone else already finalized this receipt."
   */
  async finalize(
    input: FinalizeGovernedExecutionInput,
  ): Promise<GovernedExecutionReceiptRow | null> {
    const { data, error } = await this.client
      .from("governed_execution_receipts")
      .update({
        status: input.status,
        outcome: input.outcome,
        finalized_at: new Date().toISOString(),
      })
      .eq("idempotency_key", input.idempotencyKey)
      .eq("status", "STARTED")
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return data ? mapGovernedExecutionReceiptRow(data) : null;
  }

  /**
   * Conditional FAILED -> STARTED transition, used only internally by
   * `claim()` to let a genuinely new attempt retry after a prior attempt
   * failed cleanly (never after EXECUTED or while STARTED/OUTCOME_UNKNOWN
   * — see `claim()`). Race-safe for the same reason `finalize()` is:
   * `status = 'FAILED'` can match at most once.
   */
  private async reclaimAfterFailure(
    idempotencyKey: string,
  ): Promise<GovernedExecutionReceiptRow | null> {
    const { data, error } = await this.client
      .from("governed_execution_receipts")
      .update({ status: "STARTED", outcome: null, finalized_at: null, started_at: new Date().toISOString() })
      .eq("idempotency_key", idempotencyKey)
      .eq("status", "FAILED")
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return data ? mapGovernedExecutionReceiptRow(data) : null;
  }

  async getByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<GovernedExecutionReceiptRow | null> {
    const { data, error } = await this.client
      .from("governed_execution_receipts")
      .select("*")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (error) throw error;
    return data ? mapGovernedExecutionReceiptRow(data) : null;
  }
}

function mapGovernedExecutionReceiptRow(
  row: Record<string, unknown>,
): GovernedExecutionReceiptRow {
  return {
    id: String(row.id),
    idempotencyKey: String(row.idempotency_key),
    ownerId: (row.owner_id as string | null) ?? null,
    projectId: (row.project_id as string | null) ?? null,
    entityType: (row.entity_type as string | null) ?? null,
    action: (row.action as string | null) ?? null,
    artifactHash: String(row.artifact_hash),
    status: row.status as GovernedExecutionReceiptStatus,
    outcome: (row.outcome as Record<string, unknown> | null) ?? null,
    startedAt: String(row.started_at),
    finalizedAt: (row.finalized_at as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

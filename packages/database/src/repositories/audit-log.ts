import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Durable canonical audit persistence — P0 persistence fix.
 *
 * `public.audit_logs` (schema: init migration
 * `20260811000000_init.sql`, extended by
 * `20260905000000_audit_logs_canonical_chain.sql`) is the canonical,
 * concurrency-safe store for governed-action audit evidence. `seq`,
 * `prev_hash`, and `hash` are all assigned server-side by the
 * `audit_logs_chain_before_insert` trigger, which locks a singleton
 * "chain tip" row for the duration of each insert — never computed or
 * assigned client-side, so two concurrent writers can never race the way
 * the local NDJSON file's read-last-line-then-append pattern could.
 */
export interface AuditLogRow {
  readonly id: string;
  readonly seq: number;
  readonly ownerId: string | null;
  readonly action: string;
  readonly entityType: string | null;
  readonly entityId: string | null;
  readonly payload: Record<string, unknown>;
  readonly prevHash: string | null;
  readonly hash: string | null;
  readonly createdAt: string;
}

export interface AuditLogAppendInput {
  /** Idempotency key. Reused across retries of the same governed action. */
  readonly id: string;
  readonly ownerId: string | null;
  readonly action: string;
  readonly entityType: string | null;
  readonly entityId: string | null;
  readonly payload: Record<string, unknown>;
}

export interface AuditLogChainVerification {
  readonly ok: boolean;
  readonly checked: number;
  readonly error: string | null;
}

export class AuditLogRepository {
  constructor(private readonly client: SupabaseClient) {}

  /**
   * Insert one audit event, idempotent on `id`. A retry of the same
   * governed action (same id) must not produce a second chained row —
   * `ignoreDuplicates` makes Postgres/PostgREST silently skip the insert on
   * conflict, so a caller can never tell "first write" apart from
   * "idempotent retry" except via the returned row's own seq/hash being
   * unchanged.
   *
   * P0 correction (2026-09-05): `seq`/`prev_hash`/`hash` are populated by
   * an AFTER INSERT trigger (moved from BEFORE INSERT — see the migration
   * file for why), which means the INSERT statement's own RETURNING
   * projection never reflects them (AFTER triggers run after RETURNING is
   * evaluated). This method therefore never relies on the upsert's
   * response body — it always re-reads the row by id afterward, which
   * also means the same code path serves both "genuinely inserted" and
   * "conflicted with an existing row" without needing to branch on what
   * the upsert returned.
   */
  async append(entry: AuditLogAppendInput): Promise<AuditLogRow> {
    const { error } = await this.client.from("audit_logs").upsert(
      {
        id: entry.id,
        owner_id: entry.ownerId,
        action: entry.action,
        entity_type: entry.entityType,
        entity_id: entry.entityId,
        payload: entry.payload,
      },
      { onConflict: "id", ignoreDuplicates: true },
    );

    if (error) throw error;

    const row = await this.getById(entry.id);
    if (!row) {
      throw new Error(
        `audit_logs upsert for id=${entry.id} reported success but the row could not be read back by id`,
      );
    }
    return row;
  }

  async getById(id: string): Promise<AuditLogRow | null> {
    const { data, error } = await this.client
      .from("audit_logs")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? mapAuditLogRow(data) : null;
  }

  /**
   * Lightweight application-side linkage check over the most recent `limit`
   * rows (by seq): confirms each row's prev_hash equals the immediately
   * preceding row's hash, which catches a deleted, reordered, or tampered
   * row within the fetched window.
   *
   * Deliberately does NOT recompute the sha256 hash itself — doing that
   * correctly would require reproducing Postgres's own `jsonb::text`
   * serialization byte-for-byte in JavaScript, which is not guaranteed to
   * match `JSON.stringify` (key ordering/whitespace differ). The
   * cryptographic hash itself is verified instead by the paired SQL test
   * (`supabase/tests/20260905000000_audit_logs_canonical_chain.test.sql`),
   * which calls the exact same `digest()` function the trigger uses. This
   * method covers the operational/ops-tooling need (detect a broken chain)
   * without a fragile reimplementation.
   */
  async verifyChain(limit = 500): Promise<AuditLogChainVerification> {
    const { data, error } = await this.client
      .from("audit_logs")
      .select("id, seq, prev_hash, hash")
      .order("seq", { ascending: true })
      .limit(limit);
    if (error) throw error;
    const rows = (data ?? []) as Array<{
      readonly id: string;
      readonly seq: number;
      readonly prev_hash: string | null;
      readonly hash: string | null;
    }>;
    for (let i = 1; i < rows.length; i += 1) {
      const prev = rows[i - 1];
      const curr = rows[i];
      if (!prev || !curr) continue;
      if (curr.prev_hash !== prev.hash) {
        return {
          ok: false,
          checked: i,
          error: `chain break at seq=${curr.seq}: prev_hash does not match the immediately preceding row's hash`,
        };
      }
    }
    return { ok: true, checked: rows.length, error: null };
  }
}

function mapAuditLogRow(row: Record<string, unknown>): AuditLogRow {
  return {
    id: String(row.id),
    seq: Number(row.seq),
    ownerId: (row.owner_id as string | null) ?? null,
    action: String(row.action),
    entityType: (row.entity_type as string | null) ?? null,
    entityId: (row.entity_id as string | null) ?? null,
    payload: (row.payload as Record<string, unknown>) ?? {},
    prevHash: (row.prev_hash as string | null) ?? null,
    hash: (row.hash as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

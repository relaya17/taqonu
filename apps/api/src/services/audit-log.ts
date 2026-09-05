import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import {
  unifiedAuditEntrySchema,
  type UnifiedAuditEntry,
  type UnifiedAuditEntryInput,
} from "@atlas/shared";
import {
  isLiveSupabase,
  persistAuditLogToSupabase,
  type AuditLogRow,
  type AuditLogStoreEnv,
} from "@atlas/database";
import { findRepoRoot } from "./repo-root.js";

/** Genesis sentinel when the NDJSON chain has no prior line. */
export const AUDIT_GENESIS_HASH = "GENESIS";

export const AUDIT_MEMORY_RING = 1000;

/** Canonical integrity of the API NDJSON trail — never inferred from an empty file. */
export type AuditIntegrity = "VALID" | "BROKEN" | "INCOMPLETE" | "UNKNOWN";

export interface AuditLogRecord {
  readonly id: string;
  readonly at: string;
  readonly type: string;
  readonly prevHash: string;
  readonly hash: string;
  readonly payload: Record<string, unknown>;
}

let pathOverride: string | null = null;
let cachedTailHash: string | null | undefined = undefined;

/** Test helper — point the audit file at a temp path and clear chain cache. */
export function setAuditLogPathForTests(path: string | null): void {
  pathOverride = path;
  cachedTailHash = undefined;
}

/** Resolve monorepo root then `.atlas/audit/audit.ndjson` (or ATLAS_AUDIT_LOG_PATH). */
export function resolveAuditLogPath(): string {
  if (pathOverride) return pathOverride;
  const fromEnv = process.env.ATLAS_AUDIT_LOG_PATH?.trim();
  if (fromEnv) return resolve(fromEnv);

  const storeEnv = process.env.ATLAS_STORE_PATH?.trim();
  if (storeEnv) {
    return join(dirname(resolve(storeEnv)), "audit", "audit.ndjson");
  }

  return resolve(findRepoRoot(), ".atlas", "audit", "audit.ndjson");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

export function hashAuditPayload(
  prevHash: string,
  payload: Record<string, unknown>,
): string {
  const body = `${prevHash}\n${stableStringify(payload)}`;
  return createHash("sha256").update(body, "utf8").digest("hex");
}

function readTailHash(path: string): string {
  if (cachedTailHash !== undefined && cachedTailHash !== null) {
    return cachedTailHash;
  }
  if (!existsSync(path)) {
    cachedTailHash = AUDIT_GENESIS_HASH;
    return AUDIT_GENESIS_HASH;
  }
  try {
    const raw = readFileSync(path, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    const last = lines[lines.length - 1];
    if (!last) {
      cachedTailHash = AUDIT_GENESIS_HASH;
      return AUDIT_GENESIS_HASH;
    }
    const parsed = JSON.parse(last) as { hash?: string };
    cachedTailHash =
      typeof parsed.hash === "string" && parsed.hash.length > 0
        ? parsed.hash
        : AUDIT_GENESIS_HASH;
    return cachedTailHash;
  } catch {
    cachedTailHash = AUDIT_GENESIS_HASH;
    return AUDIT_GENESIS_HASH;
  }
}

/**
 * Append one audit entry to the durable NDJSON file (never truncates).
 * Returns the chained record (with prevHash + hash).
 */
export function appendAuditLogLine(
  entry: Record<string, unknown>,
): AuditLogRecord {
  const path = resolveAuditLogPath();
  const at =
    typeof entry.at === "string" && entry.at.length > 0
      ? entry.at
      : new Date().toISOString();
  const type =
    typeof entry.type === "string" && entry.type.length > 0
      ? entry.type
      : "audit.event";
  const id =
    typeof entry.id === "string" && entry.id.length > 0
      ? entry.id
      : crypto.randomUUID();

  const payload: Record<string, unknown> = { ...entry, type, at, id };
  delete payload.prevHash;
  delete payload.hash;

  const prevHash = readTailHash(path);
  const hash = hashAuditPayload(prevHash, payload);
  const record: AuditLogRecord = {
    id,
    at,
    type,
    prevHash,
    hash,
    payload,
  };

  if (process.env.ATLAS_SKIP_AUDIT_LOG === "1") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("ATLAS_SKIP_AUDIT_LOG is forbidden in production");
    }
    cachedTailHash = hash;
    return record;
  }

  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
  cachedTailHash = hash;
  return record;
}

/**
 * Append one audit entry in the standardized WHO/WHAT/WHEN/WHY/INPUT/OUTPUT/
 * POLICY/RISK/APPROVAL/RESULT shape (`unifiedAuditEntrySchema` in
 * @atlas/shared) to the same hash-chained NDJSON file `appendAuditLogLine`
 * writes to. Existing call sites keep using freeform payloads via
 * `appendAuditLogLine` unchanged — this is additive, for new call sites that
 * want a consistent, queryable shape.
 */
export function appendUnifiedAuditEntry(
  entry: UnifiedAuditEntryInput,
): AuditLogRecord {
  const parsed = unifiedAuditEntrySchema.parse(entry);
  return appendAuditLogLine(parsed);
}

/**
 * ─────────────────────────────────────────────────────────────────────────
 * P0 persistence fix: canonical Postgres dual-write + NDJSON secondary.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Everything above this point (`appendAuditLogLine`, `appendUnifiedAuditEntry`)
 * is unchanged and keeps writing only to the local NDJSON file — those two
 * functions remain the correct choice for call sites out of this P0's scope
 * (see docs/architecture/ATLAS_MASTER_TRUTH.md section 65 for the named
 * list: apps/api/src/services/audit-bridge.ts, os-store.ts's internal
 * `appendAudit`, and the non-primary `appendUnifiedAuditEntry` call sites
 * across the codebase that are not part of the governed-execution or
 * synthetic-universe governance paths).
 *
 * `appendCanonicalAuditEntry` / `appendUnifiedCanonicalAuditEntry` are the
 * new canonical path used by governed-action audit (see
 * governance-decision.ts, governed-execution.ts, synthetic-universe-run.ts):
 * Postgres `public.audit_logs` is canonical when live Supabase credentials
 * are configured; the local NDJSON file is always still written too as a
 * secondary/resilience record when durable local disk is available, exactly
 * as before this change. No existing NDJSON behavior is removed.
 */

function getSupabaseEnvFromProcess(): AuditLogStoreEnv | null {
  const url = process.env.SUPABASE_URL?.trim();
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !anonKey || !serviceRoleKey) return null;
  const env: AuditLogStoreEnv = {
    SUPABASE_URL: url,
    SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  };
  // Presence alone is not proof of a live database (see the Environment
  // Gate item, instruction 10, and every existing `.env`/`.env.example` in
  // this repo, which ships SUPABASE_SERVICE_ROLE_KEY=replace-me by default)
  // -- use the same isLiveSupabase gate every other Supabase dual-write
  // path in this codebase uses, so a placeholder-configured environment
  // (including every existing test run) takes the NDJSON-only branch below
  // exactly like today, not the "configured but failing" fail-closed/
  // degrade branch.
  if (!isLiveSupabase(env)) return null;
  return env;
}

/**
 * Vercel's serverless functions run on an ephemeral, largely read-only
 * filesystem — see apps/api/src/services/repo-root.ts, which already
 * special-cases `process.env.VERCEL` for exactly this reason. Only
 * PRODUCTION on Vercel is treated as "cannot trust local disk": a Vercel
 * preview/dev deployment with NODE_ENV!=="production" keeps today's
 * NDJSON-only behavior, matching every existing test (NODE_ENV="test", no
 * VERCEL set).
 */
function isVercelProduction(): boolean {
  return Boolean(process.env.VERCEL) && process.env.NODE_ENV === "production";
}

function recordFromPostgresRow(
  row: AuditLogRow,
  originalEntry: Record<string, unknown>,
): AuditLogRecord {
  const type =
    typeof originalEntry.type === "string" && originalEntry.type.length > 0
      ? originalEntry.type
      : row.action;
  return {
    id: row.id,
    at: row.createdAt,
    type,
    prevHash: row.prevHash ?? AUDIT_GENESIS_HASH,
    hash: row.hash ?? "",
    payload: { ...originalEntry, id: row.id, type, at: row.createdAt },
  };
}

/** Which store actually holds the canonical (source-of-truth) copy of this write. */
export type CanonicalAuditStore = "postgres" | "ndjson";
export type CanonicalWriteOutcome = "written" | "failed" | "skipped-not-configured" | "skipped";

export interface CanonicalAuditWriteResult {
  readonly record: AuditLogRecord;
  readonly canonical: CanonicalAuditStore;
  readonly postgres: CanonicalWriteOutcome;
  readonly ndjson: CanonicalWriteOutcome;
  /**
   * true only in the private-VM-Postgres-failed-but-NDJSON-succeeded case:
   * the event IS durably recorded (in NDJSON), but not in the canonical
   * Postgres store. Callers (persistGovernanceDecision) can use this to
   * decide whether to surface the degraded state further.
   */
  readonly degraded: boolean;
}

/**
 * Canonical dual-write path for governed-action audit entries.
 *
 * Failure semantics (see docs/architecture/ATLAS_MASTER_TRUTH.md section 65
 * for the full write-up):
 *  - Postgres not configured (no live SUPABASE_* env) and NOT
 *    Vercel-production: unchanged pre-existing behavior — NDJSON only, no
 *    throw. Backward compatible with every existing test.
 *  - Postgres not configured and IS Vercel-production: FAIL CLOSED (throws)
 *    — an unconfigured canonical store on the one platform whose local disk
 *    cannot be trusted is exactly the condition this fix closes.
 *  - Postgres write succeeds: canonical = "postgres". NDJSON is still
 *    attempted best-effort as a secondary copy; an NDJSON failure here does
 *    NOT fail the call, because Postgres already holds the canonical
 *    record.
 *  - Postgres write fails and IS Vercel-production: FAIL CLOSED (throws) —
 *    do not silently continue with an unaudited governed action.
 *  - Postgres write fails, NOT Vercel-production, and the NDJSON secondary
 *    write succeeds: DEGRADE explicitly. Does not throw, but the returned
 *    result carries `degraded: true` and `postgres: "failed"` so the caller
 *    can decide whether to surface the degradation further. The event is
 *    NOT silently lost — it is durably recorded in NDJSON.
 *  - Both Postgres and NDJSON fail: throws. Never silently discards an
 *    audit event.
 */
export async function appendCanonicalAuditEntry(
  entry: Record<string, unknown>,
): Promise<CanonicalAuditWriteResult> {
  const vercelProd = isVercelProduction();
  const supabaseEnv = getSupabaseEnvFromProcess();

  if (!supabaseEnv) {
    if (vercelProd) {
      throw new Error(
        "Canonical audit persistence (Supabase) is not configured on a Vercel production runtime — refusing to record this governed action as audited (fail closed).",
      );
    }
    const record = appendAuditLogLine(entry);
    return {
      record,
      canonical: "ndjson",
      postgres: "skipped-not-configured",
      ndjson: "written",
      degraded: false,
    };
  }

  const id =
    typeof entry.id === "string" && entry.id.length > 0 ? entry.id : crypto.randomUUID();
  // See ATLAS_MASTER_TRUTH.md section 65, "owner_id" note: always NULL in
  // this pass to avoid an audit_logs.owner_id FK failure (against
  // auth.users) for system/synthetic-tenant governed actions that have no
  // real Auth user id. The real value, when known, is preserved below
  // inside `payload`.
  const ownerId: string | null = null;
  const action =
    typeof entry.action === "string" && entry.action.length > 0
      ? entry.action
      : typeof entry.type === "string" && entry.type.length > 0
        ? entry.type
        : "audit.event";
  const entityType =
    typeof (entry as { entityType?: unknown }).entityType === "string"
      ? ((entry as { entityType?: string }).entityType as string)
      : null;
  const entityId =
    typeof (entry as { entityId?: unknown }).entityId === "string"
      ? ((entry as { entityId?: string }).entityId as string)
      : null;

  const pgResult = await persistAuditLogToSupabase(supabaseEnv, {
    id,
    ownerId,
    action,
    entityType,
    entityId,
    payload: { ...entry, id },
  });

  if (pgResult.ok) {
    let ndjson: CanonicalWriteOutcome = "skipped";
    try {
      appendAuditLogLine({ ...entry, id });
      ndjson = "written";
    } catch {
      // Postgres already holds the canonical record — an NDJSON secondary
      // failure is surfaced via the return value, not thrown.
    }
    return {
      record: recordFromPostgresRow(pgResult.row, entry),
      canonical: "postgres",
      postgres: "written",
      ndjson,
      degraded: false,
    };
  }

  if (vercelProd) {
    throw new Error(
      `Canonical audit persistence (Supabase) failed on a Vercel production runtime — refusing to record this governed action as audited (fail closed). Cause: ${pgResult.error ?? pgResult.reason}`,
    );
  }

  try {
    const record = appendAuditLogLine(entry);
    return {
      record,
      canonical: "ndjson",
      postgres: "failed",
      ndjson: "written",
      degraded: true,
    };
  } catch (ndjsonError) {
    throw new Error(
      `Canonical audit persistence failed on both Postgres and the local NDJSON secondary — refusing to silently discard this audit event. Postgres cause: ${pgResult.error ?? pgResult.reason}; NDJSON cause: ${ndjsonError instanceof Error ? ndjsonError.message : String(ndjsonError)}`,
    );
  }
}

/**
 * Canonical, schema-validated counterpart to `appendUnifiedAuditEntry` —
 * see `appendCanonicalAuditEntry` for the dual-write/failure semantics.
 */
export async function appendUnifiedCanonicalAuditEntry(
  entry: UnifiedAuditEntryInput,
): Promise<CanonicalAuditWriteResult> {
  const parsed = unifiedAuditEntrySchema.parse(entry);
  return appendCanonicalAuditEntry(parsed);
}

/** Read the last N records from the append-only file (for tests / ops). */
export function readAuditLogTail(limit = AUDIT_MEMORY_RING): AuditLogRecord[] {
  const path = resolveAuditLogPath();
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    const slice = lines.slice(-Math.max(1, limit));
    const out: AuditLogRecord[] = [];
    for (const line of slice) {
      try {
        const parsed = JSON.parse(line) as AuditLogRecord;
        if (parsed && typeof parsed.hash === "string") out.push(parsed);
      } catch {
        // skip corrupt line
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Count lines in the durable file (does not load full content into memory ring). */
export function countAuditLogLines(): number {
  const path = resolveAuditLogPath();
  if (!existsSync(path)) return 0;
  try {
    const raw = readFileSync(path, "utf8");
    return raw.split("\n").filter((l) => l.trim().length > 0).length;
  } catch {
    return 0;
  }
}

export function verifyAuditLogChain(): {
  readonly ok: boolean;
  readonly status: AuditIntegrity;
  readonly checked: number;
  readonly error: string | null;
} {
  return verifyAuditLogChainAt(resolveAuditLogPath());
}

export function verifyAuditLogChainAt(path: string): {
  readonly ok: boolean;
  readonly status: AuditIntegrity;
  readonly checked: number;
  readonly error: string | null;
} {
  if (!existsSync(path)) {
    return {
      ok: false,
      status: "INCOMPLETE",
      checked: 0,
      error: "canonical audit log is missing",
    };
  }
  try {
    const raw = readFileSync(path, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length === 0) {
      return {
        ok: false,
        status: "INCOMPLETE",
        checked: 0,
        error: "canonical audit log is empty",
      };
    }
    let prev = AUDIT_GENESIS_HASH;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line) continue;
      const parsed = JSON.parse(line) as AuditLogRecord;
      if (parsed.prevHash !== prev) {
        return {
          ok: false,
          status: "BROKEN",
          checked: i,
          error: `audit chain break at index ${i}`,
        };
      }
      const expected = hashAuditPayload(parsed.prevHash, parsed.payload);
      if (expected !== parsed.hash) {
        return {
          ok: false,
          status: "BROKEN",
          checked: i,
          error: `audit hash mismatch at index ${i}`,
        };
      }
      prev = parsed.hash;
    }
    return { ok: true, status: "VALID", checked: lines.length, error: null };
  } catch (error) {
    return {
      ok: false,
      status: "UNKNOWN",
      checked: 0,
      error: error instanceof Error ? error.message : "audit verify failed",
    };
  }
}

export function verifyAuditChain(): {
  readonly intact: boolean;
  readonly ok: boolean;
  readonly status: AuditIntegrity;
  readonly checked: number;
  readonly entriesChecked: number;
  readonly error: string | null;
  readonly firstInvalidEventId: string | null;
} {
  const result = verifyAuditLogChain();
  return {
    ...result,
    intact: result.status === "VALID",
    entriesChecked: result.checked,
    firstInvalidEventId: result.ok ? null : result.error,
  };
}

export function listUnifiedAuditEntries(filter?: {
  readonly ownerId?: string;
  readonly actorId?: string;
  readonly limit?: number;
}): UnifiedAuditEntry[] {
  const path = resolveAuditLogPath();
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    const out: UnifiedAuditEntry[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as AuditLogRecord;
        const candidate = parsed.payload ?? parsed;
        const entry = unifiedAuditEntrySchema.safeParse(candidate);
        if (!entry.success) continue;
        if (filter?.ownerId && entry.data.ownerId !== filter.ownerId) continue;
        if (filter?.actorId && entry.data.actorId !== filter.actorId) continue;
        out.push(entry.data);
      } catch {
        // skip corrupt line
      }
    }
    const limit = filter?.limit;
    if (limit !== undefined) return out.slice(-limit);
    return out;
  } catch {
    return [];
  }
}

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
import { findRepoRoot } from "./repo-root.js";

/** Genesis sentinel when the NDJSON chain has no prior line. */
export const AUDIT_GENESIS_HASH = "GENESIS";

export const AUDIT_MEMORY_RING = 1000;

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

/**
 * Read back `appendUnifiedAuditEntry` entries (per-owner tagging, P1 fix),
 * optionally filtered by `ownerId` — "show me only tenant X's audit trail"
 * instead of every consumer having to read the whole shared NDJSON chain and
 * filter it by hand. Scans the same file `readAuditLogTail` does; freeform
 * `appendAuditLogLine` payloads that don't parse as a `UnifiedAuditEntry`
 * (e.g. missing `reason`/`risk`/`approval`/`result`) are silently skipped —
 * they were never written through `appendUnifiedAuditEntry` in the first
 * place, so they have no standardized shape to filter on.
 *
 * Design choice (documented per task spec, since either behavior is
 * defensible): when `ownerId` is provided, entries whose own `ownerId` is
 * null/absent (system-wide, no resolvable tenant) are EXCLUDED from that
 * filtered result — filtering by ownerId is meant to produce exactly one
 * tenant's trail, and mixing in system-wide entries would defeat that
 * isolation guarantee. Call with no `ownerId` at all to see everything,
 * including system-wide entries.
 */
export function listUnifiedAuditEntries(
  options: { ownerId?: string; limit?: number } = {},
): UnifiedAuditEntry[] {
  const scanLimit = Math.max(1, options.limit ?? AUDIT_MEMORY_RING);
  const tail = readAuditLogTail(scanLimit);
  const entries: UnifiedAuditEntry[] = [];
  for (const record of tail) {
    const parsed = unifiedAuditEntrySchema.safeParse(record.payload);
    if (!parsed.success) continue;
    entries.push(parsed.data);
  }
  if (options.ownerId === undefined) return entries;
  return entries.filter((entry) => entry.ownerId === options.ownerId);
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

/** One broken link found while walking the chain. */
export type AuditChainViolation =
  | { readonly kind: "BROKEN_LINK"; readonly line: number; readonly expectedPrevHash: string; readonly actualPrevHash: string }
  | { readonly kind: "TAMPERED_PAYLOAD"; readonly line: number; readonly recordedHash: string; readonly recomputedHash: string }
  | { readonly kind: "UNPARSEABLE"; readonly line: number; readonly reason: string };

export interface AuditChainVerification {
  readonly intact: boolean;
  readonly entriesChecked: number;
  /**
   * `id` of the first record that failed any check, or null when intact.
   * Callers (CI gate, self-audit, an operator) need to know WHERE the chain
   * first breaks, not just that it does — everything before this point is
   * still trustworthy, everything after it is suspect.
   */
  readonly firstInvalidEventId: string | null;
  readonly firstInvalidLine: number | null;
  readonly violations: readonly AuditChainViolation[];
}

/**
 * Verify the audit log's hash chain end to end.
 *
 * Why this exists: `appendAuditLogLine()` has always written a proper chain
 * — `prevHash`, a SHA-256 `hash` over canonical (`stableStringify`) JSON,
 * and a genesis anchor. But NOTHING ever read it back to check it. A hash
 * chain's entire value is detecting tampering, deletion and reordering; a
 * chain nobody verifies is a lock nobody checks. This is the missing half.
 *
 * It detects all three failure modes the structure is designed to catch:
 *
 *  - **TAMPERED_PAYLOAD** — a record's fields were edited in place. The
 *    recomputed hash no longer matches the stored one.
 *  - **BROKEN_LINK** — a record was deleted, inserted, or reordered. Its
 *    `prevHash` no longer equals the previous record's `hash`.
 *  - **UNPARSEABLE** — a line is not valid JSON or lacks the chain fields.
 *
 * Deletion of the FINAL record is the one mutation a forward walk cannot
 * see (the remaining prefix is still perfectly consistent). Detecting that
 * requires anchoring the tail somewhere outside the file — an external
 * notary or a counter — which this deliberately does NOT pretend to do.
 * Callers should treat "intact" as "no record was altered, removed from the
 * middle, or reordered", not as "nothing was ever truncated".
 */
export function verifyAuditChain(path?: string): AuditChainVerification {
  const target = path ?? resolveAuditLogPath();
  if (!existsSync(target)) {
    return { intact: true, entriesChecked: 0, firstInvalidEventId: null, firstInvalidLine: null, violations: [] };
  }

  const raw = readFileSync(target, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);

  const violations: AuditChainViolation[] = [];
  let expectedPrev = AUDIT_GENESIS_HASH;
  let checked = 0;
  let firstInvalidEventId: string | null = null;
  let firstInvalidLine: number | null = null;
  const violationsBefore = () => violations.length;
  const noteFirstInvalid = (before: number, lineNo: number, id: unknown): void => {
    if (violations.length > before && firstInvalidLine === null) {
      firstInvalidLine = lineNo;
      firstInvalidEventId = typeof id === "string" ? id : null;
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const before = violationsBefore();
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(lines[i] ?? "") as Record<string, unknown>;
    } catch {
      violations.push({ kind: "UNPARSEABLE", line: lineNo, reason: "invalid JSON" });
      noteFirstInvalid(before, lineNo, null);
      // The chain cannot continue past a line whose hash is unknown.
      break;
    }

    const recordedHash = record["hash"];
    const recordedPrev = record["prevHash"];
    if (typeof recordedHash !== "string" || typeof recordedPrev !== "string") {
      violations.push({ kind: "UNPARSEABLE", line: lineNo, reason: "missing hash/prevHash" });
      noteFirstInvalid(before, lineNo, record["id"]);
      break;
    }

    if (recordedPrev !== expectedPrev) {
      violations.push({
        kind: "BROKEN_LINK",
        line: lineNo,
        expectedPrevHash: expectedPrev,
        actualPrevHash: recordedPrev,
      });
    }

    // Recompute exactly as `appendAuditLogLine` hashed it. The written
    // record is `{id, at, type, prevHash, hash, payload}` — the hash covers
    // the NESTED `payload` object, not the record's own top level.
    const payload = record["payload"];
    if (typeof payload !== "object" || payload === null) {
      violations.push({ kind: "UNPARSEABLE", line: lineNo, reason: "missing payload" });
      noteFirstInvalid(before, lineNo, record["id"]);
      break;
    }
    const recomputed = hashAuditPayload(recordedPrev, payload as Record<string, unknown>);
    if (recomputed !== recordedHash) {
      violations.push({
        kind: "TAMPERED_PAYLOAD",
        line: lineNo,
        recordedHash,
        recomputedHash: recomputed,
      });
    }

    // The hash covers `payload` only. The record ALSO carries `id`/`at`/
    // `type` at its top level, mirrored from inside the payload — and those
    // copies are NOT hashed. Any reader that trusts the top-level copies
    // (e.g. a UI listing "when" and "what") could therefore be shown values
    // that were edited without breaking the chain. Rather than silently
    // leaving that gap, mirror-consistency is verified explicitly.
    const payloadObj = payload as Record<string, unknown>;
    for (const field of ["id", "at", "type"] as const) {
      if (record[field] !== payloadObj[field]) {
        violations.push({
          kind: "TAMPERED_PAYLOAD",
          line: lineNo,
          recordedHash,
          recomputedHash: `top-level "${field}" (${String(record[field])}) does not match hashed payload value (${String(payloadObj[field])})`,
        });
      }
    }

    // Continue from the RECORDED hash, so one bad record yields one
    // violation rather than cascading a false break onto every line after.
    noteFirstInvalid(before, lineNo, record["id"]);
    expectedPrev = recordedHash;
    checked += 1;
  }

  return {
    intact: violations.length === 0,
    entriesChecked: checked,
    firstInvalidEventId,
    firstInvalidLine,
    violations,
  };
}

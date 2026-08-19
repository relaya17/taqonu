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

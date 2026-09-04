/**
 * Audit Bridge — Merge Control Plane audit entries into the canonical API audit file.
 *
 * Control Plane in-memory hashes stay observational. The API NDJSON chain is
 * the only system of record. Imported rows keep `cpHash` / `cpPrevHash` as
 * provenance; the API then hashes the new line into its own chain.
 */

import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import {
  appendAuditLogLine,
  resolveAuditLogPath,
  type AuditLogRecord,
} from "./audit-log.js";

export const cpAuditEntrySchema = z.object({
  seq: z.number(),
  timestamp: z.string(),
  type: z.string(),
  actorId: z.string(),
  actorKind: z.string(),
  reason: z.string(),
  policy: z.string(),
  risk: z.string(),
  approval: z.string(),
  result: z.string(),
  ownerId: z.string(),
  projectId: z.string().nullable(),
  hash: z.string(),
  prevHash: z.string(),
});

export type CpAuditEntry = z.infer<typeof cpAuditEntrySchema>;

function importedCpHashes(): Set<string> {
  const seen = new Set<string>();
  const path = resolveAuditLogPath();
  if (!existsSync(path)) return seen;
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as { payload?: { cpHash?: unknown } };
      const hash = parsed.payload?.cpHash;
      if (typeof hash === "string" && hash.length > 0) seen.add(hash);
    } catch {
      // skip corrupt line; verifyAuditLogChain is the integrity gate
    }
  }
  return seen;
}

export function assertCpHashContinuity(entries: readonly CpAuditEntry[]): void {
  const ordered = [...entries].sort((a, b) => a.seq - b.seq);
  for (let i = 1; i < ordered.length; i += 1) {
    const previous = ordered[i - 1];
    const current = ordered[i];
    if (!previous || !current) continue;
    if (current.prevHash !== previous.hash) {
      throw new Error(
        `Control Plane hash break between seq ${previous.seq} and ${current.seq}`,
      );
    }
  }
}

/**
 * Import a Control Plane audit entry into the canonical API audit file.
 * The entry is transformed to include CP origin metadata.
 */
export function importCpAuditEntry(entry: CpAuditEntry): AuditLogRecord {
  return appendAuditLogLine({
    type: `cp:${entry.type}`,
    cpSeq: entry.seq,
    cpHash: entry.hash,
    cpPrevHash: entry.prevHash,
    actorId: entry.actorId,
    actorKind: entry.actorKind,
    reason: entry.reason,
    policy: entry.policy,
    risk: entry.risk,
    approval: entry.approval,
    result: entry.result,
    ownerId: entry.ownerId,
    projectId: entry.projectId,
    importedAt: new Date().toISOString(),
    source: "control-plane",
  });
}

/**
 * Batch import. Dedups by `cpHash`. Rejects a broken CP hash sequence.
 * Historical API lines are never rewritten.
 */
export function importCpAuditBatch(entries: CpAuditEntry[]): {
  imported: number;
  skipped: number;
  records: AuditLogRecord[];
} {
  assertCpHashContinuity(entries);
  const seen = importedCpHashes();
  const records: AuditLogRecord[] = [];
  let skipped = 0;
  for (const entry of entries) {
    if (seen.has(entry.hash)) {
      skipped += 1;
      continue;
    }
    const record = importCpAuditEntry(entry);
    seen.add(entry.hash);
    records.push(record);
  }
  return {
    imported: records.length,
    skipped,
    records,
  };
}

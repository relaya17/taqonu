/**
 * Audit Bridge — Merge Control Plane audit entries into the canonical API audit file.
 *
 * This allows the Control Plane to forward its audit entries to be persisted
 * in the canonical hash-chained NDJSON file alongside API audit entries.
 * 
 * The entries are prefixed with `cp:` in their type to distinguish them
 * from API-native entries while maintaining a single source of truth.
 */

import { z } from "zod";
import { appendAuditLogLine, type AuditLogRecord } from "./audit-log.js";

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
 * Batch import multiple Control Plane audit entries.
 */
export function importCpAuditBatch(entries: CpAuditEntry[]): {
  imported: number;
  records: AuditLogRecord[];
} {
  const records: AuditLogRecord[] = [];
  for (const entry of entries) {
    records.push(importCpAuditEntry(entry));
  }
  return {
    imported: records.length,
    records,
  };
}

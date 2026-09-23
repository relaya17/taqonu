/**
 * R20 product audit retention (G20 / G28).
 *
 * Master Plan: product retention/TTL is optional and waits on R17 offsite DR.
 * Nonce (10 min) and preflight-decision TTL are operational hygiene, not this
 * policy. Memory DELETE/TTL is R10 and is not invoked here.
 *
 * This module does not delete canonical NDJSON or public.audit_logs.
 * Hash-chain integrity is preserved: expiry is an eligibility classification,
 * not a chain rewrite.
 */

import { resolveAuditLogPath } from "./audit-log.js";

export const PRODUCT_AUDIT_RETENTION_KIND = "PRODUCT_AUDIT_RETENTION" as const;
export const OPERATIONAL_TTL_KIND = "OPERATIONAL_TTL_NOT_PRODUCT_RETENTION" as const;
export const MEMORY_TTL_KIND = "R10_MEMORY_TTL_NOT_R20" as const;

export type OffsiteRetentionGate =
  | "OFFSITE_NOT_CONFIGURED"
  | "REJECTED"
  | "VERIFIED";

export interface AuditRetentionSubject {
  readonly id: string;
  readonly createdAt: string;
}

export interface ProductAuditRetentionEvaluation {
  readonly kind: typeof PRODUCT_AUDIT_RETENTION_KIND;
  readonly offsiteStatus: OffsiteRetentionGate;
  readonly retentionDays: number | null;
  readonly applied: false;
  readonly action: "RETAIN_ALL" | "IDENTIFY_EXPIRED";
  readonly expiredIds: readonly string[];
  readonly retainedIds: readonly string[];
  readonly reason: string;
}

export function isOperationalTtlProductRetention(): false {
  return false;
}

export function isMemoryTtlProductRetention(): false {
  return false;
}

export function productAuditRetentionEnabled(
  offsiteStatus: OffsiteRetentionGate,
): boolean {
  return offsiteStatus === "VERIFIED";
}

function parseCreatedAtMs(createdAt: string): number | null {
  const ms = Date.parse(createdAt);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Classify disposable subjects against the Master Plan gate.
 * Never mutates storage. When offsite is not VERIFIED, every subject is retained
 * even if retentionDays is supplied.
 */
export function evaluateProductAuditRetention(input: {
  readonly offsiteStatus: OffsiteRetentionGate;
  readonly retentionDays: number | null;
  readonly nowMs?: number;
  readonly subjects: readonly AuditRetentionSubject[];
}): ProductAuditRetentionEvaluation {
  const retainedIds = input.subjects.map((subject) => subject.id);
  if (!productAuditRetentionEnabled(input.offsiteStatus)) {
    return {
      kind: PRODUCT_AUDIT_RETENTION_KIND,
      offsiteStatus: input.offsiteStatus,
      retentionDays: input.retentionDays,
      applied: false,
      action: "RETAIN_ALL",
      expiredIds: [],
      retainedIds,
      reason:
        "Product audit retention waits on R17 offsite VERIFIED. Canonical audit is retained.",
    };
  }

  const days = input.retentionDays;
  if (days === null || !Number.isInteger(days) || days < 1) {
    return {
      kind: PRODUCT_AUDIT_RETENTION_KIND,
      offsiteStatus: input.offsiteStatus,
      retentionDays: input.retentionDays,
      applied: false,
      action: "RETAIN_ALL",
      expiredIds: [],
      retainedIds,
      reason:
        "Offsite is VERIFIED but no positive product retentionDays is configured. Retain all.",
    };
  }

  const nowMs = input.nowMs ?? Date.now();
  const cutoffMs = nowMs - days * 24 * 60 * 60 * 1000;
  const expiredIds: string[] = [];
  const keptIds: string[] = [];
  for (const subject of input.subjects) {
    const createdMs = parseCreatedAtMs(subject.createdAt);
    if (createdMs !== null && createdMs < cutoffMs) {
      expiredIds.push(subject.id);
    } else {
      keptIds.push(subject.id);
    }
  }

  return {
    kind: PRODUCT_AUDIT_RETENTION_KIND,
    offsiteStatus: input.offsiteStatus,
    retentionDays: days,
    applied: false,
    action: "IDENTIFY_EXPIRED",
    expiredIds,
    retainedIds: keptIds,
    reason:
      "Eligibility only. Hash-chain rows are not deleted. Destructive purge is not implemented.",
  };
}

export function refuseDestructiveCanonicalAuditRetention(input: {
  readonly targetPath?: string;
}): { readonly applied: false; readonly deleted: 0; readonly reason: string } {
  const canonical = resolveAuditLogPath();
  const target = input.targetPath ?? canonical;
  return {
    applied: false,
    deleted: 0,
    reason:
      target === canonical
        ? "Refused: canonical audit path is not a retention delete target"
        : "Refused: destructive product-audit purge is not implemented (hash-chain preserve)",
  };
}

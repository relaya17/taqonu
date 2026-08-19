import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "./common.schema.js";

/**
 * Standardized audit-entry shape — WHO / WHAT / WHEN / WHY / INPUT / OUTPUT /
 * POLICY / RISK / APPROVAL / RESULT — per the Atlas Control Plane vision doc
 * §1 "Universal Audit Log". This is additive: the existing NDJSON chain
 * (apps/api/src/services/audit-log.ts `appendAuditLogLine`) keeps accepting
 * freeform `Record<string, unknown>` payloads from ~28 existing call sites —
 * nothing there was changed. New call sites should prefer
 * `appendUnifiedAuditEntry()`, which validates against this schema before
 * writing to the same hash-chained file, so audit consumers can rely on a
 * consistent shape going forward without a risky big-bang migration.
 */

export const auditRiskLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export const auditApprovalStatusSchema = z.enum([
  "NOT_REQUIRED",
  "PENDING",
  "APPROVED",
  "REJECTED",
]);

export const auditResultStatusSchema = z.enum(["SUCCESS", "FAILURE", "PARTIAL"]);

export const auditActorKindSchema = z.enum(["USER", "AGENT", "SYSTEM"]);

export const unifiedAuditEntrySchema = z.object({
  id: uuidSchema.optional(),
  at: isoDateTimeSchema.optional(),
  /** WHAT happened, e.g. "patch.applied". */
  type: z.string().min(1).max(200),
  /** WHO performed the action — null when the actor genuinely can't be resolved. */
  actorId: z.string().min(1).max(200).nullable(),
  actorKind: auditActorKindSchema,
  /** WHY the action happened / was allowed. */
  reason: z.string().min(1).max(2000),
  /** INPUT that drove the action. */
  input: z.record(z.string(), z.unknown()).default({}),
  /** OUTPUT / effect produced. */
  output: z.record(z.string(), z.unknown()).default({}),
  /** Which POLICY (if any) evaluated this action. */
  policy: z.string().max(200).nullable().default(null),
  risk: auditRiskLevelSchema,
  approval: auditApprovalStatusSchema,
  result: auditResultStatusSchema,
  projectId: uuidSchema.nullable().optional(),
  correlationId: uuidSchema.optional(),
  /**
   * WHICH event/action directly caused this one, per `DomainEvent.causationId`
   * (the audit-log's own prior gap: `correlationId` was threaded through but
   * `causationId` was dropped even though `DomainEvent` always carries both).
   * Null/absent when the triggering event has no known cause (e.g. a
   * top-of-chain event).
   */
  causationId: uuidSchema.nullable().optional(),
  /**
   * Per-owner tagging (P1 fix): the tenant this audit entry belongs to, so
   * `listUnifiedAuditEntries({ ownerId })` (audit-log.ts) can filter "show me
   * only tenant X's audit trail" instead of every consumer reading the one
   * shared hash-chained log/stream. Null/absent when the entry is genuinely
   * system-wide or the owner can't be resolved at the call site (e.g. an
   * unauthenticated route) — callers must never fabricate a value here.
   */
  ownerId: uuidSchema.nullable().optional(),
});

export type UnifiedAuditEntry = z.infer<typeof unifiedAuditEntrySchema>;
export type UnifiedAuditEntryInput = z.input<typeof unifiedAuditEntrySchema>;

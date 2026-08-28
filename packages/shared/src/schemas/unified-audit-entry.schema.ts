import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "./common.schema.js";

/**
 * Standardized audit-entry shape — the complete evidence chain for governance.
 *
 * Fields answer the governance questions:
 * - WHO: actorId, actorKind, agentId, ownerId
 * - WHAT: type, toolName, entityType, action
 * - WHY: reason, intent
 * - WHEN: at
 * - WHICH: policy, model, authority, approvalId
 * - INPUT/OUTPUT: full payloads
 * - VERIFICATION: verificationVerdict, regressionVerdict
 * - CHAIN: correlationId, causationId, delegationHopCount
 *
 * Per the Atlas Control Plane vision doc §1 "Universal Audit Log".
 * New call sites should prefer `appendUnifiedAuditEntry()`.
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

export const auditVerificationVerdictSchema = z.enum([
  "VERIFIED",
  "FAILED",
  "PARTIAL",
  "INCONCLUSIVE",
  "BLOCKED",
  "NOT_APPLICABLE",
]);

export const auditDecisionSchema = z.enum([
  "ALLOW",
  "DENY",
  "REQUIRE_APPROVAL",
  "ESCALATE",
]);

export const unifiedAuditEntrySchema = z.object({
  id: uuidSchema.optional(),
  at: isoDateTimeSchema.optional(),

  /* ─────────────────────────────────────────────────────────────────────────
     WHAT happened
     ───────────────────────────────────────────────────────────────────────── */
  /** Event type, e.g. "patch.applied", "tool.executed", "approval.consumed". */
  type: z.string().min(1).max(200),
  /** Specific tool invoked (if applicable). */
  toolName: z.string().max(200).nullable().default(null),
  /** Business entity type being acted upon. */
  entityType: z.string().max(100).nullable().default(null),
  /** Action being performed on the entity. */
  action: z.string().max(100).nullable().default(null),

  /* ─────────────────────────────────────────────────────────────────────────
     WHO performed the action
     ───────────────────────────────────────────────────────────────────────── */
  /** Primary actor — null when genuinely unresolvable. */
  actorId: z.string().min(1).max(200).nullable(),
  actorKind: auditActorKindSchema,
  /** Fabric agent ID (when actorKind is AGENT). */
  agentId: z.string().max(100).nullable().default(null),
  /** Owner of the session/project. */
  ownerId: uuidSchema.nullable().optional(),
  /** Project context. */
  projectId: uuidSchema.nullable().optional(),

  /* ─────────────────────────────────────────────────────────────────────────
     WHY the action happened
     ───────────────────────────────────────────────────────────────────────── */
  /** Human-readable reason for the decision. */
  reason: z.string().min(1).max(2000),
  /** Original intent/goal that led to this action. */
  intent: z.string().max(1000).nullable().default(null),

  /* ─────────────────────────────────────────────────────────────────────────
     WHICH governance elements evaluated this
     ───────────────────────────────────────────────────────────────────────── */
  /** Policy label that evaluated this action. */
  policy: z.string().max(200).nullable().default(null),
  /** LLM model used (if applicable). */
  model: z.string().max(200).nullable().default(null),
  /** Authority scope under which this action was permitted. */
  authority: z.string().max(200).nullable().default(null),
  /** Risk assessment. */
  risk: auditRiskLevelSchema,
  /** Approval status. */
  approval: auditApprovalStatusSchema,
  /** Linked approval request ID (if approval was consumed). */
  approvalId: uuidSchema.nullable().default(null),
  /** Governance decision made. */
  decision: auditDecisionSchema.nullable().default(null),

  /* ─────────────────────────────────────────────────────────────────────────
     INPUT / OUTPUT
     ───────────────────────────────────────────────────────────────────────── */
  /** INPUT that drove the action. */
  input: z.record(z.string(), z.unknown()).default({}),
  /** OUTPUT / effect produced. */
  output: z.record(z.string(), z.unknown()).default({}),
  /** Hash of the artifact being acted upon. */
  artifactHash: z.string().max(128).nullable().default(null),

  /* ─────────────────────────────────────────────────────────────────────────
     VERIFICATION results
     ───────────────────────────────────────────────────────────────────────── */
  /** Execution result status. */
  result: auditResultStatusSchema,
  /** Post-execution verification verdict. */
  verificationVerdict: auditVerificationVerdictSchema.nullable().default(null),
  /** Regression assessment verdict. */
  regressionVerdict: auditVerificationVerdictSchema.nullable().default(null),

  /* ─────────────────────────────────────────────────────────────────────────
     CHAIN / TRACEABILITY
     ───────────────────────────────────────────────────────────────────────── */
  /** Request correlation ID for end-to-end tracing. */
  correlationId: uuidSchema.optional(),
  /** Causal chain: which prior event/action triggered this one. */
  causationId: uuidSchema.nullable().optional(),
  /** Delegation depth: how many agent-to-agent hops led here. */
  delegationHopCount: z.number().int().min(0).max(10).nullable().default(null),
  /** Stage at which the operating cycle blocked (if any). */
  blockedAt: z.string().max(50).nullable().default(null),
});

export type UnifiedAuditEntry = z.infer<typeof unifiedAuditEntrySchema>;
export type UnifiedAuditEntryInput = z.input<typeof unifiedAuditEntrySchema>;

export type AuditVerificationVerdict = z.infer<typeof auditVerificationVerdictSchema>;
export type AuditDecision = z.infer<typeof auditDecisionSchema>;

import {
  authorizeEntityAction,
  bucketForRiskScore,
  computeActionRiskScore,
  explainRiskScore,
  type BusinessEntityType,
  type EntityAction,
  type RiskBucket,
} from "@atlas/agent-core";
import {
  AtlasError,
  type UnifiedAuditEntryInput,
} from "@atlas/shared";
import { appendUnifiedAuditEntry } from "./audit-log.js";

/**
 * Single entry point that combines three previously-separate mechanisms
 * built across this project's security-hardening rounds:
 *
 *  1. The categorical entity-policy gate (`authorizeEntityAction`,
 *     `@atlas/agent-core`) — this round's established "self-approved
 *     signed-in-human-write" pattern (`mode:"WRITE", writeGateOpen:true,
 *     approved:true`): a signed-in human directly calling a write endpoint
 *     IS the approval for that action — no secondary approval-request
 *     round trip is layered on top here (that round-trip pattern is
 *     reserved for agent-*proposed* actions a human must separately
 *     review, e.g. code.ts's patch apply/rollback — a fundamentally
 *     different UX this helper does not attempt to replicate for direct
 *     human writes).
 *  2. The continuous 0-100 numeric Risk Engine (`computeActionRiskScore`/
 *     `bucketForRiskScore`/`explainRiskScore`, `risk-score.ts`) — reusing
 *     its EXISTING thresholds and formula unchanged. The `baseTier` fed in
 *     is the entity policy's own `EntityPolicy.risk` (`DEFAULT_ENTITY_POLICIES`,
 *     already the source of truth for how risky each entity/action pair
 *     is) — nothing here invents a new risk vocabulary or new thresholds.
 *  3. The Universal Audit Log (`appendUnifiedAuditEntry`,
 *     `unifiedAuditEntrySchema` — WHO/WHAT/WHEN/RESOURCE/TENANT/POLICY/
 *     RISK/APPROVAL/RESULT) with a REAL `actorId` (the caller must supply
 *     the signed-in user's id — never fabricated, never left `null` when
 *     a real signed-in user is available).
 *
 * `bucket` -> `risk` level mapping is the direct, motivated correspondence
 * between the numeric engine's 4 execution buckets and the audit schema's
 * 4 risk levels (both are 4-tier "how much scrutiny does this deserve"
 * ladders over the same underlying score):
 *   AUTO -> LOW, AUTO_LOG -> MEDIUM, APPROVAL -> HIGH, HUMAN_ONLY -> CRITICAL.
 *
 * Throws `AtlasError("FORBIDDEN", ..., {statusCode:403})` on a DENIED
 * decision (after logging the denial to the audit trail) — same contract
 * every `enforce<X>EntityAuthz` helper written this round already has, so
 * swapping a route over to this helper is a drop-in replacement.
 */
const BUCKET_TO_AUDIT_RISK: Record<RiskBucket, UnifiedAuditEntryInput["risk"]> = {
  AUTO: "LOW",
  AUTO_LOG: "MEDIUM",
  APPROVAL: "HIGH",
  HUMAN_ONLY: "CRITICAL",
};

export interface EnforceEntityWriteOptions {
  readonly entityType: BusinessEntityType;
  readonly action: EntityAction;
  /** Short dotted label, e.g. "connections.github.connect" — becomes both
   * the audit entry's `type` and part of the DENIED error message. */
  readonly routeLabel: string;
  /** The signed-in caller's id. Required — this helper exists specifically
   * to close the "actorId is null" accountability gap, so callers must
   * resolve a real user before calling it (every route already does, via
   * requireUser/requireSignedInForWrite/assertProjectWriteAccess). */
  readonly actorId: string;
  readonly projectId?: string | null;
  /** Extra input context worth recording on the audit entry (request body
   * fields relevant to the decision — never secrets). */
  readonly input?: Record<string, unknown>;
}

export interface EnforceEntityWriteResult {
  readonly score: number;
  readonly bucket: RiskBucket;
  readonly riskLevel: UnifiedAuditEntryInput["risk"];
}

export function enforceEntityWrite(
  options: EnforceEntityWriteOptions,
): EnforceEntityWriteResult {
  const entityAuthz = authorizeEntityAction(options.entityType, options.action, {
    mode: "WRITE",
    writeGateOpen: true,
    approved: true,
  });

  const policyLabel = `${options.entityType}.${options.action}`;

  if (entityAuthz.decision === "DENIED") {
    appendUnifiedAuditEntry({
      type: options.routeLabel,
      actorId: options.actorId,
      actorKind: "USER",
      reason: entityAuthz.reason,
      input: options.input ?? {},
      output: {},
      policy: policyLabel,
      risk: "CRITICAL",
      approval: "REJECTED",
      result: "FAILURE",
      projectId: options.projectId ?? null,
      ownerId: options.actorId,
    });
    throw new AtlasError("FORBIDDEN", entityAuthz.reason, { statusCode: 403 });
  }

  // ALLOWED or APPROVAL_REQUIRED both carry `.policy` (EntityPolicy),
  // which is what feeds the numeric engine's `baseTier`.
  const policy = entityAuthz.policy;
  const riskInput = {
    baseTier: policy.risk,
    requiresApproval:
      entityAuthz.decision === "APPROVAL_REQUIRED" || policy.requiresApproval,
  };
  const score = computeActionRiskScore(riskInput);
  const bucket = bucketForRiskScore(score);
  const explanation = explainRiskScore(riskInput);
  const riskLevel = BUCKET_TO_AUDIT_RISK[bucket];

  if (entityAuthz.decision !== "ALLOWED") {
    // Should not happen given mode:"WRITE" + writeGateOpen:true +
    // approved:true (see authorizeEntityAction's gating rules), but fail
    // safe rather than silently let an unexpected APPROVAL_REQUIRED
    // through — log it as a rejection, not a silent pass.
    appendUnifiedAuditEntry({
      type: options.routeLabel,
      actorId: options.actorId,
      actorKind: "USER",
      reason: `${options.routeLabel} (${policyLabel}) resolved to ${entityAuthz.decision}, expected ALLOWED under the self-approved-write pattern.`,
      input: options.input ?? {},
      output: {},
      policy: policyLabel,
      risk: riskLevel,
      approval: "REJECTED",
      result: "FAILURE",
      projectId: options.projectId ?? null,
      ownerId: options.actorId,
    });
    throw new AtlasError(
      "FORBIDDEN",
      `${options.routeLabel} (${policyLabel}) was not ALLOWED.`,
      { statusCode: 403 },
    );
  }

  appendUnifiedAuditEntry({
    type: options.routeLabel,
    actorId: options.actorId,
    actorKind: "USER",
    reason: explanation.factors.join("; "),
    input: options.input ?? {},
    output: {},
    policy: policyLabel,
    risk: riskLevel,
    approval: policy.requiresApproval ? "APPROVED" : "NOT_REQUIRED",
    result: "SUCCESS",
    projectId: options.projectId ?? null,
    ownerId: options.actorId,
  });

  return { score, bucket, riskLevel };
}

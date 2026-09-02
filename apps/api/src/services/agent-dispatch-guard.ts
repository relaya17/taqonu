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
  agentMayExecute,
  type AgentRuntimeControl,
  type ApprovalRequest,
  type UnifiedAuditEntryInput,
} from "@atlas/shared";
import { appendUnifiedAuditEntry } from "./audit-log.js";
import { createApprovalRequest } from "./approvals.js";

/**
 * Missing sibling to `enforceEntityWrite` (`risk-audit.ts`), for the actor
 * shape that helper was never built for: an AGENT or AUTOMATION initiating
 * an entity action, rather than a signed-in human directly calling a write
 * endpoint. This is the "no central dispatcher" gap — today, every agent or
 * automation call site that wants Policy Engine + Risk Engine + Audit Log
 * coverage has to hand-roll it, the same way routes did before
 * `enforceEntityWrite` existed for the human-write case. `dispatchAgentAction`
 * is that missing dispatcher for agent/automation-initiated writes.
 *
 * It deliberately does NOT reuse `enforceEntityWrite`'s contract, because the
 * two actor shapes have fundamentally different trust assumptions:
 *
 *  - `enforceEntityWrite` calls `authorizeEntityAction` with `approved:true`
 *    — a signed-in human calling a write endpoint directly IS the approval
 *    ("self-approved write"). It throws on anything but ALLOWED, because for
 *    that call shape APPROVAL_REQUIRED/DENIED are both exceptional.
 *  - `dispatchAgentAction` never takes a caller boolean as approval authority.
 *    `approved` for `authorizeEntityAction` is re-derived from a consumed
 *    `ApprovalRequest` (entity/action/artifact/`requestedBy` vs executor),
 *    matching `consumeApprovalRequest`. No record → same as today (`false`).
 *    A presented record that does not match fails closed (DENIED).
 *    APPROVAL_REQUIRED is an ordinary outcome when nothing matches. HUMAN_ONLY
 *    is never satisfied by a consumed record.
 *
 * On top of the Policy Engine + Risk Engine + Audit Log combination
 * `enforceEntityWrite` already established, this module adds two risk
 * *floors* that only make sense for agent/automation actors (see
 * `floorBucketForUntrustedSource` and the automation-tier check in
 * `dispatchAgentAction`): untrusted input content and automation actors
 * (no live human in the loop) both push the minimum achievable bucket up to
 * at least APPROVAL, no matter how low the raw numeric score computes.
 *
 * Like `enforceEntityWrite`, this is a GATE only — it never executes the
 * underlying entity action itself. Callers act on the returned decision
 * (execute on ALLOWED, wait on APPROVAL_REQUIRED, stop on DENIED).
 */

/** Who is initiating the action being gated. */
export type DispatchActorKind = "AGENT" | "AUTOMATION";

export interface DispatchActor {
  readonly kind: DispatchActorKind;
  /** The specialist/agent id (e.g. a FabricAgentId string) taking the action. */
  readonly agentId: string;
  /**
   * The human user this action is taken on behalf of, if any. AUTOMATION
   * actors typically have no live human in the loop at decision time —
   * this may be null for AUTOMATION, should normally be set for AGENT.
   */
  readonly onBehalfOfUserId: string | null;
}

/**
 * Whether the content driving this action decision (a user message, an
 * ingested document/webhook, etc.) can be trusted at face value. This is the
 * hook prompt-injection-style attacks live behind: content from
 * `external_ingested` sources (a scraped page, an inbound email, a third-
 * party webhook payload) can contain adversarial instructions an agent
 * should never auto-execute on, no matter how "safe" the raw entity/action
 * pair otherwise looks.
 */
export type SourceTrustLevel = "trusted" | "untrusted";

export interface DispatchSourceContext {
  /** Where the input driving this action decision originated. */
  readonly origin: "user_message" | "external_ingested" | "system";
  readonly trustLevel: SourceTrustLevel;
}

export interface DispatchAgentActionOptions {
  readonly actor: DispatchActor;
  readonly entityType: BusinessEntityType;
  readonly action: EntityAction;
  /** Short dotted label for the audit type, e.g. "agent-fabric.dispatch.security". */
  readonly routeLabel: string;
  readonly sourceContext: DispatchSourceContext;
  readonly projectId?: string | null;
  /** Extra input context worth recording on the audit entry (never secrets). */
  readonly input?: Record<string, unknown>;
  /** Known confidence/evidence signal if the caller has one (threaded to the risk scorer). Optional. */
  readonly confidence?: number;
  readonly evidenceCount?: number;
  /**
   * Control Plane runtime status. Checked at dispatch time, not only at
   * run start — PAUSED/QUARANTINED/REVOKED agents cannot take a new action.
   */
  readonly agentRuntimeStatus?:
    | "ACTIVE"
    | "PAUSED"
    | "DISABLED"
    | "REVOKED"
    | "QUARANTINED"
    | "SUSPENDED"
    | "DEGRADED"
    | "UNKNOWN";
  /** Agent A → B hops. Each hop floors to approval; never inherits unlimited authority. */
  readonly delegationHopCount?: number;
  /**
   * Consumed Stage-3 `ApprovalRequest` record. Re-derived here — not a boolean.
   * Absent → current behavior. Present but mismatched → DENIED (fail closed).
   */
  readonly consumedApproval?: ApprovalRequest;
}

export interface DispatchGovernanceEvaluation {
  readonly policy: {
    readonly result: "NOT_EVALUATED" | "ALLOWED" | "DENIED" | "APPROVAL_REQUIRED";
    readonly reason: string | null;
    readonly riskTier: "READ_ONLY" | "LOW_RISK_WRITE" | "HIGH_RISK_WRITE" | "DESTRUCTIVE" | null;
    readonly requiresApproval: boolean | null;
  };
  readonly risk: {
    readonly status: "NOT_EVALUATED" | "EVALUATED";
    readonly score: number | null;
    readonly rawBucket: RiskBucket | null;
    readonly effectiveBucket: RiskBucket | null;
    readonly factors: readonly string[];
    readonly floors: {
      readonly untrustedSource: boolean;
      readonly automationActor: boolean;
      readonly delegation: boolean;
    };
  };
}

export type DispatchAgentActionResult =
  | {
      readonly decision: "ALLOWED";
      readonly score: number;
      readonly bucket: RiskBucket;
      readonly auditId: string | null;
      readonly evaluation: DispatchGovernanceEvaluation;
    }
  | {
      readonly decision: "DENIED";
      readonly reason: string;
      readonly evaluation: DispatchGovernanceEvaluation;
    }
  | {
      readonly decision: "APPROVAL_REQUIRED";
      readonly approvalRequestId: string;
      readonly score: number;
      readonly bucket: RiskBucket;
      readonly evaluation: DispatchGovernanceEvaluation;
    };

export function unevaluatedGovernanceEvaluation(
  policyResult: "NOT_EVALUATED" | "DENIED",
  policyReason: string,
): DispatchGovernanceEvaluation {
  return {
    policy: {
      result: policyResult,
      reason: policyReason,
      riskTier: null,
      requiresApproval: null,
    },
    risk: {
      status: "NOT_EVALUATED",
      score: null,
      rawBucket: null,
      effectiveBucket: null,
      factors: [],
      floors: {
        untrustedSource: false,
        automationActor: false,
        delegation: false,
      },
    },
  };
}

const BUCKET_TO_AUDIT_RISK: Record<RiskBucket, UnifiedAuditEntryInput["risk"]> = {
  AUTO: "LOW",
  AUTO_LOG: "MEDIUM",
  APPROVAL: "HIGH",
  HUMAN_ONLY: "CRITICAL",
};

/** Buckets ordered from least to most scrutiny, for taking the "stricter of" two buckets. */
const BUCKET_ORDER: Record<RiskBucket, number> = {
  AUTO: 0,
  AUTO_LOG: 1,
  APPROVAL: 2,
  HUMAN_ONLY: 3,
};

function stricterBucket(a: RiskBucket, b: RiskBucket): RiskBucket {
  return BUCKET_ORDER[a] >= BUCKET_ORDER[b] ? a : b;
}

/**
 * Floors an already-computed bucket to at least APPROVAL when the content
 * driving the decision is `untrusted`, WITHOUT touching the underlying
 * numeric score. This is a deliberate design choice: the score stays
 * honest/explainable (it still reflects exactly what `computeActionRiskScore`
 * says about the entity/action/confidence/evidence inputs — useful for audit
 * trails and later tuning), and only the bucket *enforcement* changes. If we
 * instead inflated the score to force a stricter bucket, the audit trail
 * would misrepresent why the action was risky (untrusted source, not an
 * intrinsically dangerous action) and would corrupt any future analysis of
 * the raw scoring formula itself.
 *
 * Never lowers scrutiny: a bucket already stricter than APPROVAL (i.e.
 * HUMAN_ONLY) is left untouched.
 */
function floorBucketForUntrustedSource(
  bucket: RiskBucket,
  trustLevel: SourceTrustLevel,
): RiskBucket {
  if (trustLevel !== "untrusted") return bucket;
  return stricterBucket(bucket, "APPROVAL");
}

/** State-mutating entity actions an AUTOMATION actor may never silently execute (see `dispatchAgentAction` step 5). */
const AUTOMATION_FLOORED_ACTIONS: ReadonlySet<EntityAction> = new Set([
  "CREATE",
  "UPDATE",
  "DELETE",
]);

/**
 * Floors an already-computed bucket to at least APPROVAL when the actor is
 * AUTOMATION taking a state-mutating action (CREATE/UPDATE/DELETE).
 * AUTOMATION actors have no live human in the loop the way an AGENT
 * typically does (`DispatchActor.onBehalfOfUserId`) — so any action that
 * changes state needs a human decision before it runs, not silent execution
 * on a favorable risk score. READ/EXECUTE are not floored by this rule
 * (EXECUTE's own entity policy already carries its own, often stricter,
 * approval requirements per `DEFAULT_ENTITY_POLICIES`).
 */
function floorBucketForAutomationActor(
  bucket: RiskBucket,
  actorKind: DispatchActorKind,
  action: EntityAction,
): RiskBucket {
  if (actorKind !== "AUTOMATION") return bucket;
  if (!AUTOMATION_FLOORED_ACTIONS.has(action)) return bucket;
  return stricterBucket(bucket, "APPROVAL");
}

/**
 * Same binding `consumeApprovalRequest` enforces: entity, action, executor
 * vs `requestedBy`, and artifact when the record is artifact-bound.
 * Status must already be CONSUMED — Stage 3 is the only producer.
 */
function consumedApprovalMatchesGovernedAction(
  record: ApprovalRequest,
  current: {
    readonly entityType: string;
    readonly action: string;
    readonly executorId: string;
    readonly artifactHash?: string;
  },
): boolean {
  if (record.status !== "CONSUMED") return false;
  if (record.entityType !== current.entityType) return false;
  if (record.action !== current.action) return false;
  if (current.executorId !== record.requestedBy) return false;
  if (record.artifactHash) {
    if (current.artifactHash === undefined) return false;
    if (current.artifactHash !== record.artifactHash) return false;
  }
  return true;
}

function presentedArtifactHash(
  input: Record<string, unknown> | undefined,
): string | undefined {
  const value = input?.["artifactHash"];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export async function dispatchAgentAction(
  options: DispatchAgentActionOptions,
): Promise<DispatchAgentActionResult> {
  const { actor, entityType, action, routeLabel, sourceContext } = options;
  const policyLabel = `${entityType}.${action}`;

  if (
    options.agentRuntimeStatus &&
    !agentMayExecute(options.agentRuntimeStatus as AgentRuntimeControl)
  ) {
    appendUnifiedAuditEntry({
      type: routeLabel,
      actorId: actor.agentId,
      actorKind: "AGENT",
      agentId: actor.agentId,
      reason: `Agent runtime control ${options.agentRuntimeStatus} blocks execution`,
      input: options.input ?? {},
      output: {},
      policy: policyLabel,
      risk: "CRITICAL",
      approval: "REJECTED",
      result: "FAILURE",
      decision: "DENY",
      projectId: options.projectId ?? null,
      ownerId: actor.onBehalfOfUserId,
      delegationHopCount: options.delegationHopCount ?? null,
      blockedAt: "AUTHORIZATION",
    });
    return {
      decision: "DENIED",
      reason: `Agent ${actor.agentId} is ${options.agentRuntimeStatus} and cannot execute`,
      evaluation: unevaluatedGovernanceEvaluation(
        "NOT_EVALUATED",
        `Agent runtime control ${options.agentRuntimeStatus} blocks policy evaluation`,
      ),
    };
  }

  // Step 1: never a caller boolean. A consumed record is re-checked against
  // this exact entity/action/executor/artifact. No record → approved false
  // (today). A presented mismatch fails closed and does not open the write gate.
  const artifactHash = presentedArtifactHash(options.input);
  const approvalSatisfied = options.consumedApproval
    ? consumedApprovalMatchesGovernedAction(options.consumedApproval, {
        entityType,
        action,
        executorId: actor.agentId,
        ...(artifactHash !== undefined ? { artifactHash } : {}),
      })
    : false;

  if (options.consumedApproval !== undefined && !approvalSatisfied) {
    const reason = "Consumed approval does not match this governed action";
    appendUnifiedAuditEntry({
      type: routeLabel,
      actorId: actor.agentId,
      actorKind: "AGENT",
      agentId: actor.agentId,
      reason,
      input: options.input ?? {},
      output: {},
      policy: policyLabel,
      risk: "CRITICAL",
      approval: "REJECTED",
      result: "FAILURE",
      decision: "DENY",
      entityType,
      action,
      projectId: options.projectId ?? null,
      ownerId: actor.onBehalfOfUserId,
      delegationHopCount: options.delegationHopCount ?? null,
      blockedAt: "APPROVAL",
    });
    return {
      decision: "DENIED",
      reason,
      evaluation: unevaluatedGovernanceEvaluation("DENIED", reason),
    };
  }

  const entityAuthz = authorizeEntityAction(entityType, action, {
    mode: "WRITE",
    writeGateOpen: true,
    approved: approvalSatisfied,
  });

  if (entityAuthz.decision === "DENIED") {
    appendUnifiedAuditEntry({
      type: routeLabel,
      actorId: actor.agentId,
      actorKind: "AGENT",
      agentId: actor.agentId,
      reason: entityAuthz.reason,
      input: options.input ?? {},
      output: {},
      policy: policyLabel,
      risk: "CRITICAL",
      approval: "REJECTED",
      result: "FAILURE",
      decision: "DENY",
      entityType,
      action,
      projectId: options.projectId ?? null,
      ownerId: actor.onBehalfOfUserId,
      delegationHopCount: options.delegationHopCount ?? null,
      blockedAt: "POLICY",
    });
    return {
      decision: "DENIED",
      reason: entityAuthz.reason,
      evaluation: unevaluatedGovernanceEvaluation("DENIED", entityAuthz.reason),
    };
  }

  // ALLOWED or APPROVAL_REQUIRED both carry `.policy` (EntityPolicy), which
  // is what feeds the numeric engine's `baseTier` — same reuse discipline as
  // `enforceEntityWrite`: no new risk vocabulary invented here.
  const policy = entityAuthz.policy;
  const riskInput = {
    baseTier: policy.risk,
    requiresApproval: entityAuthz.decision === "APPROVAL_REQUIRED" || policy.requiresApproval,
    // Spread conditionally (rather than always including the keys) because
    // this project builds with `exactOptionalPropertyTypes: true`: an
    // explicit `confidence: undefined` is a different type than an absent
    // key, so callers who didn't pass a signal must omit the key entirely
    // and let `computeActionRiskScore`'s own conservative defaults apply —
    // exactly as documented in `DispatchAgentActionOptions`.
    ...(options.confidence !== undefined ? { confidence: options.confidence } : {}),
    ...(options.evidenceCount !== undefined ? { evidenceCount: options.evidenceCount } : {}),
  };
  const score = computeActionRiskScore(riskInput);
  const rawBucket = bucketForRiskScore(score);
  const explanation = explainRiskScore(riskInput);

  // Step 4 + 5: apply both floors, then combine by taking the stricter of
  // the raw computed bucket and whatever each floor independently produces
  // — an absent floor must never move the bucket to LESS scrutiny than the
  // raw score already implied.
  const untrustedFloored = floorBucketForUntrustedSource(rawBucket, sourceContext.trustLevel);
  const automationFloored = floorBucketForAutomationActor(rawBucket, actor.kind, action);
  const delegationFloored =
    (options.delegationHopCount ?? 0) > 0
      ? stricterBucket(rawBucket, "APPROVAL")
      : rawBucket;
  const bucket = stricterBucket(
    stricterBucket(untrustedFloored, automationFloored),
    delegationFloored,
  );
  const riskLevel = BUCKET_TO_AUDIT_RISK[bucket];
  const evaluation: DispatchGovernanceEvaluation = {
    policy: {
      result: entityAuthz.decision,
      reason: null,
      riskTier: policy.risk,
      requiresApproval: policy.requiresApproval,
    },
    risk: {
      status: "EVALUATED",
      score,
      rawBucket,
      effectiveBucket: bucket,
      factors: explanation.factors,
      floors: {
        untrustedSource: sourceContext.trustLevel === "untrusted",
        automationActor:
          actor.kind === "AUTOMATION" && AUTOMATION_FLOORED_ACTIONS.has(action),
        delegation: (options.delegationHopCount ?? 0) > 0,
      },
    },
  };

  const needsApproval =
    bucket === "HUMAN_ONLY" ||
    (!approvalSatisfied &&
      (bucket === "APPROVAL" || entityAuthz.decision === "APPROVAL_REQUIRED"));

  if (needsApproval) {
    // requestedBy must be a real, non-fabricated identity: when there's a
    // human on behalf of whom this action is taken, that human requested
    // it; when there is none (a bare AUTOMATION actor), the agent itself is
    // the genuine requester — not a fabricated placeholder.
    const requestedBy = actor.onBehalfOfUserId ?? actor.agentId;
    const approvalRequest = await createApprovalRequest({
      entityType,
      action,
      requestedBy,
      reason: explanation.factors.join("; "),
      context: {
        routeLabel,
        actorKind: actor.kind,
        agentId: actor.agentId,
        onBehalfOfUserId: actor.onBehalfOfUserId,
        sourceOrigin: sourceContext.origin,
        sourceTrustLevel: sourceContext.trustLevel,
        score,
        bucket,
        projectId: options.projectId ?? null,
        input: options.input ?? {},
      },
    });

    appendUnifiedAuditEntry({
      type: routeLabel,
      actorId: actor.agentId,
      actorKind: "AGENT",
      agentId: actor.agentId,
      reason: explanation.factors.join("; "),
      input: options.input ?? {},
      output: { approvalRequestId: approvalRequest.id },
      policy: policyLabel,
      risk: riskLevel,
      approval: "PENDING",
      // This action has NOT executed — it is now pending a human decision,
      // so "SUCCESS" (the write itself succeeded) would misrepresent the
      // outcome and "FAILURE" would misrepresent an ordinary, expected
      // routing to approval as an error. PARTIAL is the most honest value
      // `auditResultStatusSchema` offers for "gate resolved, execution held".
      result: "PARTIAL",
      decision: "REQUIRE_APPROVAL",
      entityType,
      action,
      approvalId: approvalRequest.id,
      projectId: options.projectId ?? null,
      ownerId: actor.onBehalfOfUserId,
      delegationHopCount: options.delegationHopCount ?? null,
      blockedAt: "APPROVAL",
    });

    return {
      decision: "APPROVAL_REQUIRED",
      approvalRequestId: approvalRequest.id,
      score,
      bucket,
      evaluation,
    };
  }

  // Only AUTO/AUTO_LOG buckets with no approval requirement reach here. This
  // function does not execute the underlying action itself — same
  // gate/guard-only division of responsibility as `enforceEntityWrite`; the
  // caller executes and is responsible for recording that outcome.
  const record = appendUnifiedAuditEntry({
    type: routeLabel,
    actorId: actor.agentId,
    actorKind: "AGENT",
    agentId: actor.agentId,
    reason: explanation.factors.join("; "),
    input: options.input ?? {},
    output: {},
    policy: policyLabel,
    risk: riskLevel,
    approval: "NOT_REQUIRED",
    result: "SUCCESS",
    decision: "ALLOW",
    entityType,
    action,
    projectId: options.projectId ?? null,
    ownerId: actor.onBehalfOfUserId,
    delegationHopCount: options.delegationHopCount ?? null,
  });

  return { decision: "ALLOWED", score, bucket, auditId: record.id, evaluation };
}

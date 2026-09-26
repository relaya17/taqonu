import {
  authorizeEntityAction,
  bucketForRiskScore,
  computeActionRiskScore,
  explainRiskScore,
  type BusinessEntityType,
  type EntityAction,
  type KillSwitchCategory,
  type RiskBucket,
} from "@atlas/agent-core";
import { firstActiveEffectiveKillSwitch } from "./kill-switch-runtime.js";
import {
  agentMayExecute,
  combineAgentRuntimeStatus,
  effectiveDelegationHopCount,
  MAX_DELEGATION_HOP_COUNT,
  type AgentRuntimeControl,
  type ApprovalRequest,
  type UnifiedAuditEntryInput,
} from "@atlas/shared";
import { appendUnifiedAuditEntry } from "./audit-log.js";
import { createApprovalRequest } from "./approvals.js";
import {
  detectRepeatedViolations,
  type BehavioralOutcomeRecord,
  type RepeatedViolationResult,
} from "./behavioral-monitor.js";

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
 *    `approved` for `authorizeEntityAction` is re-derived from a CLAIMED
 *    `ApprovalRequest` (entity/action/artifact/`requestedBy`/`claimedBy` vs
 *    executor). No record → same as today (`false`).
 *    A presented record that does not match fails closed (DENIED).
 *    APPROVAL_REQUIRED is an ordinary outcome when nothing matches. HUMAN_ONLY
 *    is never satisfied by a claimed AGENT/AUTOMATION record (approval-token
 *    replay). The sole, narrow exception is a `HUMAN`-kind actor whose claim
 *    traces to a live, separation-of-duties-checked decision recorded on the
 *    approval itself (`decidedBy !== requestedBy`, atomically bound to the
 *    claim by `claim_live_approval_request_as_live_human` -- see
 *    `claimedApprovalMatchesGovernedAction` and `live-human-execution.ts`).
 *    `HUMAN` is set only by that dedicated decide-and-execute path; no other
 *    caller may construct it.
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
export type DispatchActorKind = "AGENT" | "AUTOMATION" | "HUMAN";

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
 * Stage 4 attribution (approved 2026-09-26): the unified audit must never
 * record a human user id as an `agentId`. Human-initiated governed requests
 * keep their conservative gate classification (`kind: "AGENT"`, never the
 * privileged live-human `HUMAN` carve-out), but when the gate "agent" id is
 * the requesting human's own id, the audit attributes the action to that
 * USER and leaves `agentId` empty. Gate semantics and approval context are
 * unchanged.
 */
function isHumanProxyActor(actor: DispatchActor): boolean {
  return (
    actor.kind === "HUMAN" ||
    (actor.onBehalfOfUserId !== null && actor.agentId === actor.onBehalfOfUserId)
  );
}

export function auditActorKind(actor: DispatchActor): "USER" | "AGENT" {
  return isHumanProxyActor(actor) ? "USER" : "AGENT";
}

export function auditAgentId(actor: DispatchActor): string | null {
  return isHumanProxyActor(actor) ? null : actor.agentId;
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
    | "RETIRED"
    | "UNKNOWN";
  /**
   * Step 4 Decision C. True only when `agentRuntimeStatus` is "UNKNOWN"
   * because Control Plane's ephemeral overlay (SUSPENDED/DEGRADED) could
   * not be read -- never because of a durable PAUSED/QUARANTINED/REVOKED/
   * DISABLED override (Decision B's in-process read never depends on
   * Control Plane reachability), and never a general "CP said UNKNOWN"
   * determination. When true AND the resolved status is "UNKNOWN", the
   * runtime-status hard block below becomes action-class-aware: READ
   * proceeds to ordinary policy/risk evaluation, every mutating/executing
   * action still fails closed exactly as before. Absent (the default for
   * every existing caller) keeps today's unconditional fail-closed
   * behavior -- this is opt-in per call site, never a silent widening of
   * what executes.
   */
  readonly controlPlaneUnreachable?: boolean;
  /** Agent A → B hops. Each hop floors to approval; never inherits unlimited authority. */
  readonly delegationHopCount?: number;
  /** When DELEGATED, omitted hop count floors to 1 rather than 0. */
  readonly trustLevel?: "FULL" | "DELEGATED" | "LAB";
  /**
   * HTTP / CP request id for the same handoff. Recorded on the audit entry
   * so an operator can join CP → API without a second telemetry stack.
   */
  readonly requestId?: string;
  /**
   * Stage 4 (D-C): id of the audit record that caused this dispatch (e.g.
   * the `psa.request` entry). Recorded as `causationId`; never an actor.
   */
  readonly causationId?: string;
  /**
   * Claimed Stage-3 `ApprovalRequest` record. Re-derived here — not a boolean.
   * Absent → current behavior. Present but mismatched → DENIED (fail closed).
   */
  readonly claimedApproval?: ApprovalRequest;
  /**
   * Additional kill-switch categories this action should be gated on (e.g.
   * "payments" for a commission payout). `"agentDispatch"` — the master
   * switch — is always checked regardless of this option. See
   * `@atlas/agent-core`'s `kill-switches.ts`.
   */
  readonly killSwitchCategories?: readonly KillSwitchCategory[];

  /**
   * F-07 (behavioral monitoring). The caller's own recent, already-scoped
   * outcome history for THIS agent (optionally further scoped by
   * `projectId`), if the caller has one available -- e.g. a slice of
   * `listUnifiedAuditEntries({ actorId: actor.agentId })`. Absent or empty
   * -- the default for every existing call site -- is IDENTICAL to
   * pre-F-07 behavior: no behavioral floor is ever applied unless the
   * caller explicitly opts in by supplying history. This function never
   * fetches its own history and never reaches outside the inputs it is
   * given. See `behavioral-monitor.ts`'s `detectRepeatedViolations`.
   */
  readonly recentOutcomes?: readonly BehavioralOutcomeRecord[];
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
      readonly behavioralPattern: boolean;
      readonly degradedAgent: boolean;
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
        behavioralPattern: false,
        degradedAgent: false,
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
 * DEGRADED-floored actions: the mutating/executing quadruplet. READ is
 * deliberately excluded -- it is the one EntityAction with no
 * `requiresApproval: true` cell anywhere in `DEFAULT_ENTITY_POLICIES`, and
 * it is the RESEARCHER agent's core evidence-gathering function
 * (`governed-knowledge-retrieval.ts`). Flooring READ would block a
 * degraded agent from the one activity that most helps it behave safely --
 * "reduced confidence" should mean more scrutiny on what it changes, not
 * less ability to look. See the Step 3 DEGRADED-scope decision.
 */
const DEGRADED_FLOORED_ACTIONS: ReadonlySet<EntityAction> = new Set([
  "CREATE",
  "UPDATE",
  "DELETE",
  "EXECUTE",
]);

/**
 * Floors an already-computed bucket to at least APPROVAL when the acting
 * agent's own resolved runtime status is DEGRADED and the action is one of
 * CREATE/UPDATE/DELETE/EXECUTE. DEGRADED is a risk *modifier*, not a hard
 * execution block -- it is intentionally absent from `NON_EXECUTABLE`
 * (`operating-cycle.ts`), unlike PAUSED/QUARANTINED/REVOKED/etc., which
 * already deny outright before this function is ever reached (see the
 * `agentMayExecute` check earlier in `dispatchAgentAction`). Reuses the
 * exact composition pattern every other floor in this file already uses:
 * independent, `stricterBucket`-only, never loosens, never grants extra
 * authority on failure (a `runtimeStatus` of `undefined` is simply not
 * DEGRADED, so this floor is a no-op for every caller that does not yet
 * supply `agentRuntimeStatus`).
 */
function floorBucketForDegradedAgent(
  bucket: RiskBucket,
  runtimeStatus: AgentRuntimeControl | undefined,
  action: EntityAction,
): RiskBucket {
  if (runtimeStatus !== "DEGRADED") return bucket;
  if (!DEGRADED_FLOORED_ACTIONS.has(action)) return bucket;
  return stricterBucket(bucket, "APPROVAL");
}

/**
 * Claimed-record match: status CLAIMED, entity, action, executor vs
 * requestedBy and claimedBy, and artifact when the record is artifact-bound.
 */
function claimedApprovalMatchesGovernedAction(
  record: ApprovalRequest,
  current: {
    readonly entityType: string;
    readonly action: string;
    readonly executorId: string;
    readonly artifactHash?: string;
    readonly actorKind: DispatchActorKind;
  },
): boolean {
  if (record.status !== "CLAIMED") return false;
  if (record.entityType !== current.entityType) return false;
  if (record.action !== current.action) return false;
  if (record.claimedBy !== current.executorId) return false;

  if (current.actorKind === "HUMAN") {
    // Live-human proof, re-derived entirely from the durable record --
    // never from a caller-supplied flag. `claim_live_approval_request_as_
    // live_human` (the ONLY function that can put a record in this state
    // for a HUMAN actor) atomically set `claimedBy = decidedBy` and
    // enforced `decidedBy !== requestedBy` at the database layer itself.
    // Re-checking both here is defense in depth, not reliance on the
    // database having done it correctly: a record that doesn't carry a
    // matching, separation-of-duties-respecting decision fails closed,
    // exactly like every other mismatch this function checks.
    if (!record.decidedBy) return false;
    if (record.decidedBy !== record.claimedBy) return false;
    if (record.decidedBy === record.requestedBy) return false;
  } else {
    // AGENT/AUTOMATION: unchanged, existing approval-token-replay contract
    // -- the claiming executor must be the identity that originally
    // requested the approval.
    if (current.executorId !== record.requestedBy) return false;
  }

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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function auditRequestBinding(options: DispatchAgentActionOptions): {
  readonly input: Record<string, unknown>;
  readonly correlationId?: string;
  readonly causationId?: string;
} {
  const input = {
    ...(options.input ?? {}),
    ...(options.requestId !== undefined ? { requestId: options.requestId } : {}),
  };
  const correlationId =
    typeof options.requestId === "string" && UUID_RE.test(options.requestId)
      ? options.requestId
      : undefined;
  const causationId =
    typeof options.causationId === "string" && UUID_RE.test(options.causationId)
      ? options.causationId
      : undefined;
  return {
    input,
    ...(correlationId !== undefined ? { correlationId } : {}),
    ...(causationId !== undefined ? { causationId } : {}),
  };
}

export async function dispatchAgentAction(
  options: DispatchAgentActionOptions,
): Promise<DispatchAgentActionResult> {
  const { actor, entityType, action, routeLabel, sourceContext } = options;
  const policyLabel = `${entityType}.${action}`;
  const { input: auditInput, correlationId, causationId } = auditRequestBinding(options);

  // Kill switch: checked before anything else, including policy/risk. This
  // is an operator emergency stop, not an ordinary governance decision --
  // see `firstActiveKillSwitch` in `@atlas/agent-core`. Resolved against the
  // EFFECTIVE state (env baseline UNION durable runtime override -- Task 7)
  // via `firstActiveEffectiveKillSwitch`, which merges `osStore`'s runtime
  // overrides into a synthetic env before delegating to the unmodified
  // `firstActiveKillSwitch` primitive. See `kill-switch-runtime.ts`.
  const killSwitch = firstActiveEffectiveKillSwitch(options.killSwitchCategories ?? []);
  if (killSwitch !== null) {
    const reason = `Kill switch "${killSwitch.category}" is active -- agent/automation dispatch is denied`;
    appendUnifiedAuditEntry({
      type: routeLabel,
      actorId: actor.agentId,
      actorKind: auditActorKind(actor),
      agentId: auditAgentId(actor),
      reason,
      input: auditInput,
      output: { killSwitchCategory: killSwitch.category },
      policy: policyLabel,
      risk: "CRITICAL",
      approval: "REJECTED",
      result: "FAILURE",
      decision: "DENY",
      entityType,
      action,
      projectId: options.projectId ?? null,
      ownerId: actor.onBehalfOfUserId,
      ...(correlationId !== undefined ? { correlationId } : {}),
      ...(causationId !== undefined ? { causationId } : {}),
      blockedAt: "KILL_SWITCH",
    });
    return {
      decision: "DENIED",
      reason,
      evaluation: unevaluatedGovernanceEvaluation("DENIED", reason),
    };
  }

  const hops = effectiveDelegationHopCount({
    ...(options.delegationHopCount !== undefined
      ? { delegationHopCount: options.delegationHopCount }
      : {}),
    ...(options.trustLevel !== undefined ? { trustLevel: options.trustLevel } : {}),
  });
  const runtimeStatus = options.agentRuntimeStatus
    ? combineAgentRuntimeStatus(options.agentRuntimeStatus)
    : undefined;

  if (hops > MAX_DELEGATION_HOP_COUNT) {
    appendUnifiedAuditEntry({
      type: routeLabel,
      actorId: actor.agentId,
      actorKind: auditActorKind(actor),
      agentId: auditAgentId(actor),
      reason: `Excessive delegation depth hops=${hops} exceeds ${MAX_DELEGATION_HOP_COUNT}`,
      input: auditInput,
      output: { hops },
      policy: policyLabel,
      risk: "CRITICAL",
      approval: "REJECTED",
      result: "FAILURE",
      decision: "DENY",
      projectId: options.projectId ?? null,
      ownerId: actor.onBehalfOfUserId,
      ...(correlationId !== undefined ? { correlationId } : {}),
      ...(causationId !== undefined ? { causationId } : {}),
      delegationHopCount: MAX_DELEGATION_HOP_COUNT,
      blockedAt: "AUTHORIZATION",
    });
    return {
      decision: "DENIED",
      reason: `Excessive delegation depth hops=${hops} exceeds ${MAX_DELEGATION_HOP_COUNT}`,
      evaluation: unevaluatedGovernanceEvaluation(
        "NOT_EVALUATED",
        "Delegation depth exceeds the audit-bound maximum",
      ),
    };
  }

  // Step 4 Decision C: when the ONLY reason runtimeStatus is "UNKNOWN" is
  // that Control Plane's ephemeral overlay (SUSPENDED/DEGRADED) could not
  // be read -- not a genuine UNKNOWN determination, and not any durable
  // PAUSED/QUARANTINED/REVOKED/DISABLED block, which Decision B reads
  // in-process and never depends on Control Plane reachability -- the
  // fail-open/fail-closed decision becomes action-class-aware here, at the
  // one chokepoint that already knows both identity and action: READ
  // proceeds to ordinary policy/risk evaluation (never itself approval-
  // gated); every mutating/executing action (CREATE/UPDATE/DELETE/EXECUTE)
  // still fails closed exactly as before. A caller that does not supply
  // `controlPlaneUnreachable` gets today's unconditional fail-closed
  // behavior for any UNKNOWN status -- this is opt-in per call site, never
  // a silent widening of what executes.
  const controlPlaneOutageFailOpen =
    runtimeStatus === "UNKNOWN" && options.controlPlaneUnreachable === true && action === "READ";

  if (
    runtimeStatus !== undefined &&
    !agentMayExecute(runtimeStatus as AgentRuntimeControl) &&
    !controlPlaneOutageFailOpen
  ) {
    appendUnifiedAuditEntry({
      type: routeLabel,
      actorId: actor.agentId,
      actorKind: auditActorKind(actor),
      agentId: auditAgentId(actor),
      reason: `Agent runtime control ${options.agentRuntimeStatus} blocks execution`,
      input: auditInput,
      output: {},
      policy: policyLabel,
      risk: "CRITICAL",
      approval: "REJECTED",
      result: "FAILURE",
      decision: "DENY",
      projectId: options.projectId ?? null,
      ownerId: actor.onBehalfOfUserId,
      ...(correlationId !== undefined ? { correlationId } : {}),
      ...(causationId !== undefined ? { causationId } : {}),
      delegationHopCount: hops,
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

  // Step 1: never a caller boolean. A claimed record is re-checked against
  // this exact entity/action/executor/artifact. No record → approved false
  // (today). A presented mismatch fails closed and does not open the write gate.
  const artifactHash = presentedArtifactHash(options.input);
  const approvalSatisfied = options.claimedApproval
    ? claimedApprovalMatchesGovernedAction(options.claimedApproval, {
        entityType,
        action,
        executorId: actor.agentId,
        actorKind: actor.kind,
        ...(artifactHash !== undefined ? { artifactHash } : {}),
      })
    : false;

  if (options.claimedApproval !== undefined && !approvalSatisfied) {
    const reason = "Claimed approval does not match this governed action";
    appendUnifiedAuditEntry({
      type: routeLabel,
      actorId: actor.agentId,
      actorKind: auditActorKind(actor),
      agentId: auditAgentId(actor),
      reason,
      input: auditInput,
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
      ...(correlationId !== undefined ? { correlationId } : {}),
      ...(causationId !== undefined ? { causationId } : {}),
      delegationHopCount: hops,
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
      actorKind: auditActorKind(actor),
      agentId: auditAgentId(actor),
      reason: entityAuthz.reason,
      input: auditInput,
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
      ...(correlationId !== undefined ? { correlationId } : {}),
      ...(causationId !== undefined ? { causationId } : {}),
      delegationHopCount: hops,
      // Universal Permanent Prohibition (FORBIDDEN) is a categorically
      // different kind of denial from an ordinary policy/mode/write-gate
      // rejection: it can never be resolved by presenting an approval,
      // Dual Control, or a live-human claim, whereas "POLICY" denials
      // otherwise could be (wrong mode, write-gate closed, etc., are
      // circumstantial). `entityAuthz.forbidden` is the single
      // authoritative flag threaded straight from `EntityPolicy.forbidden`
      // through `authorizeEntityAction`, so an auditor can distinguish
      // "not authorized yet" from "can never be authorized" on this one
      // audit entry without cross-referencing anything else.
      blockedAt: entityAuthz.forbidden ? "FORBIDDEN" : "POLICY",
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
    hops > 0 ? stricterBucket(rawBucket, "APPROVAL") : rawBucket;
  const degradedFloored = floorBucketForDegradedAgent(rawBucket, runtimeStatus, action);

  // F-07 (behavioral monitoring): floors to at least APPROVAL when this
  // agent's own recent (caller-supplied) history shows a repeated
  // governance-violation pattern (see `detectRepeatedViolations`). Wrapped
  // so ANY failure here -- a malformed record, an unexpected shape --
  // degrades to "no behavioral floor", i.e. exactly today's pre-F-07
  // enforcement, and NEVER to granting extra authority: every other floor
  // and the underlying policy/risk decision above are computed completely
  // independently of this block and remain fully authoritative regardless
  // of what happens here. This classification never executes, approves, or
  // mutates anything by itself.
  let behavioralPattern: RepeatedViolationResult | null = null;
  try {
    if (options.recentOutcomes && options.recentOutcomes.length > 0) {
      const classification = detectRepeatedViolations(actor.agentId, options.recentOutcomes, {
        projectId: options.projectId ?? null,
      });
      if (classification.status === "VIOLATION_PATTERN_DETECTED") {
        behavioralPattern = classification;
      }
    }
  } catch {
    behavioralPattern = null;
  }
  const behavioralFloored = behavioralPattern ? stricterBucket(rawBucket, "APPROVAL") : rawBucket;

  const bucketBeforeDegraded = stricterBucket(
    stricterBucket(stricterBucket(untrustedFloored, automationFloored), delegationFloored),
    behavioralFloored,
  );
  const bucket = stricterBucket(bucketBeforeDegraded, degradedFloored);
  // Step 4 Decision A (freshness sub-decision, approved): a pre-existing
  // claimed approval must NOT satisfy a bucket that DEGRADED is what
  // pushed to APPROVAL/HUMAN_ONLY -- if the acting agent became DEGRADED
  // after that approval was decided, this floor's whole purpose (more
  // scrutiny on a now-less-trusted agent) would otherwise be silently
  // defeated by reusing a decision made before the agent was known to be
  // degraded. Scoped narrowly: only fires when DEGRADED is what actually
  // moved the bucket (BUCKET_ORDER[bucket] > BUCKET_ORDER[bucketBeforeDegraded])
  // -- when another floor (untrusted/automation/delegation/behavioral) or
  // the raw score already reached the same bucket on its own, a
  // legitimately claimed approval still satisfies it exactly as before.
  const degradedForcesFreshApproval = BUCKET_ORDER[bucket] > BUCKET_ORDER[bucketBeforeDegraded];
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
        delegation: hops > 0,
        behavioralPattern: behavioralPattern !== null,
        degradedAgent:
          runtimeStatus === "DEGRADED" && DEGRADED_FLOORED_ACTIONS.has(action),
      },
    },
  };

  // Narrow, explicit carve-out: HUMAN_ONLY is satisfied ONLY when the actor
  // is HUMAN (a kind exclusively set by `runLiveHumanDecisionExecution`,
  // never by AGENT/AUTOMATION callers) AND the claimed record passed
  // `claimedApprovalMatchesGovernedAction`'s HUMAN branch above (durable
  // decidedBy proof + separation of duties). This does not touch the score
  // or the bucket computation -- both stay honest -- and it leaves the
  // AGENT/AUTOMATION path's unconditional HUMAN_ONLY block fully intact.
  const humanLiveDecisionSatisfied = actor.kind === "HUMAN" && approvalSatisfied;
  // A claim that would otherwise satisfy this bucket is not honored when
  // DEGRADED is specifically what pushed the bucket here (see
  // `degradedForcesFreshApproval` above) -- HUMAN_ONLY's own claim-immunity
  // is untouched, and every other floor's claim-satisfaction is untouched.
  const approvalSatisfiedForBucket = approvalSatisfied && !degradedForcesFreshApproval;
  const needsApproval =
    (bucket === "HUMAN_ONLY" && !humanLiveDecisionSatisfied) ||
    (!approvalSatisfiedForBucket &&
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
        input: auditInput,
      },
    });

    appendUnifiedAuditEntry({
      type: routeLabel,
      actorId: actor.agentId,
      actorKind: auditActorKind(actor),
      agentId: auditAgentId(actor),
      reason: explanation.factors.join("; "),
      input: auditInput,
      output: {
        approvalRequestId: approvalRequest.id,
        // F-07 evidence linkage: when this hold was caused (in whole or in
        // part) by a detected repeated-violation pattern, the finding that
        // triggered it is recorded on this SAME durable, hash-chained audit
        // entry -- not a separate, unlinked store -- so the behavioral
        // finding and its execution/audit evidence are the same record.
        ...(behavioralPattern ? { behavioralPattern } : {}),
      },
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
      ...(correlationId !== undefined ? { correlationId } : {}),
      ...(causationId !== undefined ? { causationId } : {}),
      delegationHopCount: hops,
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
    actorKind: auditActorKind(actor),
    agentId: auditAgentId(actor),
    reason: explanation.factors.join("; "),
    input: auditInput,
    output: behavioralPattern ? { behavioralPattern } : {},
    policy: policyLabel,
    risk: riskLevel,
    approval: "NOT_REQUIRED",
    result: "SUCCESS",
    decision: "ALLOW",
    entityType,
    action,
    projectId: options.projectId ?? null,
    ownerId: actor.onBehalfOfUserId,
    ...(correlationId !== undefined ? { correlationId } : {}),
    ...(causationId !== undefined ? { causationId } : {}),
    delegationHopCount: hops,
  });

  return { decision: "ALLOWED", score, bucket, auditId: record.id, evaluation };
}

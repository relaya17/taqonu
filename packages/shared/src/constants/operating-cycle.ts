/**
 * Canonical Atlas operating cycle — one enforceable authority graph.
 *
 * Individual agents/tools must not invent a second authorization path.
 * They feed this cycle; they do not replace it.
 *
 * REQUEST → IDENTITY → AUTHORIZATION → POLICY → RISK → DECISION →
 * APPROVAL → PLAN → EXECUTE → EVIDENCE → VERIFY → REGRESSION → AUDIT → MEMORY
 */

import { assessEvidenceSufficiency } from "./evidence-sufficiency.js";

export const OPERATING_CYCLE_STAGES = [
  "IDENTITY",
  "AUTHORIZATION",
  "POLICY",
  "RISK",
  "DECISION",
  "APPROVAL",
  "PLAN",
  "EXECUTE",
  "EVIDENCE",
  "VERIFY",
  "REGRESSION",
  "AUDIT",
  "MEMORY",
] as const;

export type OperatingCycleStage = (typeof OPERATING_CYCLE_STAGES)[number];

export const OPERATING_DECISIONS = ["ALLOW", "DENY", "REQUIRE_APPROVAL"] as const;
export type OperatingDecision = (typeof OPERATING_DECISIONS)[number];

export const AGENT_RUNTIME_CONTROLS = [
  "ACTIVE",
  "PAUSED",
  "DISABLED",
  "REVOKED",
  "QUARANTINED",
  "SUSPENDED",
  "DEGRADED",
  "UNKNOWN",
] as const;

export type AgentRuntimeControl = (typeof AGENT_RUNTIME_CONTROLS)[number];

export const EPISTEMIC_GAPS = [
  "KNOWN",
  "UNKNOWN",
  "UNCERTAIN",
  "CONFLICTING",
  "UNVERIFIED",
  "STALE",
] as const;

export type EpistemicGap = (typeof EPISTEMIC_GAPS)[number];

const NON_EXECUTABLE: ReadonlySet<AgentRuntimeControl> = new Set([
  "PAUSED",
  "DISABLED",
  "REVOKED",
  "QUARANTINED",
  "SUSPENDED",
  "UNKNOWN",
]);

export function agentMayExecute(status: AgentRuntimeControl): boolean {
  return status === "ACTIVE" || status === "DEGRADED";
}

export interface OperatingCycleInput {
  readonly actorId: string;
  readonly actorKind: "USER" | "AGENT" | "SYSTEM";
  readonly applicationId: string;
  readonly operation: string;
  readonly agentStatus?: AgentRuntimeControl;
  readonly agentId?: string;
  readonly capabilityAllowed?: boolean;
  readonly capabilityDenied?: boolean;
  readonly forbiddenSelfMutation?: boolean;
  readonly readOnly?: boolean;
  readonly approved?: boolean;
  /** A verification plan must exist before mutation is authorized to run. */
  readonly verificationPlanPresent?: boolean;
  readonly evidenceCount?: number;
  readonly evidenceConflicting?: boolean;
  readonly evidenceStale?: boolean;
  /** Claim→evidence binding. Count alone is not a bound claim. */
  readonly boundEvidenceIds?: readonly string[];
  readonly conflictingClaimIds?: readonly string[];
  /** Agent A → B → privileged tool. Each hop must not inherit unlimited authority. */
  readonly delegationHopCount?: number;
  readonly reauthenticated?: boolean;
  readonly requiresReauth?: boolean;
}

export interface OperatingCycleResult {
  readonly decision: OperatingDecision;
  readonly blockedAt: OperatingCycleStage | null;
  readonly reason: string;
  readonly stagesPassed: readonly OperatingCycleStage[];
  readonly epistemic: EpistemicGap;
  readonly executed: false;
  readonly verificationRequired: boolean;
}

export function evaluateOperatingCycle(
  input: OperatingCycleInput,
): OperatingCycleResult {
  const stages: OperatingCycleStage[] = [];

  if (!input.actorId) {
    return deny("IDENTITY", "Actor identity is required", stages, input);
  }
  stages.push("IDENTITY");

  if (input.forbiddenSelfMutation === true) {
    return deny(
      "AUTHORIZATION",
      "Atlas cannot silently weaken its own security constraints",
      stages,
      input,
    );
  }

  if (input.requiresReauth === true && input.reauthenticated !== true) {
    return deny(
      "AUTHORIZATION",
      "Privileged Control Plane mutation requires recent re-authentication",
      stages,
      input,
    );
  }

  const status = input.agentStatus ?? "ACTIVE";
  if (input.agentId && !agentMayExecute(status)) {
    return deny(
      "AUTHORIZATION",
      `Agent ${input.agentId} is ${status} and cannot execute`,
      stages,
      input,
    );
  }
  stages.push("AUTHORIZATION");

  if (input.capabilityDenied === true) {
    return deny("POLICY", "Capability is explicitly denied for this agent", stages, input);
  }
  if (input.capabilityAllowed === false) {
    return deny("POLICY", "Capability is not in the agent's allow-list", stages, input);
  }
  stages.push("POLICY");
  stages.push("RISK");

  const sufficiency = assessEvidenceSufficiency(sufficiencyArgs(input));
  if (sufficiency.decision === "HALT") {
    return deny("EVIDENCE", sufficiency.reason, stages, input);
  }

  const hops = input.delegationHopCount ?? 0;
  if (hops > 0 && input.approved !== true) {
    return {
      decision: "REQUIRE_APPROVAL",
      blockedAt: "APPROVAL",
      reason: "Agent-to-agent delegation cannot inherit unlimited authority",
      stagesPassed: [...stages, "DECISION"],
      epistemic: epistemicOf(input),
      executed: false,
      verificationRequired: true,
    };
  }

  if (input.readOnly === true) {
    stages.push("DECISION");
    return {
      decision: "ALLOW",
      blockedAt: null,
      reason: "Read-only observe path — no mutation, no implicit execute",
      stagesPassed: stages,
      epistemic: epistemicOf(input),
      executed: false,
      verificationRequired: false,
    };
  }

  if (input.approved !== true) {
    stages.push("DECISION");
    return {
      decision: "REQUIRE_APPROVAL",
      blockedAt: "APPROVAL",
      reason: "Write-adjacent operations require human approval with evidence and blast radius",
      stagesPassed: stages,
      epistemic: epistemicOf(input),
      executed: false,
      verificationRequired: true,
    };
  }

  stages.push("DECISION", "APPROVAL", "PLAN");

  if (input.verificationPlanPresent !== true) {
    return deny(
      "VERIFY",
      "Approved plan cannot execute until a post-action verification plan is defined — a successful command is not a successful repair",
      stages,
      input,
    );
  }

  stages.push("EXECUTE", "EVIDENCE", "VERIFY", "REGRESSION", "AUDIT", "MEMORY");
  return {
    decision: "ALLOW",
    blockedAt: null,
    reason: "Cycle complete: approved, verified, auditable",
    stagesPassed: stages,
    epistemic: epistemicOf(input),
    executed: false,
    verificationRequired: false,
  };
}

function sufficiencyArgs(input: OperatingCycleInput) {
  return {
    evidenceCount: input.evidenceCount ?? 0,
    mutation: input.readOnly !== true,
    claimedState: input.readOnly === true ? "OBSERVED" : "VERIFIED",
    ...(input.evidenceConflicting !== undefined
      ? { conflicting: input.evidenceConflicting }
      : {}),
    ...(input.evidenceStale !== undefined ? { stale: input.evidenceStale } : {}),
    ...(input.boundEvidenceIds !== undefined
      ? { boundEvidenceIds: input.boundEvidenceIds }
      : {}),
    ...(input.conflictingClaimIds !== undefined
      ? { conflictingClaimIds: input.conflictingClaimIds }
      : {}),
  };
}

function epistemicOf(input: OperatingCycleInput): EpistemicGap {
  const sufficiency = assessEvidenceSufficiency(sufficiencyArgs(input));
  if (sufficiency.decision === "HALT" || sufficiency.decision === "INCONCLUSIVE") {
    return "UNVERIFIED";
  }
  const bound =
    input.boundEvidenceIds?.filter((id) => id.trim().length > 0).length ?? 0;
  if ((input.evidenceCount ?? 0) <= 0 && bound <= 0) return "UNVERIFIED";
  return "UNCERTAIN";
}

function deny(
  blockedAt: OperatingCycleStage,
  reason: string,
  stages: readonly OperatingCycleStage[],
  input: OperatingCycleInput,
): OperatingCycleResult {
  return {
    decision: "DENY",
    blockedAt,
    reason,
    stagesPassed: stages,
    epistemic: epistemicOf(input),
    executed: false,
    verificationRequired: blockedAt === "VERIFY",
  };
}

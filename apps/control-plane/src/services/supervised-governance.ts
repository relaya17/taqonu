/**
 * Event → Policy → Risk → Decision for supervised application activity.
 *
 * Reuses evaluateOperatingCycle and the Control policy catalog.
 * Does not execute ALLOW. Does not mint approvals. Does not replace
 * connector identity or the process registry.
 */

import {
  evaluateOperatingCycle,
  type OperatingCycleResult,
  type OperatingDecision,
} from "./operating-cycle.js";
import {
  appendAuditEntry,
  getPolicyForAction,
  type PolicyDefinition,
} from "./governance-state.js";

export interface SupervisedPolicyCell {
  readonly entityType: string;
  readonly action: string;
}

export interface SupervisedGovernanceDecision {
  readonly decision: OperatingDecision;
  readonly reason: string;
  readonly evaluatedAt: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly applicationId: string;
  readonly processId: string | null;
  readonly eventId: string;
  readonly eventType: string;
  readonly correlationId: string;
  readonly requestId: string;
  readonly connectorId: string | null;
  readonly policy: {
    readonly entityType: string;
    readonly action: string;
    readonly riskTier: PolicyDefinition["riskTier"];
    readonly requiresApproval: boolean;
    readonly description: string;
  };
  readonly risk: {
    readonly status: "EVALUATED";
    readonly tier: PolicyDefinition["riskTier"];
  };
  readonly cycle: Pick<
    OperatingCycleResult,
    "blockedAt" | "stagesPassed" | "executed"
  >;
}

export interface EvaluateSupervisedEventInput {
  readonly tenantId: string;
  readonly projectId: string;
  readonly applicationId: string;
  readonly processId: string | null;
  readonly eventId: string;
  readonly eventType: string;
  readonly correlationId: string;
  readonly requestId: string;
  readonly connectorId: string | null;
  readonly actorId: string;
  readonly actorKind: "USER" | "AGENT" | "SYSTEM";
}

const decisions = new Map<string, SupervisedGovernanceDecision>();

export function supervisedDecisionKey(
  tenantId: string,
  projectId: string,
  applicationId: string,
  eventId: string,
): string {
  return `${tenantId}\0${projectId}\0${applicationId}\0${eventId}`;
}

/**
 * Closed, deterministic event → existing policy catalog cell.
 * Unknown types default to DOCUMENT.READ (observe). DELETE-shaped names
 * select the catalog BLOCK cell. Civio legal-AI completion is CODE.EXECUTE.
 */
export function mapSupervisedEventToPolicyCell(
  eventType: string,
): SupervisedPolicyCell {
  if (eventType.endsWith(".deleted") || eventType.endsWith(".delete")) {
    return { entityType: "*", action: "DELETE" };
  }
  if (eventType === "civio.legal.ai.completed") {
    return { entityType: "CODE", action: "EXECUTE" };
  }
  return { entityType: "DOCUMENT", action: "READ" };
}

function cycleFromPolicy(
  input: EvaluateSupervisedEventInput,
  policy: PolicyDefinition,
): OperatingCycleResult {
  const base = {
    actorId: input.actorId,
    actorKind: input.actorKind,
    applicationId: input.applicationId,
    operation: `${input.applicationId}.${input.eventType}`,
  };
  if (policy.riskTier === "BLOCK") {
    return evaluateOperatingCycle({
      ...base,
      capabilityDenied: true,
    });
  }
  if (policy.requiresApproval || policy.riskTier === "APPROVAL") {
    return evaluateOperatingCycle({
      ...base,
      readOnly: false,
      approved: false,
    });
  }
  return evaluateOperatingCycle({
    ...base,
    readOnly: true,
  });
}

function auditRisk(tier: PolicyDefinition["riskTier"], decision: OperatingDecision): string {
  if (decision === "DENY" || tier === "BLOCK") return "HIGH";
  if (decision === "REQUIRE_APPROVAL" || tier === "APPROVAL") return "APPROVAL";
  return "LOW";
}

export function getSupervisedGovernanceDecision(input: {
  readonly tenantId: string;
  readonly projectId: string;
  readonly applicationId: string;
  readonly eventId: string;
}): SupervisedGovernanceDecision | undefined {
  return decisions.get(
    supervisedDecisionKey(
      input.tenantId,
      input.projectId,
      input.applicationId,
      input.eventId,
    ),
  );
}

export function listSupervisedGovernanceDecisions(filter?: {
  readonly applicationId?: string;
  readonly tenantId?: string;
  readonly processId?: string;
  readonly eventId?: string;
}): readonly SupervisedGovernanceDecision[] {
  const items = [...decisions.values()];
  if (!filter) return items;
  return items.filter((item) => {
    if (filter.applicationId && item.applicationId !== filter.applicationId) {
      return false;
    }
    if (filter.tenantId && item.tenantId !== filter.tenantId) return false;
    if (filter.processId && item.processId !== filter.processId) return false;
    if (filter.eventId && item.eventId !== filter.eventId) return false;
    return true;
  });
}

export function evaluateSupervisedEvent(
  input: EvaluateSupervisedEventInput,
): SupervisedGovernanceDecision {
  const key = supervisedDecisionKey(
    input.tenantId,
    input.projectId,
    input.applicationId,
    input.eventId,
  );
  const existing = decisions.get(key);
  if (existing) {
    return existing;
  }

  const cell = mapSupervisedEventToPolicyCell(input.eventType);
  const policy = getPolicyForAction(cell.entityType, cell.action);
  const evaluatedAt = new Date().toISOString();

  if (!policy) {
    const denied: SupervisedGovernanceDecision = {
      decision: "DENY",
      reason: `No Control policy for ${cell.entityType}.${cell.action}`,
      evaluatedAt,
      tenantId: input.tenantId,
      projectId: input.projectId,
      applicationId: input.applicationId,
      processId: input.processId,
      eventId: input.eventId,
      eventType: input.eventType,
      correlationId: input.correlationId,
      requestId: input.requestId,
      connectorId: input.connectorId,
      policy: {
        entityType: cell.entityType,
        action: cell.action,
        riskTier: "BLOCK",
        requiresApproval: false,
        description: "Unmapped policy cell is denied",
      },
      risk: { status: "EVALUATED", tier: "BLOCK" },
      cycle: {
        blockedAt: "POLICY",
        stagesPassed: ["IDENTITY", "AUTHORIZATION"],
        executed: false,
      },
    };
    decisions.set(key, denied);
    writeDecisionAudit(denied, input.actorId, input.actorKind);
    return denied;
  }

  const cycle = cycleFromPolicy(input, policy);
  const recorded: SupervisedGovernanceDecision = {
    decision: cycle.decision,
    reason: cycle.reason,
    evaluatedAt,
    tenantId: input.tenantId,
    projectId: input.projectId,
    applicationId: input.applicationId,
    processId: input.processId,
    eventId: input.eventId,
    eventType: input.eventType,
    correlationId: input.correlationId,
    requestId: input.requestId,
    connectorId: input.connectorId,
    policy: {
      entityType: cell.entityType,
      action: cell.action,
      riskTier: policy.riskTier,
      requiresApproval: policy.requiresApproval,
      description: policy.description,
    },
    risk: { status: "EVALUATED", tier: policy.riskTier },
    cycle: {
      blockedAt: cycle.blockedAt,
      stagesPassed: cycle.stagesPassed,
      executed: false,
    },
  };
  decisions.set(key, recorded);
  writeDecisionAudit(recorded, input.actorId, input.actorKind);
  return recorded;
}

function writeDecisionAudit(
  decision: SupervisedGovernanceDecision,
  actorId: string,
  actorKind: string,
): void {
  const seq = Date.now();
  appendAuditEntry({
    seq,
    timestamp: decision.evaluatedAt,
    type: "governance.decision",
    actorId,
    actorKind,
    reason: [
      `application=${decision.applicationId}`,
      `process=${decision.processId ?? "none"}`,
      `event=${decision.eventId}`,
      `policy=${decision.policy.entityType}.${decision.policy.action}`,
      `risk=${decision.risk.tier}`,
      `decision=${decision.decision}`,
      decision.reason,
    ].join(" "),
    policy: `${decision.policy.entityType}.${decision.policy.action}`,
    risk: auditRisk(decision.risk.tier, decision.decision),
    approval:
      decision.decision === "REQUIRE_APPROVAL" ? "PENDING" : "NOT_REQUIRED",
    result: decision.decision === "DENY" ? "FAILURE" : "SUCCESS",
    ownerId: decision.tenantId,
    projectId: decision.projectId,
    hash: `gov-${decision.applicationId}-${decision.eventId}-${seq}`,
    prevHash: "000",
  });
}

export function resetSupervisedGovernanceForTests(): void {
  decisions.clear();
}

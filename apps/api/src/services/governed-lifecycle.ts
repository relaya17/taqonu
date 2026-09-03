/**
 * Phase 10 — Decision → Approval → Execution → Verification → Evidence.
 *
 * The Phase 9 decision is the eligibility input. Execution still goes
 * through `executeGovernedAction`. Approvals are the existing live store.
 * This module does not run tools, mint a second approval system, or
 * change the governed-binding schema.
 */

import {
  extractGovernedTarget,
  resolveCanonicalToolOperationForRequest,
  type BusinessEntityType,
  type EntityAction,
} from "@atlas/agent-core";
import {
  CONTROL_PLANE_SERVICE_ID,
  identitiesMatch,
  type GovernedIdentity,
} from "@atlas/shared";
import {
  createApprovalRequest,
  getApprovalRequest,
} from "./approvals.js";
import { appendUnifiedAuditEntry } from "./audit-log.js";
import {
  computeGovernedBindingHash,
  executeGovernedAction,
  type GovernedExecutionOutcome,
  type GovernedExecutionRequest,
} from "./governed-execution.js";
import {
  captureExpectedState,
  compareExpectedActual,
  type VerificationVerdict,
} from "./verification.js";

export type LifecycleDecisionKind = "ALLOW" | "DENY" | "REQUIRE_APPROVAL";

export interface GovernedLifecycleDecision {
  readonly decision: LifecycleDecisionKind;
  readonly reason: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly applicationId: string;
  readonly processId: string | null;
  readonly eventId: string;
  readonly eventType: string;
  readonly correlationId: string;
  readonly requestId: string;
  readonly policy: {
    readonly entityType: string;
    readonly action: string;
    readonly riskTier: string;
  };
}

export type GovernedLifecycleStatus =
  | "STOPPED"
  | "APPROVAL_REQUIRED"
  | "EXECUTED"
  | "FAILED";

export interface GovernedLifecycleEvidence {
  readonly tenantId: string;
  readonly projectId: string;
  readonly applicationId: string;
  readonly processId: string | null;
  readonly eventId: string;
  readonly policy: string;
  readonly risk: string;
  readonly decision: LifecycleDecisionKind;
  readonly approvalRequestId: string | null;
  readonly approvalStatus: string | null;
  readonly operation: string;
  readonly artifactHash: string | null;
  readonly correlationId: string;
  readonly requestId: string;
  readonly executionStatus: GovernedLifecycleStatus;
  readonly verificationVerdict: VerificationVerdict | "NOT_RUN";
  readonly reason: string;
}

export interface GovernedLifecycleResult {
  readonly status: GovernedLifecycleStatus;
  readonly executed: boolean;
  readonly verified: boolean;
  readonly verificationVerdict: VerificationVerdict | "NOT_RUN";
  readonly reason: string;
  readonly approvalRequestId: string | null;
  readonly outcome: GovernedExecutionOutcome | null;
  readonly evidence: GovernedLifecycleEvidence;
}

export type GovernedLifecycleExecution = Omit<
  GovernedExecutionRequest,
  "approvalRequestId" | "applicationId"
> & {
  readonly applicationId: string;
  readonly approvalRequestId?: string;
  readonly expectedObservations?: readonly string[];
};

export interface GovernedLifecycleRequest {
  readonly decision: GovernedLifecycleDecision;
  /** When present, must match the decision identity field-for-field. */
  readonly identity?: GovernedIdentity;
  readonly execution?: GovernedLifecycleExecution;
  readonly approvalRequestId?: string;
  readonly actor?: {
    readonly actorId: string;
    readonly actorKind: "USER" | "AGENT" | "SYSTEM";
  };
}

const replayByEvent = new Map<string, GovernedLifecycleResult>();

export function resetGovernedLifecycleForTests(): void {
  replayByEvent.clear();
}

function replayKey(
  decision: GovernedLifecycleDecision,
  artifactHash: string | null,
  toolName: string,
): string {
  return `${decision.tenantId}\0${decision.projectId}\0${decision.applicationId}\0${decision.eventId}\0${toolName}\0${artifactHash ?? ""}`;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function auditUuid(value: string | null | undefined): string | undefined {
  if (typeof value === "string" && UUID_RE.test(value)) return value;
  return undefined;
}

function policyLabel(decision: GovernedLifecycleDecision): string {
  return `${decision.policy.entityType}.${decision.policy.action}`;
}

function auditRisk(
  tier: string,
): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  if (tier === "BLOCK" || tier === "CRITICAL") return "CRITICAL";
  if (tier === "APPROVAL" || tier === "HIGH") return "HIGH";
  if (tier === "AUTO_LOG" || tier === "MEDIUM") return "MEDIUM";
  return "LOW";
}

function shouldReplayCached(
  prior: GovernedLifecycleResult,
  request: GovernedLifecycleRequest,
): boolean {
  if (prior.status === "APPROVAL_REQUIRED") {
    return (
      request.execution?.approvalRequestId === undefined &&
      request.approvalRequestId === undefined
    );
  }
  if (prior.status === "STOPPED" && prior.evidence.approvalStatus === "PENDING") {
    return false;
  }
  return true;
}

function policyLabelMatches(request: GovernedLifecycleRequest): string | null {
  if (request.decision.decision === "DENY") return null;
  const execution = request.execution;
  if (!execution) return null;
  const canonical = resolveCanonicalToolOperationForRequest(execution.toolName);
  if (!canonical.ok) {
    return canonical.reason;
  }
  if (
    canonical.entityType !== request.decision.policy.entityType ||
    canonical.action !== request.decision.policy.action
  ) {
    return `Tool "${execution.toolName}" canonical operation is ${canonical.entityType}.${canonical.action}; decision policy is ${policyLabel(request.decision)}`;
  }
  return null;
}

function audit(input: {
  readonly type: string;
  readonly actorId: string;
  readonly actorKind: "USER" | "AGENT" | "SYSTEM";
  readonly ownerId?: string;
  readonly projectId?: string;
  readonly reason: string;
  readonly policy: string;
  readonly risk: string;
  readonly approval: "NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED";
  readonly result: "SUCCESS" | "FAILURE";
  readonly evidence: GovernedLifecycleEvidence;
}): void {
  appendUnifiedAuditEntry({
    type: input.type,
    actorId: input.actorId,
    actorKind: input.actorKind,
    reason: input.reason,
    input: {
      tenantId: input.evidence.tenantId,
      applicationId: input.evidence.applicationId,
      processId: input.evidence.processId,
      eventId: input.evidence.eventId,
      governedProjectId: input.evidence.projectId,
      decision: input.evidence.decision,
      approvalRequestId: input.evidence.approvalRequestId,
      artifactHash: input.evidence.artifactHash,
      correlationId: input.evidence.correlationId,
      requestId: input.evidence.requestId,
    },
    output: {
      status: input.evidence.executionStatus,
      verification: input.evidence.verificationVerdict,
    },
    policy: input.policy,
    risk: auditRisk(input.risk),
    approval: input.approval,
    result: input.result,
    ...(auditUuid(input.ownerId) ? { ownerId: auditUuid(input.ownerId) } : {}),
    ...(auditUuid(input.projectId) ? { projectId: auditUuid(input.projectId) } : {}),
  });
}

function requestActor(request: GovernedLifecycleRequest): {
  readonly actorId: string;
  readonly actorKind: "USER" | "AGENT" | "SYSTEM";
  readonly ownerId?: string;
} {
  if (request.actor) {
    return {
      actorId: request.actor.actorId,
      actorKind: request.actor.actorKind,
      ...(request.execution ? { ownerId: request.execution.identity.ownerId } : {}),
    };
  }
  if (request.execution) {
    return {
      actorId: request.execution.identity.agentId,
      actorKind: "AGENT",
      ownerId: request.execution.identity.ownerId,
    };
  }
  return { actorId: CONTROL_PLANE_SERVICE_ID, actorKind: "SYSTEM" };
}

function evidenceOf(
  request: GovernedLifecycleRequest,
  extra: Partial<GovernedLifecycleEvidence> &
    Pick<GovernedLifecycleEvidence, "executionStatus" | "reason">,
): GovernedLifecycleEvidence {
  const d = request.decision;
  return {
    tenantId: d.tenantId,
    projectId: d.projectId,
    applicationId: d.applicationId,
    processId: d.processId,
    eventId: d.eventId,
    policy: policyLabel(d),
    risk: d.policy.riskTier,
    decision: d.decision,
    approvalRequestId: extra.approvalRequestId ?? request.execution?.approvalRequestId ?? null,
    approvalStatus: extra.approvalStatus ?? null,
    operation: request.execution?.toolName ?? policyLabel(d),
    artifactHash: extra.artifactHash ?? null,
    correlationId: d.correlationId,
    requestId: request.execution?.requestId ?? d.requestId,
    executionStatus: extra.executionStatus,
    verificationVerdict: extra.verificationVerdict ?? "NOT_RUN",
    reason: extra.reason,
  };
}

function stop(
  request: GovernedLifecycleRequest,
  input: {
    readonly reason: string;
    readonly auditType: string;
    readonly approval: "NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED";
    readonly artifactHash?: string | null;
    readonly approvalRequestId?: string | null;
    readonly approvalStatus?: string | null;
  },
): GovernedLifecycleResult {
  const evidence = evidenceOf(request, {
    executionStatus: "STOPPED",
    reason: input.reason,
    artifactHash: input.artifactHash ?? null,
    ...(input.approvalRequestId !== undefined
      ? { approvalRequestId: input.approvalRequestId }
      : {}),
    ...(input.approvalStatus !== undefined ? { approvalStatus: input.approvalStatus } : {}),
  });
  const actor = requestActor(request);
  audit({
    type: input.auditType,
    actorId: actor.actorId,
    actorKind: actor.actorKind,
    ...(actor.ownerId !== undefined ? { ownerId: actor.ownerId } : {}),
    ...(auditUuid(request.decision.projectId)
      ? { projectId: request.decision.projectId }
      : {}),
    reason: input.reason,
    policy: evidence.policy,
    risk: evidence.risk,
    approval: input.approval,
    result: "FAILURE",
    evidence,
  });
  return {
    status: "STOPPED",
    executed: false,
    verified: false,
    verificationVerdict: "NOT_RUN",
    reason: input.reason,
    approvalRequestId: evidence.approvalRequestId,
    outcome: null,
    evidence,
  };
}

function identityMatches(request: GovernedLifecycleRequest): string | null {
  const d = request.decision;
  if (request.identity) {
    const mismatch = identitiesMatch(request.identity, d);
    if (mismatch) return mismatch;
  }
  const exec = request.execution;
  if (exec && exec.applicationId !== d.applicationId) {
    return "Lifecycle application does not match the governance decision";
  }
  return null;
}

function resolveBinding(request: GovernedLifecycleRequest):
  | { readonly ok: true; readonly artifactHash: string }
  | { readonly ok: false; readonly reason: string }
  | { readonly ok: true; readonly artifactHash: null; readonly unbound: true } {
  const execution = request.execution;
  if (!execution) {
    return { ok: true, artifactHash: null, unbound: true };
  }
  const extracted = extractGovernedTarget(
    execution.toolName,
    execution.toolArgs,
    execution.projectRoot,
  );
  if (!extracted.ok) {
    return { ok: false, reason: extracted.reason };
  }
  return {
    ok: true,
    artifactHash: computeGovernedBindingHash(extracted.target, execution.artifact),
  };
}

function approvalContextMismatch(
  context: Record<string, unknown>,
  request: GovernedLifecycleRequest,
  artifactHash: string | null,
): string | null {
  const d = request.decision;
  if (context["applicationId"] !== d.applicationId) return "Approval is not bound to this application";
  if (context["tenantId"] !== d.tenantId) return "Approval is not bound to this tenant";
  if (context["projectId"] !== d.projectId) return "Approval is not bound to this project";
  if ((context["processId"] ?? null) !== d.processId) return "Approval is not bound to this process";
  if (context["eventId"] !== d.eventId) return "Approval is not bound to this event";
  const execution = request.execution;
  if (!execution) {
    if (context["toolName"]) return "Approval cannot unlock a different operation";
    if (context["artifactHash"]) return "Approval cannot unlock a different target";
    return null;
  }
  if (context["toolName"] !== execution.toolName) {
    return "Approval cannot unlock a different operation";
  }
  if (artifactHash && context["artifactHash"] !== artifactHash) {
    return "Approval cannot unlock a different target";
  }
  return null;
}

function lifecycleReplayKey(
  request: GovernedLifecycleRequest,
  artifactHash: string | null,
): string {
  return replayKey(
    request.decision,
    artifactHash ?? "unbound",
    request.execution?.toolName ?? "none",
  );
}

function cache(
  request: GovernedLifecycleRequest,
  artifactHash: string | null,
  result: GovernedLifecycleResult,
): GovernedLifecycleResult {
  replayByEvent.set(lifecycleReplayKey(request, artifactHash), result);
  return result;
}

export async function runGovernedLifecycle(
  request: GovernedLifecycleRequest,
): Promise<GovernedLifecycleResult> {
  const mismatch = identityMatches(request);
  if (mismatch) {
    return stop(request, {
      reason: mismatch,
      auditType: "lifecycle.identity.denied",
      approval: "NOT_REQUIRED",
    });
  }

  const binding = resolveBinding(request);
  const artifactHash = binding.ok ? binding.artifactHash : null;
  const prior = replayByEvent.get(lifecycleReplayKey(request, artifactHash));
  if (prior && shouldReplayCached(prior, request)) {
    return prior;
  }

  if (!binding.ok) {
    return cache(
      request,
      null,
      stop(request, {
        reason: binding.reason,
        auditType: "lifecycle.binding.denied",
        approval: "NOT_REQUIRED",
      }),
    );
  }

  if (request.decision.decision === "DENY") {
    return cache(
      request,
      artifactHash,
      stop(request, {
        reason: request.decision.reason,
        auditType: "lifecycle.decision.denied",
        approval: "REJECTED",
        artifactHash,
      }),
    );
  }

  const opMismatch = policyLabelMatches(request);
  if (opMismatch) {
    return cache(
      request,
      artifactHash,
      stop(request, {
        reason: opMismatch,
        auditType: "lifecycle.operation.denied",
        approval: "NOT_REQUIRED",
        artifactHash,
      }),
    );
  }

  let approvalRequestId =
    request.execution?.approvalRequestId ?? request.approvalRequestId ?? null;
  const actor = requestActor(request);

  if (request.decision.decision === "REQUIRE_APPROVAL") {
    if (!approvalRequestId) {
      const created = await createApprovalRequest({
        entityType: request.decision.policy.entityType,
        action: request.decision.policy.action,
        requestedBy: actor.actorId,
        reason: request.decision.reason,
        ...(artifactHash ? { artifactHash } : {}),
        expectedObservations: [...(request.execution?.expectedObservations ?? [])],
        context: {
          tenantId: request.decision.tenantId,
          projectId: request.decision.projectId,
          applicationId: request.decision.applicationId,
          processId: request.decision.processId,
          eventId: request.decision.eventId,
          ...(request.execution
            ? {
                toolName: request.execution.toolName,
                artifactHash,
              }
            : {}),
          correlationId: request.decision.correlationId,
          requestId: request.execution?.requestId ?? request.decision.requestId,
        },
      });
      const evidence = evidenceOf(request, {
        executionStatus: "APPROVAL_REQUIRED",
        reason: "Governance decision requires approval before execution",
        artifactHash,
        approvalRequestId: created.id,
        approvalStatus: created.status,
        verificationVerdict: "NOT_RUN",
      });
      audit({
        type: "lifecycle.approval.requested",
        actorId: actor.actorId,
        actorKind: actor.actorKind,
        ...(actor.ownerId !== undefined ? { ownerId: actor.ownerId } : {}),
        reason: evidence.reason,
        policy: evidence.policy,
        risk: evidence.risk,
        approval: "PENDING",
        result: "SUCCESS",
        evidence,
      });
      return cache(request, artifactHash, {
        status: "APPROVAL_REQUIRED",
        executed: false,
        verified: false,
        verificationVerdict: "NOT_RUN",
        reason: evidence.reason,
        approvalRequestId: created.id,
        outcome: null,
        evidence,
      });
    }

    const approval = await getApprovalRequest(approvalRequestId);
    if (!approval) {
      return stop(request, {
        reason: `Approval request ${approvalRequestId} not found`,
        auditType: "lifecycle.approval.denied",
        approval: "REJECTED",
        artifactHash,
        approvalRequestId,
      });
    }
    if (approval.status === "REJECTED" || approval.status === "REVOKED") {
      return cache(
        request,
        artifactHash,
        stop(request, {
          reason: `Approval ${approval.id} is ${approval.status} and cannot unlock execution`,
          auditType: "lifecycle.approval.denied",
          approval: "REJECTED",
          artifactHash,
          approvalRequestId: approval.id,
          approvalStatus: approval.status,
        }),
      );
    }
    if (approval.status !== "APPROVED" && approval.status !== "CLAIMED" && approval.status !== "FULFILLED") {
      return stop(request, {
        reason: `Approval ${approval.id} is ${approval.status} and is not approved`,
        auditType: "lifecycle.approval.denied",
        approval: "PENDING",
        artifactHash,
        approvalRequestId: approval.id,
        approvalStatus: approval.status,
      });
    }
    if (
      approval.entityType !== request.decision.policy.entityType ||
      approval.action !== request.decision.policy.action
    ) {
      return stop(request, {
        reason: "Approval cannot unlock a different operation",
        auditType: "lifecycle.approval.denied",
        approval: "REJECTED",
        artifactHash,
        approvalRequestId: approval.id,
        approvalStatus: approval.status,
      });
    }
    if (approval.artifactHash && artifactHash && approval.artifactHash !== artifactHash) {
      return stop(request, {
        reason: "Approval cannot unlock a different target",
        auditType: "lifecycle.approval.denied",
        approval: "REJECTED",
        artifactHash,
        approvalRequestId: approval.id,
        approvalStatus: approval.status,
      });
    }
    const bound = approvalContextMismatch(approval.context, request, artifactHash);
    if (bound) {
      return stop(request, {
        reason: bound,
        auditType: "lifecycle.approval.denied",
        approval: "REJECTED",
        artifactHash,
        approvalRequestId: approval.id,
        approvalStatus: approval.status,
      });
    }
  }

  const execution = request.execution;
  if (!execution) {
    return cache(
      request,
      artifactHash,
      stop(request, {
        reason: "No authoritative execution intent — ALLOW is not EXECUTED",
        auditType: "lifecycle.execution.unavailable",
        approval: approvalRequestId ? "APPROVED" : "NOT_REQUIRED",
        artifactHash,
        approvalRequestId,
      }),
    );
  }

  audit({
    type: "lifecycle.execution.started",
    actorId: actor.actorId,
    actorKind: actor.actorKind,
    ...(actor.ownerId !== undefined ? { ownerId: actor.ownerId } : {}),
    reason: "Governance eligibility satisfied; handing off to executeGovernedAction",
    policy: policyLabel(request.decision),
    risk: request.decision.policy.riskTier,
    approval: approvalRequestId ? "APPROVED" : "NOT_REQUIRED",
    result: "SUCCESS",
    evidence: evidenceOf(request, {
      executionStatus: "EXECUTED",
      reason: "starting",
      artifactHash,
      approvalRequestId,
      verificationVerdict: "NOT_RUN",
    }),
  });

  const outcome = await executeGovernedAction({
    ...execution,
    applicationId: request.decision.applicationId,
    ...(approvalRequestId ? { approvalRequestId } : {}),
    entityType: request.decision.policy.entityType as BusinessEntityType,
    action: request.decision.policy.action as EntityAction,
    idempotencyKey:
      execution.idempotencyKey ??
      `lifecycle:${request.decision.eventId}:${artifactHash ?? "none"}`,
  });

  const executed = outcome.status === "EXECUTED";
  const expected = captureExpectedState({
    artifactHash: artifactHash ?? "",
    toolName: execution.toolName,
    ...(execution.expectedObservations !== undefined
      ? { expectedObservations: execution.expectedObservations }
      : {}),
  });
  const compared = compareExpectedActual(expected, {
    artifactHash: executed ? outcome.artifactHash : artifactHash ?? "",
    toolName: execution.toolName,
    executed,
    output: executed ? outcome.output : "",
  });

  const status: GovernedLifecycleStatus = executed ? "EXECUTED" : "FAILED";
  const evidence = evidenceOf(request, {
    executionStatus: status,
    reason: executed
      ? compared.detail
      : "reason" in outcome
        ? outcome.reason
        : "execution did not complete",
    artifactHash,
    approvalRequestId,
    verificationVerdict: compared.verdict,
  });
  audit({
    type: executed
      ? compared.verdict === "VERIFIED"
        ? "lifecycle.verified"
        : compared.verdict === "FAILED"
          ? "lifecycle.verification.failed"
          : "lifecycle.executed"
      : "lifecycle.execution.failed",
    actorId: actor.actorId,
    actorKind: actor.actorKind,
    ...(actor.ownerId !== undefined ? { ownerId: actor.ownerId } : {}),
    reason: evidence.reason,
    policy: evidence.policy,
    risk: evidence.risk,
    approval: approvalRequestId ? "APPROVED" : "NOT_REQUIRED",
    result: executed && compared.verdict !== "FAILED" ? "SUCCESS" : "FAILURE",
    evidence,
  });

  return cache(request, artifactHash, {
    status,
    executed,
    verified: compared.verdict === "VERIFIED",
    verificationVerdict: compared.verdict,
    reason: evidence.reason,
    approvalRequestId,
    outcome,
    evidence,
  });
}

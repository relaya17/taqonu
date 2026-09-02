import { createHash, randomUUID } from "node:crypto";
import {
  executeTool,
  type BusinessEntityType,
  type EntityAction,
  type ToolExecutionOutcome,
} from "@atlas/agent-core";
import type {
  ApprovalRequest,
  GovernanceDecision,
  GovernanceDecisionInput,
} from "@atlas/shared";
import { appendUnifiedAuditEntry } from "./audit-log.js";
import { consumeApprovalRequest, getApprovalRequest } from "./approvals.js";
import {
  enforceAgentToolAuthorization,
  type AuthenticatedAgentIdentity,
  type ToolExecutionPayload,
} from "./agent-runtime-authz.js";
import {
  dispatchAgentAction,
  type DispatchAgentActionResult,
  type DispatchSourceContext,
} from "./agent-dispatch-guard.js";
import { persistGovernanceDecision } from "./governance-decision.js";

/**
 * P0.7 — the single transactional execution gate.
 *
 * Everything built before this is an ENGINE: identity resolution, tool
 * authorization, the Policy/Risk dispatch gate, approval↔artifact binding,
 * the Tool Runtime, the audit chain. Each is individually correct and
 * individually tested — and none of them called each other. An agent could
 * reach `executeTool()` without ever passing `enforceAgentToolAuthorization`,
 * or consume an approval without the artifact it was bound to.
 *
 * A security module nothing routes through is theatre. This is the one path
 * that composes them, in a fixed order, with no way around it.
 *
 * ── Fail-closed ordering ─────────────────────────────────────────────
 *
 * The stages run cheapest-and-most-fundamental first, so an unauthorized
 * request is rejected before it can cost anything or touch any state:
 *
 *   1. Tool authorization   — may this agent use this tool at all?
 *   2. Artifact hashing     — pin exactly what is about to run.
 *   3. Approval consumption — is there a live approval for THIS artifact?
 *   4. Policy / Risk gate   — does the entity-action itself pass?
 *   5. Execution            — only now does anything actually happen.
 *   6. Audit                — always, including on every refusal above.
 *
 * Every stage that cannot reach a positive answer — UNAUTHORIZED, MISSING,
 * STALE, MISMATCH, EXPIRED, UNKNOWN — halts the pipeline. There is no
 * "continue and hope"; the default at every branch is refusal.
 *
 * ── Why approval is consumed BEFORE the risk gate ────────────────────
 *
 * Consumption is the step that can fail on grounds the caller must not be
 * able to retry around (wrong artifact, expired, replayed). Doing it before
 * the risk gate means a mismatched artifact is rejected on its own terms
 * rather than being masked by a risk decision that happens to also deny.
 */

export type GovernedExecutionOutcome =
  | { readonly stage: "AUTHORIZATION"; readonly status: "DENIED"; readonly reason: string }
  | { readonly stage: "APPROVAL"; readonly status: "DENIED"; readonly reason: string }
  | {
      readonly stage: "POLICY";
      readonly status: "DENIED" | "APPROVAL_REQUIRED";
      readonly reason: string;
    }
  | { readonly stage: "EXECUTION"; readonly status: "FAILED"; readonly reason: string }
  | {
      readonly stage: "EXECUTION";
      readonly status: "EXECUTED";
      readonly artifactHash: string;
      readonly output: string;
    };

export interface GovernedExecutionRequest {
  /** Server-resolved identity — see `resolveAgentIdentity`. Never from a request body. */
  readonly identity: AuthenticatedAgentIdentity;
  /** Tool name, checked against the agent catalog's allowedTools/forbiddenTools. */
  readonly toolName: string;
  readonly toolArgs: Readonly<Record<string, unknown>>;
  /** Payload whose target* fields must not contradict `identity`. */
  readonly payload?: ToolExecutionPayload;
  /** The exact content about to be acted on — what the artifact hash is taken over. */
  readonly artifact: string;
  /**
   * Approval to redeem, when this action required one. Omit for actions that
   * legitimately need none; the Policy/Risk gate still applies.
   */
  readonly approvalRequestId?: string;
  readonly entityType: BusinessEntityType;
  readonly action: EntityAction;
  readonly sourceContext: DispatchSourceContext;
  readonly projectRoot: string;
  readonly routeLabel: string;
  readonly applicationId?: string;
  readonly operation?: string;
  /**
   * The HTTP request boundary this execution belongs to — Fastify's
   * `request.id`. Supplied by the route rather than minted here: an id
   * generated inside this function would identify the call, not the request,
   * and Invariant 10 exists so an auditor can walk back to the request.
   */
  readonly requestId: string;
  /**
   * Control Plane runtime status of the agent. PAUSED/QUARANTINED/REVOKED
   * agents cannot execute. Defaults to "ACTIVE" if not provided.
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
  /**
   * Delegation hop count for authority attenuation.
   * User → Orchestrator → Specialist → Tool is 2 hops.
   * Each hop floors the risk bucket to at least APPROVAL.
   */
  readonly delegationHopCount?: number;
  /**
   * Optional retry key. The same key + same artifact is a no-op replay of
   * the first outcome. The same key with a different artifact is refused.
   * This is process-local — not a durable job queue.
   */
  readonly idempotencyKey?: string;
}

export function computeArtifactHash(artifact: string): string {
  return createHash("sha256").update(artifact, "utf8").digest("hex");
}

/**
 * Sanitize error messages to avoid leaking absolute server paths.
 * Absolute paths (starting with / or C:\ etc.) are removed from error messages.
 */
function sanitizeErrorMessage(message: string): string {
  // Remove Windows absolute paths (e.g., C:\Users\..., D:\path\...)
  // Remove Unix absolute paths (e.g., /home/user/..., /var/...)
  // Preserve only the filename or a generic message
  return message
    .replace(/[A-Za-z]:\\[^'":\s]+/g, "<path-redacted>")
    .replace(/\/(?:home|var|tmp|Users|root|etc|opt)[^'":\s]*/g, "<path-redacted>");
}

interface IdempotentExecution {
  readonly artifactHash: string;
  readonly outcome: GovernedExecutionOutcome;
}

const governedIdempotency = new Map<string, IdempotentExecution>();

export function resetGovernedIdempotencyForTests(): void {
  governedIdempotency.clear();
}

interface GovernanceAuditContext {
  readonly gate: DispatchAgentActionResult | undefined;
  readonly approval: ApprovalRequest | undefined;
}

const EMPTY_GOVERNANCE_AUDIT_CONTEXT: GovernanceAuditContext = {
  gate: undefined,
  approval: undefined,
};

function resolveApprovalStatus(
  outcome: GovernedExecutionOutcome,
  generatedApprovalId: string | null,
  approval: ApprovalRequest | undefined,
): GovernanceDecision["approval"]["status"] {
  if (outcome.stage === "APPROVAL" && outcome.status === "DENIED") return "REJECTED";
  if (generatedApprovalId) return "REQUIRED";
  if (approval?.status === "CONSUMED") return "CONSUMED";
  return "NOT_REQUIRED";
}

function resolveDecision(
  outcome: GovernedExecutionOutcome,
): GovernanceDecision["decision"] {
  if (outcome.status === "APPROVAL_REQUIRED") return "REQUIRE_APPROVAL";
  if (outcome.status === "DENIED") return "DENY";
  return "ALLOW";
}

function resolveExecution(
  outcome: GovernedExecutionOutcome,
): GovernanceDecision["execution"] {
  if (outcome.status === "EXECUTED") {
    return { status: "EXECUTED", result: "SUCCESS", reason: null };
  }
  if (outcome.stage === "EXECUTION") {
    return { status: "FAILED", result: "FAILURE", reason: outcome.reason };
  }
  return {
    status: "NOT_RUN",
    result: "NOT_RUN",
    reason: "reason" in outcome ? outcome.reason : null,
  };
}

function buildGovernanceDecision(
  request: GovernedExecutionRequest,
  artifactHash: string,
  outcome: GovernedExecutionOutcome,
  context: GovernanceAuditContext,
): GovernanceDecisionInput {
  const gateEvaluation = context.gate?.evaluation;
  const generatedApprovalId =
    context.gate?.decision === "APPROVAL_REQUIRED"
      ? context.gate.approvalRequestId
      : null;
  const approvalRequestId = generatedApprovalId ?? request.approvalRequestId ?? null;
  let policyReason = gateEvaluation?.policy.reason ?? null;
  if (!policyReason && (outcome.stage === "AUTHORIZATION" || outcome.stage === "APPROVAL")) {
    policyReason = "Request stopped before canonical policy evaluation";
  }

  return {
    schemaVersion: "1.0.0",
    recordType: "governance.decision",
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    expiresAt: context.approval?.expiresAt ?? null,
    decision: resolveDecision(outcome),
    stage: outcome.stage,
    status: outcome.status,
    actor: {
      principalId: request.identity.ownerId,
      kind: "AGENT",
      ownerId: request.identity.ownerId,
      projectId: request.identity.projectId,
      applicationId: request.applicationId ?? null,
      agentId: request.identity.agentId,
    },
    operation: request.operation ?? request.routeLabel,
    resource: {
      entityType: request.entityType,
      action: request.action,
      artifactHash,
    },
    policy: {
      authority: "DEFAULT_ENTITY_POLICIES",
      version: null,
      result: gateEvaluation?.policy.result ?? "NOT_EVALUATED",
      reason: policyReason,
      riskTier: gateEvaluation?.policy.riskTier ?? null,
      requiresApproval: gateEvaluation?.policy.requiresApproval ?? null,
    },
    risk: {
      status: gateEvaluation?.risk.status ?? "NOT_EVALUATED",
      score: gateEvaluation?.risk.score ?? null,
      rawBucket: gateEvaluation?.risk.rawBucket ?? null,
      effectiveBucket: gateEvaluation?.risk.effectiveBucket ?? null,
      factors: [...(gateEvaluation?.risk.factors ?? [])],
      floors: gateEvaluation?.risk.floors ?? {
        untrustedSource: false,
        automationActor: false,
        delegation: false,
      },
    },
    approval: {
      required: approvalRequestId !== null || outcome.status === "APPROVAL_REQUIRED",
      requestId: approvalRequestId,
      status: resolveApprovalStatus(outcome, generatedApprovalId, context.approval),
    },
    correlation: { requestId: request.requestId },
    provenance: {
      sourceOrigin: request.sourceContext.origin,
      sourceTrustLevel: request.sourceContext.trustLevel,
      authorityScope: request.identity.authorityScope ?? null,
      agentTrustLevel: request.identity.trustLevel ?? null,
      delegationHopCount: request.delegationHopCount ?? 0,
    },
    execution: resolveExecution(outcome),
  };
}

/** Single audit helper so no refusal path can silently skip the trail. */
function auditOutcome(
  request: GovernedExecutionRequest,
  artifactHash: string,
  outcome: GovernedExecutionOutcome,
  context: GovernanceAuditContext = EMPTY_GOVERNANCE_AUDIT_CONTEXT,
): void {
  appendUnifiedAuditEntry({
    type: request.routeLabel,
    actorId: request.identity.agentId,
    actorKind: "AGENT",
    reason: `governed execution: ${outcome.stage}/${outcome.status}`,
    input: {
      toolName: request.toolName,
      artifactHash,
      approvalRequestId: request.approvalRequestId ?? null,
      entityType: request.entityType,
      action: request.action,
    },
    output: {
      stage: outcome.stage,
      status: outcome.status,
      reason: "reason" in outcome ? outcome.reason : "ok",
    },
    policy: `${request.entityType}.${request.action}`,
    risk: outcome.status === "EXECUTED" ? "LOW" : "HIGH",
    approval: request.approvalRequestId ? "APPROVED" : "NOT_REQUIRED",
    result: outcome.status === "EXECUTED" ? "SUCCESS" : "FAILURE",
    ownerId: request.identity.ownerId,
    projectId: request.identity.projectId,
  });

  persistGovernanceDecision(buildGovernanceDecision(request, artifactHash, outcome, context));
}

/**
 * Run one agent action through every control, in order, or refuse.
 *
 * Never throws for a governance refusal — refusals are values, so a caller
 * cannot accidentally swallow one in a `catch` and proceed. Only genuinely
 * exceptional conditions propagate.
 */
export async function executeGovernedAction(
  request: GovernedExecutionRequest,
): Promise<GovernedExecutionOutcome> {
  const artifactHash = computeArtifactHash(request.artifact);

  if (request.idempotencyKey) {
    const prior = governedIdempotency.get(request.idempotencyKey);
    if (prior) {
      if (prior.artifactHash !== artifactHash) {
        const outcome: GovernedExecutionOutcome = {
          stage: "EXECUTION",
          status: "FAILED",
          reason: "idempotency key reused with a different artifact",
        };
        auditOutcome(request, artifactHash, outcome);
        return outcome;
      }
      return prior.outcome;
    }
  }

  // ── 1. Tool authorization (P0.2) ────────────────────────────────────
  try {
    enforceAgentToolAuthorization({
      identity: request.identity,
      requestedTool: request.toolName,
      ...(request.payload !== undefined ? { payload: request.payload } : {}),
    });
  } catch (err) {
    const outcome: GovernedExecutionOutcome = {
      stage: "AUTHORIZATION",
      status: "DENIED",
      reason: err instanceof Error ? err.message : String(err),
    };
    auditOutcome(request, artifactHash, outcome);
    return outcome;
  }

  // ── 2/3. Approval, bound to THIS artifact (P0.3) ────────────────────
  let approval: ApprovalRequest | undefined;
  if (request.approvalRequestId !== undefined) {
    approval = getApprovalRequest(request.approvalRequestId);
    try {
      approval = consumeApprovalRequest(request.approvalRequestId, {
        artifactHash,
        entityType: request.entityType,
        action: request.action,
        agentId: request.identity.agentId,
      });
    } catch (err) {
      const outcome: GovernedExecutionOutcome = {
        stage: "APPROVAL",
        status: "DENIED",
        reason: err instanceof Error ? err.message : String(err),
      };
      auditOutcome(request, artifactHash, outcome, { gate: undefined, approval });
      return outcome;
    }
  }

  // ── 4. Policy + Risk gate ───────────────────────────────────────────
  const gate = dispatchAgentAction({
    actor: {
      kind: "AGENT",
      agentId: request.identity.agentId,
      onBehalfOfUserId: request.identity.ownerId,
    },
    entityType: request.entityType,
    action: request.action,
    routeLabel: `${request.routeLabel}.gate`,
    sourceContext: request.sourceContext,
    projectId: request.identity.projectId,
    input: { toolName: request.toolName, artifactHash },
    // Authority attenuation: runtime status and delegation hop count
    // Spread conditionally due to exactOptionalPropertyTypes
    ...(request.agentRuntimeStatus !== undefined
      ? { agentRuntimeStatus: request.agentRuntimeStatus }
      : {}),
    ...(request.delegationHopCount !== undefined
      ? { delegationHopCount: request.delegationHopCount }
      : {}),
    ...(approval !== undefined ? { consumedApproval: approval } : {}),
  });

  if (gate.decision !== "ALLOWED") {
    const outcome: GovernedExecutionOutcome = {
      stage: "POLICY",
      status: gate.decision === "DENIED" ? "DENIED" : "APPROVAL_REQUIRED",
      reason:
        gate.decision === "DENIED"
          ? gate.reason
          : `approval ${gate.approvalRequestId} required before execution`,
    };
    auditOutcome(request, artifactHash, outcome, { gate, approval });
    return outcome;
  }

  // ── 5. Execution, through the Tool Runtime's own policy layer ───────
  let toolResult: ToolExecutionOutcome;
  try {
    toolResult = await executeTool(request.toolName, request.toolArgs, {
      projectRoot: request.projectRoot,
      projectId: request.identity.projectId,
      // Invariant 10 — the correlation chain. Every id here is a real one
      // this layer actually holds; none is minted to satisfy the check.
      correlation: {
        requestId: request.requestId,
        agentId: request.identity.agentId,
        // This route executes a tool directly; no `AgentProposal` precedes
        // it, so there is no proposal to point at. Stated as null rather
        // than omitted — see `ExecutionCorrelation` on why the key stays.
        proposalId: null,
        // The gate's audit entry is the governance decision. It is nullable
        // at the source, and that null is carried through rather than
        // papered over with a placeholder.
        governanceDecisionId: gate.auditId,
        // Present only when this action actually redeemed an approval.
        authorizationId: request.approvalRequestId ?? null,
        // Runtime-owned per the ownership rules: `executeTool()` mints both
        // and overwrites these. No layer may create ids outside its domain.
        executionId: "",
        toolCallId: "",
      },
    });
  } catch (err) {
    const outcome: GovernedExecutionOutcome = {
      stage: "EXECUTION",
      status: "FAILED",
      reason: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)),
    };
    auditOutcome(request, artifactHash, outcome, { gate, approval });
    return outcome;
  }

  if (toolResult.status !== "OK") {
    // The Tool Runtime's own refusals (unpoliced tool, timeout, secret in
    // output) are surfaced as execution failures rather than being flattened
    // into a generic error — an auditor needs to see WHICH control stopped it.
    const rawReason =
      toolResult.status === "DENIED"
        ? toolResult.reason
        : toolResult.status === "APPROVAL_REQUIRED"
          ? `tool "${request.toolName}" requires approval`
          : toolResult.status === "TIMEOUT"
            ? `tool timed out after ${toolResult.timeoutMs}ms`
            : toolResult.reason;
    const outcome: GovernedExecutionOutcome = {
      stage: "EXECUTION",
      status: "FAILED",
      reason: sanitizeErrorMessage(rawReason),
    };
    auditOutcome(request, artifactHash, outcome, { gate, approval });
    return outcome;
  }

  const outcome: GovernedExecutionOutcome = {
    stage: "EXECUTION",
    status: "EXECUTED",
    artifactHash,
    output: toolResult.output,
  };
  auditOutcome(request, artifactHash, outcome, { gate, approval });
  if (request.idempotencyKey) {
    governedIdempotency.set(request.idempotencyKey, { artifactHash, outcome });
  }
  return outcome;
}

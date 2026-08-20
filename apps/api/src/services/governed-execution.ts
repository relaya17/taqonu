import { createHash } from "node:crypto";
import { executeTool, type ToolExecutionOutcome } from "@atlas/agent-core";
import type { BusinessEntityType, EntityAction } from "@atlas/agent-core";
import { appendUnifiedAuditEntry } from "./audit-log.js";
import { consumeApprovalRequest } from "./approvals.js";
import {
  enforceAgentToolAuthorization,
  type AuthenticatedAgentIdentity,
  type ToolExecutionPayload,
} from "./agent-runtime-authz.js";
import {
  dispatchAgentAction,
  type DispatchSourceContext,
} from "./agent-dispatch-guard.js";

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
}

export function computeArtifactHash(artifact: string): string {
  return createHash("sha256").update(artifact, "utf8").digest("hex");
}

/** Single audit helper so no refusal path can silently skip the trail. */
function auditOutcome(
  request: GovernedExecutionRequest,
  artifactHash: string,
  outcome: GovernedExecutionOutcome,
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
  if (request.approvalRequestId !== undefined) {
    try {
      consumeApprovalRequest(request.approvalRequestId, {
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
      auditOutcome(request, artifactHash, outcome);
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
    auditOutcome(request, artifactHash, outcome);
    return outcome;
  }

  // ── 5. Execution, through the Tool Runtime's own policy layer ───────
  let toolResult: ToolExecutionOutcome;
  try {
    toolResult = await executeTool(request.toolName, request.toolArgs, {
      projectRoot: request.projectRoot,
      projectId: request.identity.projectId,
    });
  } catch (err) {
    const outcome: GovernedExecutionOutcome = {
      stage: "EXECUTION",
      status: "FAILED",
      reason: err instanceof Error ? err.message : String(err),
    };
    auditOutcome(request, artifactHash, outcome);
    return outcome;
  }

  if (toolResult.status !== "OK") {
    // The Tool Runtime's own refusals (unpoliced tool, timeout, secret in
    // output) are surfaced as execution failures rather than being flattened
    // into a generic error — an auditor needs to see WHICH control stopped it.
    const outcome: GovernedExecutionOutcome = {
      stage: "EXECUTION",
      status: "FAILED",
      reason:
        toolResult.status === "DENIED"
          ? toolResult.reason
          : toolResult.status === "APPROVAL_REQUIRED"
            ? `tool "${request.toolName}" requires approval`
            : toolResult.status === "TIMEOUT"
              ? `tool timed out after ${toolResult.timeoutMs}ms`
              : toolResult.reason,
    };
    auditOutcome(request, artifactHash, outcome);
    return outcome;
  }

  const outcome: GovernedExecutionOutcome = {
    stage: "EXECUTION",
    status: "EXECUTED",
    artifactHash,
    output: toolResult.output,
  };
  auditOutcome(request, artifactHash, outcome);
  return outcome;
}

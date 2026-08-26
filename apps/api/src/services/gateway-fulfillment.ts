/**
 * Gateway fulfillment — the only Control Plane → execution hop.
 *
 * Does not invent a tool runtime, policy engine, or approval store.
 * It calls `executeGovernedAction`, which already composes
 * catalog authz → approval → dispatchAgentAction → executeTool → audit.
 */
import { mapGatewayHandoff } from "@atlas/shared";
import { executeGovernedAction, type GovernedExecutionOutcome } from "./governed-execution.js";
import { resolveAgentIdentity } from "./agent-runtime-authz.js";
import { appendDomainEvent } from "./memory-pipeline.js";
import type { DispatchSourceContext } from "./agent-dispatch-guard.js";

export interface GatewayHandoff {
  readonly sessionOwnerId: string;
  readonly applicationId: string;
  readonly agentId: string;
  readonly operation: string;
  readonly toolArgs?: Readonly<Record<string, unknown>>;
  readonly artifact?: string;
  readonly projectRoot: string;
  readonly projectId: string | null;
  readonly requestId: string;
  readonly approvalRequestId?: string;
  readonly sourceContext?: DispatchSourceContext;
}

export interface GatewayFulfillmentResult {
  readonly applicationId: string;
  readonly operation: string;
  readonly toolName: string | null;
  readonly outcome: GovernedExecutionOutcome;
  readonly executed: boolean;
  readonly verified: false;
  readonly observation: Record<string, unknown> | null;
  readonly verificationDetail: string;
}

function unmappedOutcome(
  reason: string,
): Extract<GovernedExecutionOutcome, { stage: "AUTHORIZATION"; status: "DENIED" }> {
  return { stage: "AUTHORIZATION", status: "DENIED", reason };
}

export async function fulfillGatewayHandoff(
  handoff: GatewayHandoff,
): Promise<GatewayFulfillmentResult> {
  const mapping = mapGatewayHandoff(handoff.operation, handoff.agentId);
  if (!mapping) {
    const outcome = unmappedOutcome(
      `No fabric handoff mapping for operation "${handoff.operation}" / agent "${handoff.agentId}"`,
    );
    return {
      applicationId: handoff.applicationId,
      operation: handoff.operation,
      toolName: null,
      outcome,
      executed: false,
      verified: false,
      observation: null,
      verificationDetail: outcome.reason,
    };
  }

  const identity = resolveAgentIdentity({
    fabricAgentId: handoff.agentId,
    sessionOwnerId: handoff.sessionOwnerId,
    projectId: handoff.projectId,
  });

  const artifact =
    handoff.artifact ??
    JSON.stringify({
      applicationId: handoff.applicationId,
      operation: handoff.operation,
      agentId: handoff.agentId,
      toolName: mapping.toolName,
    });

  const outcome = await executeGovernedAction({
    identity,
    toolName: mapping.toolName,
    toolArgs: handoff.toolArgs ?? {},
    artifact,
    entityType: mapping.entityType,
    action: mapping.action,
    sourceContext: handoff.sourceContext ?? {
      origin: "system",
      trustLevel: "trusted",
    },
    projectRoot: handoff.projectRoot,
    routeLabel: `gateway.fulfill.${handoff.operation}`,
    requestId: handoff.requestId,
    ...(handoff.approvalRequestId
      ? { approvalRequestId: handoff.approvalRequestId }
      : {}),
  });

  const executed = outcome.status === "EXECUTED";
  if (outcome.status === "EXECUTED") {
    appendDomainEvent({
      type: "agent.run.completed",
      projectId: handoff.projectId,
      epistemicState: "OBSERVED",
      payload: {
        applicationId: handoff.applicationId,
        operation: handoff.operation,
        agentId: handoff.agentId,
        requestId: handoff.requestId,
        toolName: mapping.toolName,
        artifactHash: outcome.artifactHash,
      },
    });
  }

  return {
    applicationId: handoff.applicationId,
    operation: handoff.operation,
    toolName: mapping.toolName,
    outcome,
    executed,
    verified: false,
    observation:
      outcome.status === "EXECUTED"
        ? {
            output: outcome.output.slice(0, 2_000),
            artifactHash: outcome.artifactHash,
          }
        : null,
    verificationDetail:
      outcome.status === "EXECUTED"
        ? "Executed through executeGovernedAction; executed ≠ verified"
        : `Not executed: ${outcome.stage}/${outcome.status}`,
  };
}

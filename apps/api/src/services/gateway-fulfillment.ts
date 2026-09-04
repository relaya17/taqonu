/**
 * Gateway fulfillment — the only Control Plane → execution hop.
 *
 * Does not invent a tool runtime, policy engine, or approval store.
 * It calls `executeGovernedAction`, which already composes
 * catalog authz → approval → dispatchAgentAction → executeTool → audit.
 */
import { mapGatewayHandoff, memoryEpistemicAfterAction } from "@atlas/shared";
import { extractGovernedTarget } from "@atlas/agent-core";
import {
  computeArtifactHash,
  computeGovernedBindingHash,
  executeGovernedAction,
  type GovernedExecutionOutcome,
} from "./governed-execution.js";
import { resolveAgentIdentity } from "./agent-runtime-authz.js";
import { appendDomainEvent } from "./memory-pipeline.js";
import type { DispatchSourceContext } from "./agent-dispatch-guard.js";
import {
  captureExpectedState,
  evaluateWorldState,
  composeLoopVerdict,
  verificationVerdictFromOutcome,
  type VerificationVerdict,
} from "./verification.js";
import { getApprovalRequest } from "./approvals.js";

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
  readonly expectedObservations?: readonly string[];
  /** Prior observations that must still hold after mutation. Empty → not "no regression". */
  readonly baselineObservations?: readonly string[];
}

export interface GatewayFulfillmentResult {
  readonly applicationId: string;
  readonly operation: string;
  readonly toolName: string | null;
  readonly principalId: string;
  readonly outcome: GovernedExecutionOutcome;
  readonly executed: boolean;
  readonly verified: boolean;
  readonly verificationVerdict: VerificationVerdict;
  readonly regressionVerdict: VerificationVerdict;
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
      principalId: handoff.sessionOwnerId,
      outcome,
      executed: false,
      verified: false,
      verificationVerdict: verificationVerdictFromOutcome(outcome),
      regressionVerdict: "BLOCKED",
      observation: null,
      verificationDetail: outcome.reason,
    };
  }

  const identity = resolveAgentIdentity({
    fabricAgentId: handoff.agentId,
    sessionOwnerId: handoff.sessionOwnerId,
    projectId: handoff.projectId,
    trustLevel: "FULL",
  });

  const artifact =
    handoff.artifact ??
    JSON.stringify({
      applicationId: handoff.applicationId,
      operation: handoff.operation,
      agentId: handoff.agentId,
      toolName: mapping.toolName,
    });

  // When an approval exists, use its locked verification plan — caller cannot override.
  const approval = handoff.approvalRequestId
    ? await getApprovalRequest(handoff.approvalRequestId)
    : undefined;
  const expectedObservations =
    approval?.expectedObservations ?? handoff.expectedObservations ?? [];
  const baselineObservations =
    approval?.baselineObservations ?? handoff.baselineObservations ?? [];

  const expectedArtifactHash = (() => {
    const extracted = extractGovernedTarget(
      mapping.toolName,
      handoff.toolArgs ?? {},
      handoff.projectRoot,
    );
    return extracted.ok
      ? computeGovernedBindingHash(extracted.target, artifact)
      : computeArtifactHash(artifact);
  })();

  const expected = captureExpectedState({
    artifactHash: expectedArtifactHash,
    toolName: mapping.toolName,
    expectedObservations,
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
    applicationId: handoff.applicationId,
    operation: handoff.operation,
    ...(handoff.approvalRequestId
      ? { approvalRequestId: handoff.approvalRequestId }
      : {}),
  });

  const executed = outcome.status === "EXECUTED";
  // AUTHORIZATION / APPROVAL / POLICY never reach EXECUTION. REQUIRE_APPROVAL
  // and DENY are not authorized for world-state purposes.
  const authorized = outcome.stage === "EXECUTION";
  const world = evaluateWorldState({
    intended: true,
    authorized,
    expected,
    actual: {
      artifactHash: executed ? outcome.artifactHash : expected.artifactHash,
      toolName: mapping.toolName,
      executed,
      output: executed ? outcome.output : "",
    },
    baselineObservations,
  });
  const compared = executed
    ? world.verification
    : {
        verdict: verificationVerdictFromOutcome(outcome),
        detail: `Not executed: ${outcome.stage}/${outcome.status}`,
      };
  const regression = world.regression;
  const loopVerdict = executed
    ? world.loopVerdict
    : composeLoopVerdict(compared.verdict, regression.verdict);
  const verificationDetail =
    regression.verdict === "FAILED" ? regression.detail : compared.detail;

  if (outcome.status === "EXECUTED") {
    appendDomainEvent({
      type: "agent.run.completed",
      projectId: handoff.projectId,
      epistemicState: memoryEpistemicAfterAction(),
      payload: {
        applicationId: handoff.applicationId,
        operation: handoff.operation,
        agentId: handoff.agentId,
        requestId: handoff.requestId,
        toolName: mapping.toolName,
        artifactHash: outcome.artifactHash,
        verificationVerdict: loopVerdict,
        regressionVerdict: regression.verdict,
      },
    });
  }

  return {
    applicationId: handoff.applicationId,
    operation: handoff.operation,
    toolName: mapping.toolName,
    principalId: identity.ownerId,
    outcome,
    executed,
    verified: loopVerdict === "VERIFIED",
    verificationVerdict: loopVerdict,
    regressionVerdict: regression.verdict,
    observation:
      outcome.status === "EXECUTED"
        ? {
            output: outcome.output.slice(0, 2_000),
            artifactHash: outcome.artifactHash,
          }
        : null,
    verificationDetail,
  };
}

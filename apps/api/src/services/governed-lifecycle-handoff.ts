/**
 * Control Plane → API decision handoff.
 *
 * Bearer ATLAS_CONTROL_PLANE_TOKEN authenticates the sender as cp:service.
 * Binding (tool/target/artifact) is validated separately and never rewritten.
 */

import { timingSafeEqual } from "node:crypto";
import {
  extractGovernedTarget,
  resolveCanonicalToolOperationForRequest,
} from "@atlas/agent-core";
import {
  AtlasError,
  CONTROL_PLANE_SERVICE_ID,
  identitiesMatch,
  type GovernedExecutionIntent,
  type GovernedLifecycleHandoff,
} from "@atlas/shared";
import { computeGovernedBindingHash } from "./governed-execution.js";
import { findRepoRoot } from "./repo-root.js";
import {
  runGovernedLifecycle,
  type GovernedLifecycleDecision,
  type GovernedLifecycleResult,
} from "./governed-lifecycle.js";
import type { AuthenticatedAgentIdentity } from "./agent-runtime-authz.js";

export function isControlPlaneServiceAuthorization(
  authorizationHeader: string | undefined,
): boolean {
  try {
    requireControlPlaneService(authorizationHeader);
    return true;
  } catch {
    return false;
  }
}

export function requireControlPlaneService(authorizationHeader: string | undefined): void {
  const expected = process.env.ATLAS_CONTROL_PLANE_TOKEN?.trim() ?? "";
  if (!expected) {
    throw new AtlasError(
      "CONFIG_ERROR",
      "ATLAS_CONTROL_PLANE_TOKEN is not configured",
      { statusCode: 503 },
    );
  }
  const match = /^Bearer\s+(\S+)$/i.exec((authorizationHeader ?? "").trim());
  const presented = match?.[1] ?? "";
  const left = Buffer.from(presented);
  const right = Buffer.from(expected);
  if (left.length === 0 || left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new AtlasError("UNAUTHORIZED", "Control Plane service authentication failed", {
      statusCode: 401,
    });
  }
}

function assertExecutionIntent(
  decision: GovernedLifecycleDecision,
  intent: GovernedExecutionIntent,
  projectRoot: string,
): string | null {
  const canonical = resolveCanonicalToolOperationForRequest(intent.toolName);
  if (!canonical.ok) return canonical.reason;
  if (
    canonical.entityType !== decision.policy.entityType ||
    canonical.action !== decision.policy.action
  ) {
    return `Tool "${intent.toolName}" canonical operation is ${canonical.entityType}.${canonical.action}; decision policy is ${decision.policy.entityType}.${decision.policy.action}`;
  }
  const extracted = extractGovernedTarget(intent.toolName, intent.toolArgs, projectRoot);
  if (!extracted.ok) return extracted.reason;
  if (intent.target) {
    if (intent.target.kind !== extracted.target.kind || intent.target.value !== extracted.target.value) {
      return "Asserted canonical target does not match the server-derived target";
    }
  }
  const derivedHash = computeGovernedBindingHash(extracted.target, intent.artifact);
  if (intent.artifactHash && intent.artifactHash !== derivedHash) {
    return "Asserted binding hash does not match the server-derived hash";
  }
  return null;
}

export async function acceptGovernedLifecycleHandoff(input: {
  readonly handoff: GovernedLifecycleHandoff;
  readonly projectRoot?: string;
  /** Server-resolved agent identity only. Never taken from the handoff body. */
  readonly agentIdentity?: AuthenticatedAgentIdentity;
}): Promise<GovernedLifecycleResult> {
  const { handoff } = input;
  const identityError = identitiesMatch(handoff.identity, handoff.decision);
  if (identityError) {
    throw new AtlasError("FORBIDDEN", identityError, { statusCode: 403 });
  }

  const decision: GovernedLifecycleDecision = {
    decision: handoff.decision.decision,
    reason: handoff.decision.reason,
    tenantId: handoff.decision.tenantId,
    projectId: handoff.decision.projectId,
    applicationId: handoff.decision.applicationId,
    processId: handoff.decision.processId,
    eventId: handoff.decision.eventId,
    eventType: handoff.decision.eventType,
    correlationId: handoff.decision.correlationId,
    requestId: handoff.decision.requestId,
    policy: handoff.decision.policy,
  };

  const projectRoot = input.projectRoot ?? findRepoRoot();
  if (handoff.execution) {
    const bindingError = assertExecutionIntent(decision, handoff.execution, projectRoot);
    if (bindingError) {
      throw new AtlasError("FORBIDDEN", bindingError, { statusCode: 403 });
    }
  }

  return runGovernedLifecycle({
    decision,
    identity: handoff.identity,
    actor: { actorId: CONTROL_PLANE_SERVICE_ID, actorKind: "SYSTEM" },
    ...(handoff.approvalRequestId ? { approvalRequestId: handoff.approvalRequestId } : {}),
    ...(handoff.execution && input.agentIdentity
      ? {
          execution: {
            identity: input.agentIdentity,
            applicationId: decision.applicationId,
            toolName: handoff.execution.toolName,
            toolArgs: handoff.execution.toolArgs,
            artifact: handoff.execution.artifact,
            sourceContext: {
              origin: "system" as const,
              trustLevel: "trusted" as const,
            },
            projectRoot,
            routeLabel: "governance.lifecycle.handoff",
            requestId: decision.requestId,
            ...(handoff.approvalRequestId
              ? { approvalRequestId: handoff.approvalRequestId }
              : {}),
            ...(handoff.idempotencyKey ? { idempotencyKey: handoff.idempotencyKey } : {}),
          },
        }
      : {}),
  });
}

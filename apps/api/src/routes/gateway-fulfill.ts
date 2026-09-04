import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  AtlasError,
  ATLAS_SELF_APPLICATION_ID,
  ATLAS_SELF_SYSTEM_ID,
  AGENT_RUNTIME_CONTROLS,
} from "@atlas/shared";
import { requireOperator } from "../middleware/auth-guards.js";
import { findRepoRoot } from "../services/repo-root.js";
import { fulfillGatewayHandoff } from "../services/gateway-fulfillment.js";
import { isControlPlaneServiceAuthorization } from "../services/governed-lifecycle-handoff.js";

function controlPlaneFulfillOwner(applicationId: string): string {
  if (applicationId !== ATLAS_SELF_APPLICATION_ID) {
    throw new AtlasError(
      "FORBIDDEN",
      "Control Plane gateway fulfill hop is Atlas-self (def-000) only",
      { statusCode: 403 },
    );
  }
  // executeGovernedAction audit requires a UUID ownerId; cp:service is not a UUID.
  return ATLAS_SELF_SYSTEM_ID;
}

const bodySchema = z.object({
  applicationId: z.string().trim().min(1),
  agentId: z.string().trim().min(1),
  operation: z.string().trim().min(1),
  toolArgs: z.record(z.unknown()).optional(),
  artifact: z.string().optional(),
  projectId: z.string().uuid().nullable().optional(),
  approvalRequestId: z.string().uuid().optional(),
  expectedObservations: z.array(z.string().trim().min(1)).max(32).optional(),
  baselineObservations: z.array(z.string().trim().min(1)).max(32).optional(),
  agentRuntimeStatus: z.enum(AGENT_RUNTIME_CONTROLS).optional(),
});

/**
 * Operator session or Control Plane SERVICE bearer → fulfillGatewayHandoff.
 * The body cannot name a tool; mapping is fabric-catalog only.
 * CP SERVICE is Atlas-self (def-000) only. Control Plane does not run tools.
 */
export async function registerGatewayFulfillRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post("/api/v1/gateway/fulfill", async (request) => {
    const body = bodySchema.parse(request.body ?? {});
    const isCpService = isControlPlaneServiceAuthorization(
      request.headers.authorization,
    );
    const sessionOwnerId = isCpService
      ? controlPlaneFulfillOwner(body.applicationId)
      : (await requireOperator(app, request)).id;
    return fulfillGatewayHandoff({
      sessionOwnerId,
      applicationId: body.applicationId,
      agentId: body.agentId,
      operation: body.operation,
      projectRoot: findRepoRoot(),
      projectId: body.projectId === undefined ? null : body.projectId,
      requestId: request.id,
      ...(body.toolArgs ? { toolArgs: body.toolArgs } : {}),
      ...(body.artifact ? { artifact: body.artifact } : {}),
      ...(body.approvalRequestId
        ? { approvalRequestId: body.approvalRequestId }
        : {}),
      ...(body.expectedObservations
        ? { expectedObservations: body.expectedObservations }
        : {}),
      ...(body.baselineObservations
        ? { baselineObservations: body.baselineObservations }
        : {}),
      ...(isCpService && body.agentRuntimeStatus
        ? { agentRuntimeStatus: body.agentRuntimeStatus }
        : {}),
    });
  });
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireOperator } from "../middleware/auth-guards.js";
import { findRepoRoot } from "../services/repo-root.js";
import { fulfillGatewayHandoff } from "../services/gateway-fulfillment.js";

const bodySchema = z.object({
  applicationId: z.string().trim().min(1),
  agentId: z.string().trim().min(1),
  operation: z.string().trim().min(1),
  toolArgs: z.record(z.unknown()).optional(),
  artifact: z.string().optional(),
  projectId: z.string().uuid().nullable().optional(),
  approvalRequestId: z.string().uuid().optional(),
});

/**
 * Operator-only hop: Control Plane ALLOW + handoff → executeGovernedAction.
 * The body cannot name a tool; mapping is fabric-catalog only.
 */
export async function registerGatewayFulfillRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post("/api/v1/gateway/fulfill", async (request) => {
    const user = await requireOperator(app, request);
    const body = bodySchema.parse(request.body ?? {});
    return fulfillGatewayHandoff({
      sessionOwnerId: user.id,
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
    });
  });
}

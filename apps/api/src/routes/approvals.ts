import type { FastifyInstance } from "fastify";
import { AtlasError, approvalRequestStatusSchema } from "@atlas/shared";
import { z } from "zod";
import { requireAdmin } from "../middleware/auth-guards.js";
import {
  decideApprovalRequest,
  getApprovalRequest,
  listApprovalRequests,
} from "../services/approvals.js";

const listQuerySchema = z.object({
  status: approvalRequestStatusSchema.optional(),
});

const decideBodySchema = z.object({
  approve: z.boolean(),
  reason: z.string().trim().min(1, "reason is required"),
});

export async function registerApprovalRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/approvals", async (request) => {
    requireAdmin(app, request);
    const query = listQuerySchema.parse(request.query ?? {});
    const items = listApprovalRequests(query.status);
    return { items };
  });

  app.get("/api/v1/approvals/:id", async (request) => {
    requireAdmin(app, request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const item = getApprovalRequest(id);
    if (!item) {
      throw new AtlasError("NOT_FOUND", `Approval request ${id} not found`, {
        statusCode: 404,
      });
    }
    return item;
  });

  app.post("/api/v1/approvals/:id/decide", async (request) => {
    const user = requireAdmin(app, request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = decideBodySchema.parse(request.body);
    const updated = decideApprovalRequest(id, {
      decidedBy: user.id,
      approve: body.approve,
      decisionReason: body.reason,
    });
    return updated;
  });
}

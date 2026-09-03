import type { FastifyInstance } from "fastify";
import {
  ATLAS_SELF_APPLICATION_ID,
  ATLAS_SELF_CONTROL_REQUEST_PATH,
  ATLAS_SELF_CONTROL_VERIFY_PATH,
  AtlasError,
  approvalRequestStatusSchema,
} from "@atlas/shared";
import { z } from "zod";
import { requireAdmin } from "../middleware/auth-guards.js";
import {
  decideApprovalRequest,
  getApprovalRequest,
  listApprovalRequests,
} from "../services/approvals.js";
import {
  mintAtlasSelfControlApproval,
  verifyAtlasSelfControlApproval,
} from "../services/atlas-self-governance.js";
import { requireControlPlaneService } from "../services/governed-lifecycle-handoff.js";
import { enforceEntityWrite } from "../services/risk-audit.js";

const listQuerySchema = z.object({
  status: approvalRequestStatusSchema.optional(),
});

const decideBodySchema = z.object({
  approve: z.boolean(),
  reason: z.string().trim().min(1, "reason is required"),
});

const atlasSelfControlActionSchema = z.enum([
  "pause",
  "resume",
  "disable",
  "quarantine",
  "revoke",
]);

const atlasSelfControlBindSchema = z.object({
  agentId: z.string().trim().min(1).max(80),
  action: atlasSelfControlActionSchema,
});

const verifyAtlasSelfBodySchema = atlasSelfControlBindSchema.extend({
  approvalId: z.string().uuid(),
});

export async function registerApprovalRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/approvals", async (request) => {
    await requireAdmin(app, request);
    const query = listQuerySchema.parse(request.query ?? {});
    const items = await listApprovalRequests(query.status);
    return { items };
  });

  app.get("/api/v1/approvals/:id", async (request) => {
    await requireAdmin(app, request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const item = await getApprovalRequest(id);
    if (!item) {
      throw new AtlasError("NOT_FOUND", `Approval request ${id} not found`, {
        statusCode: 404,
      });
    }
    return item;
  });

  app.post("/api/v1/approvals/:id/decide", async (request) => {
    const user = await requireAdmin(app, request);
    // ENTITY-LEVEL gate independent of the `requireAdmin` ROLE-LEVEL gate:
    // deciding a pending approval request is itself a control-plane action
    // (CONFIGURATION.EXECUTE) — same pattern as `plugins.ts`. Note this is
    // deliberately `mode: "WRITE"`, not `"APPROVE"` — `authorizeEntityAction`
    // treats `"APPROVE"` as a distinct human-gate mode that always DENIES,
    // reserved for describing an *agent's* attempted self-approval, not
    // this admin HTTP endpoint (which IS the human gate).
    enforceEntityWrite({
      entityType: "CONFIGURATION",
      action: "EXECUTE",
      routeLabel: "approvals.decide",
      actorId: user.id,
    });
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = decideBodySchema.parse(request.body);
    const updated = await decideApprovalRequest(id, {
      decidedBy: user.id,
      approve: body.approve,
      decisionReason: body.reason,
    });
    return updated;
  });

  /** CP SERVICE → mint a bound Atlas-self control approval. Not a second store. */
  app.post(ATLAS_SELF_CONTROL_REQUEST_PATH, async (request, reply) => {
    requireControlPlaneService(request.headers.authorization);
    const body = atlasSelfControlBindSchema.parse(request.body ?? {});
    const approval = await mintAtlasSelfControlApproval({
      agentId: body.agentId,
      action: body.action,
      reason: `Atlas-self agent control ${body.action} ${body.agentId}`,
    });
    return reply.status(201).send({
      approvalId: approval.id,
      status: approval.status,
      applicationId: ATLAS_SELF_APPLICATION_ID,
      executed: false,
      verified: false,
    });
  });

  /**
   * CP SERVICE → is this exact approvalId currently APPROVED for this binding?
   * Auth failure / store errors never become verified: true.
   */
  app.post(ATLAS_SELF_CONTROL_VERIFY_PATH, async (request) => {
    requireControlPlaneService(request.headers.authorization);
    const body = verifyAtlasSelfBodySchema.parse(request.body ?? {});
    return verifyAtlasSelfControlApproval(body.approvalId, {
      agentId: body.agentId,
      action: body.action,
    });
  });
}

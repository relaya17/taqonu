import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  ATLAS_SELF_APPLICATION_ID,
  ATLAS_SELF_PROJECT_ID,
  AtlasError,
  fabricAgentIdSchema,
} from "@atlas/shared";
import { atlasSelfArtifactHash } from "@atlas/shared/node";
import {
  CORE_AGENT_IDS,
  listAgentLifecycleState,
  setAgentEnabled,
} from "@atlas/agent-core";
import { z } from "zod";
import { requireAdmin } from "../middleware/auth-guards.js";
import {
  atlasSelfExecutedEvidence,
  auditAtlasSelfDecision,
  executeAtlasSelfLiveHuman,
  mintAtlasSelfApproval,
  respondAtlasSelfHelper,
} from "../services/atlas-self-governance.js";

const paramsSchema = z.object({ id: fabricAgentIdSchema });
const liveDecisionSchema = z.object({
  approvalId: z.string().uuid().optional(),
  decisionReason: z.string().trim().min(1).max(2000).optional(),
});

function artifactFor(agentId: string, enabled: boolean): string {
  return atlasSelfArtifactHash({
    applicationId: ATLAS_SELF_APPLICATION_ID,
    projectId: ATLAS_SELF_PROJECT_ID,
    agentId,
    enabled: enabled ? "true" : "false",
  });
}

async function governAgentEnablement(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  enabled: boolean,
): Promise<unknown> {
  const user = await requireAdmin(app, request);
  const { id } = paramsSchema.parse(request.params);
  const body = liveDecisionSchema.parse(request.body ?? {});
  const routeLabel = enabled ? "agents.enable" : "agents.disable";
  const hash = artifactFor(id, enabled);

  if (!enabled && CORE_AGENT_IDS.has(id)) {
    throw new AtlasError(
      "FORBIDDEN",
      `${id} is a core agent and cannot be disabled`,
      { statusCode: 403 },
    );
  }

  if (body.approvalId) {
    if (!body.decisionReason) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        "decisionReason is required for an Atlas-self live-human decision",
      );
    }
    const helper = await executeAtlasSelfLiveHuman({
      approvalId: body.approvalId,
      deciderId: user.id,
      decisionReason: body.decisionReason,
      entityType: "CONFIGURATION",
      action: "UPDATE",
      artifactHash: hash,
      requestId: request.id,
      routeLabel,
      dispatchInput: {
        applicationId: ATLAS_SELF_APPLICATION_ID,
        agentId: id,
        enabled,
      },
      executeOnce: async () => {
        const result = setAgentEnabled(id, enabled);
        if (!result.ok) {
          return { kind: "FAILURE" as const, reason: result.reason };
        }
        const entry = listAgentLifecycleState().find((item) => item.agentId === id);
        return atlasSelfExecutedEvidence(entry, { agentId: id, enabled });
      },
    });
    if (helper.status === "EXECUTED") {
      auditAtlasSelfDecision({
        type: routeLabel,
        actorId: user.id,
        routeLabel,
        decision: "ALLOW",
        reason: "Independent live-human approval executed Atlas-self agent overlay",
        approvalId: body.approvalId,
        approvalStatus: helper.approvalRecord?.status ?? "CLAIMED",
        executed: true,
        verificationVerdict: "INCONCLUSIVE",
        extra: { agentId: id, enabled },
      });
    }
    return respondAtlasSelfHelper(reply, helper);
  }

  const approval = await mintAtlasSelfApproval({
    entityType: "CONFIGURATION",
    action: "UPDATE",
    requestedBy: user.id,
    reason: `${enabled ? "enable" : "disable"} fabric agent ${id}`,
    route: routeLabel,
    artifactHash: hash,
    extraContext: { agentId: id, enabled },
  });
  auditAtlasSelfDecision({
    type: routeLabel,
    actorId: user.id,
    routeLabel,
    decision: "REQUIRE_APPROVAL",
    reason: "Atlas-self agent posture requires independent approval",
    approvalId: approval.id,
    approvalStatus: approval.status,
    executed: false,
    extra: { agentId: id, enabled },
  });
  return reply.status(202).send({
    status: "APPROVAL_REQUIRED" as const,
    approvalId: approval.id,
    applicationId: ATLAS_SELF_APPLICATION_ID,
    executed: false,
    verified: false,
    message:
      "Independent live-human decision required. Retry with approvalId and decisionReason from a different authenticated identity.",
  });
}

export async function registerAgentLifecycleRoutes(
  app: FastifyInstance,
): Promise<void> {
  /** Public read — runtime enable/disable overlay for the agent registry. */
  app.get("/api/v1/agents/lifecycle", async () => ({
    items: listAgentLifecycleState(),
  }));

  app.post("/api/v1/agents/:id/enable", async (request, reply) =>
    governAgentEnablement(app, request, reply, true),
  );

  app.post("/api/v1/agents/:id/disable", async (request, reply) =>
    governAgentEnablement(app, request, reply, false),
  );
}

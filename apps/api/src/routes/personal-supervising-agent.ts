import type { FastifyInstance } from "fastify";
import {
  AtlasError,
  PERSONAL_SUPERVISING_AGENT_PATH,
  agentProposalSchema,
  fabricAgentIdSchema,
  psaLifecycleStatusSchema,
} from "@atlas/shared";
import { z } from "zod";
import { requireSignedInForWrite } from "../middleware/auth-guards.js";
import {
  coordinateSpecialists,
  ensurePersonalSupervisingAgent,
  escalateFromPsa,
  explainSupervisedRecord,
  getPersonalSupervisingAgent,
  observePersonalSupervisingAgent,
  readPsaMemory,
  recommendFromPsa,
  requestGovernedAction,
  setPersonalSupervisingAgentStatus,
} from "../services/personal-supervising-agent.js";

const scopeBodySchema = z.object({
  tenantId: z.string().trim().min(1).max(128),
  projectIds: z.array(z.string().trim().min(1).max(128)).max(64).default([]),
  applicationIds: z.array(z.string().trim().min(1).max(128)).max(64).default([]),
});

const statusBodySchema = z.object({
  status: psaLifecycleStatusSchema,
});

const attentionBodySchema = z.object({
  reason: z.string().trim().min(1).max(2000),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  applicationId: z.string().trim().min(1).max(128).optional(),
  processId: z.string().trim().min(1).max(128).optional(),
  eventId: z.string().trim().min(1).max(128).optional(),
  decision: z.string().trim().min(1).max(64).optional(),
  risk: z.string().trim().min(1).max(64).optional(),
});

const explainBodySchema = z.object({
  eventId: z.string().trim().min(1).max(128).optional(),
  processId: z.string().trim().min(1).max(128).optional(),
});

const coordinateBodySchema = z.object({
  request: z.string().trim().min(1).max(8000),
  projectId: z.string().uuid().nullable().optional(),
  agentIds: z.array(fabricAgentIdSchema).min(1).max(8).optional(),
});

export async function registerPersonalSupervisingAgentRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post(PERSONAL_SUPERVISING_AGENT_PATH, async (request) => {
    const user = await requireSignedInForWrite(app, request);
    const body = scopeBodySchema.parse(request.body ?? {});
    return await ensurePersonalSupervisingAgent({
      ownerId: user.id,
      tenantId: body.tenantId,
      projectIds: body.projectIds,
      applicationIds: body.applicationIds,
    });
  });

  app.get(PERSONAL_SUPERVISING_AGENT_PATH, async (request) => {
    const user = await requireSignedInForWrite(app, request);
    return await getPersonalSupervisingAgent(user.id);
  });

  app.post(`${PERSONAL_SUPERVISING_AGENT_PATH}/lifecycle`, async (request) => {
    const user = await requireSignedInForWrite(app, request);
    const body = statusBodySchema.parse(request.body ?? {});
    return await setPersonalSupervisingAgentStatus(user.id, body.status);
  });

  app.get(`${PERSONAL_SUPERVISING_AGENT_PATH}/observation`, async (request) => {
    const user = await requireSignedInForWrite(app, request);
    return observePersonalSupervisingAgent(user.id);
  });

  app.post(`${PERSONAL_SUPERVISING_AGENT_PATH}/explain`, async (request) => {
    const user = await requireSignedInForWrite(app, request);
    const body = explainBodySchema.parse(request.body ?? {});
    if (!body.eventId && !body.processId) {
      throw new AtlasError("VALIDATION_ERROR", "eventId or processId is required", {
        statusCode: 400,
      });
    }
    return explainSupervisedRecord(user.id, {
      ...(body.eventId ? { eventId: body.eventId } : {}),
      ...(body.processId ? { processId: body.processId } : {}),
    });
  });

  app.post(`${PERSONAL_SUPERVISING_AGENT_PATH}/recommend`, async (request) => {
    const user = await requireSignedInForWrite(app, request);
    const body = attentionBodySchema.parse(request.body ?? {});
    return await recommendFromPsa(user.id, {
      reason: body.reason,
      severity: body.severity,
      ...(body.applicationId ? { applicationId: body.applicationId } : {}),
      ...(body.processId ? { processId: body.processId } : {}),
      ...(body.eventId ? { eventId: body.eventId } : {}),
      ...(body.decision ? { decision: body.decision } : {}),
      ...(body.risk ? { risk: body.risk } : {}),
    });
  });

  app.post(`${PERSONAL_SUPERVISING_AGENT_PATH}/escalate`, async (request) => {
    const user = await requireSignedInForWrite(app, request);
    const body = attentionBodySchema.parse(request.body ?? {});
    return await escalateFromPsa(user.id, {
      reason: body.reason,
      severity: body.severity,
      ...(body.applicationId ? { applicationId: body.applicationId } : {}),
      ...(body.processId ? { processId: body.processId } : {}),
      ...(body.eventId ? { eventId: body.eventId } : {}),
      ...(body.decision ? { decision: body.decision } : {}),
      ...(body.risk ? { risk: body.risk } : {}),
    });
  });

  app.post(`${PERSONAL_SUPERVISING_AGENT_PATH}/coordinate`, async (request) => {
    const user = await requireSignedInForWrite(app, request);
    const body = coordinateBodySchema.parse(request.body ?? {});
    return await coordinateSpecialists(user.id, {
      request: body.request,
      projectId: body.projectId ?? null,
      ...(body.agentIds ? { agentIds: body.agentIds } : {}),
    });
  });

  app.post(`${PERSONAL_SUPERVISING_AGENT_PATH}/request`, async (request) => {
    const user = await requireSignedInForWrite(app, request);
    const proposal = agentProposalSchema.parse(request.body ?? {});
    return await requestGovernedAction(user.id, proposal);
  });

  app.get(`${PERSONAL_SUPERVISING_AGENT_PATH}/memory`, async (request) => {
    const user = await requireSignedInForWrite(app, request);
    const query = z
      .object({
        projectId: z.string().uuid().optional(),
        q: z.string().trim().min(1).max(500).optional(),
      })
      .parse(request.query ?? {});
    return await readPsaMemory(user.id, {
      projectId: query.projectId ?? null,
      ...(query.q ? { query: query.q } : {}),
    });
  });
}

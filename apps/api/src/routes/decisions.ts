import type { FastifyInstance } from "fastify";
import {
  createDecisionSchema,
  decisionSchema,
  transitionDecisionSchema,
  type Decision,
} from "@atlas/shared";
import { tryPersistDecisionToSupabase } from "@atlas/database";
import { z } from "zod";
import { osStore } from "../store/os-store.js";
import { resolveCloudIdentity } from "../services/cloud-identity.js";

const listQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  status: z.enum(["ACTIVE", "SUPERSEDED", "PROPOSED", "REJECTED"]).optional(),
});

function allowedTransitions(from: Decision["status"]): Decision["status"][] {
  switch (from) {
    case "PROPOSED":
      return ["ACTIVE", "REJECTED", "SUPERSEDED"];
    case "ACTIVE":
      return ["SUPERSEDED", "REJECTED"];
    case "REJECTED":
    case "SUPERSEDED":
      return [];
    default:
      return [];
  }
}

function epistemicForStatus(
  status: Decision["status"],
  previous: Decision["epistemicState"],
): Decision["epistemicState"] {
  if (status === "ACTIVE") return "CONFIRMED";
  if (status === "REJECTED") return "CONFLICTED";
  if (status === "SUPERSEDED") return previous === "CONFIRMED" ? "CONFIRMED" : "PROPOSED";
  return previous;
}

export async function registerDecisionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/decisions", async (request) => {
    const query = listQuerySchema.parse(request.query ?? {});
    let items = osStore.listDecisions();
    if (query.projectId) {
      items = items.filter((d) => d.projectId === query.projectId);
    }
    if (query.status) {
      items = items.filter((d) => d.status === query.status);
    }
    items = [...items].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    return {
      items,
      page: 1,
      pageSize: items.length || 20,
      total: items.length,
    };
  });

  app.get("/api/v1/decisions/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const decision = osStore.getDecision(id);
    if (!decision) {
      return reply.status(404).send({ error: "Decision not found" });
    }
    return decision;
  });

  app.post("/api/v1/decisions", async (request, reply) => {
    const body = createDecisionSchema.parse(request.body);
    const now = new Date().toISOString();
    const status = body.status ?? "PROPOSED";
    const decision = decisionSchema.parse({
      id: crypto.randomUUID(),
      projectId: body.projectId ?? null,
      decision: body.decision,
      reason: body.reason ?? [],
      alternatives: body.alternatives ?? [],
      tradeOffs: body.tradeOffs ?? [],
      evidence: body.evidence ?? [],
      status,
      confidence: body.confidence ?? (status === "ACTIVE" ? 1 : 0.6),
      epistemicState:
        body.epistemicState ?? (status === "ACTIVE" ? "CONFIRMED" : "PROPOSED"),
      supersededBy: null,
      adrPath: body.adrPath ?? null,
      decidedAt: body.decidedAt ?? now,
      createdAt: now,
      updatedAt: now,
    });
    osStore.addDecision(decision);
    osStore.recordEvent({
      type: "decision.created",
      decisionId: decision.id,
      projectId: decision.projectId,
      status: decision.status,
      occurredAt: now,
    });

    const identity = await resolveCloudIdentity(app, request);
    if (identity.setCookie) reply.header("Set-Cookie", identity.setCookie);
    const cloudSynced = Boolean(
      await tryPersistDecisionToSupabase(app.atlasEnv, decision, identity.ownerId, {
        userAccessToken: identity.userAccessToken,
      }),
    );

    return reply.status(201).send({ ...decision, cloudSynced });
  });

  app.post("/api/v1/decisions/:id/transition", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = transitionDecisionSchema.parse(request.body);
    const existing = osStore.getDecision(id);
    if (!existing) {
      return reply.status(404).send({ error: "Decision not found" });
    }

    const allowed = allowedTransitions(existing.status);
    if (!allowed.includes(body.status)) {
      return reply.status(409).send({
        error: `Cannot transition from ${existing.status} to ${body.status}`,
        allowed,
      });
    }

    if (body.status === "SUPERSEDED") {
      const successor = osStore.getDecision(body.supersededBy!);
      if (!successor) {
        return reply.status(400).send({ error: "supersededBy decision not found" });
      }
      if (successor.id === existing.id) {
        return reply.status(400).send({ error: "Decision cannot supersede itself" });
      }
    }

    const now = new Date().toISOString();
    const reason =
      body.reason && body.reason.trim().length > 0
        ? [...existing.reason, body.reason.trim()]
        : existing.reason;

    const updated = decisionSchema.parse({
      ...existing,
      status: body.status,
      supersededBy: body.status === "SUPERSEDED" ? body.supersededBy! : existing.supersededBy,
      reason,
      epistemicState: epistemicForStatus(body.status, existing.epistemicState),
      confidence:
        body.status === "ACTIVE"
          ? Math.max(existing.confidence, 0.85)
          : existing.confidence,
      decidedAt: body.status === "ACTIVE" ? now : existing.decidedAt,
      updatedAt: now,
    });

    osStore.updateDecision(updated);
    osStore.recordEvent({
      type: "decision.transitioned",
      decisionId: updated.id,
      projectId: updated.projectId,
      from: existing.status,
      to: updated.status,
      supersededBy: updated.supersededBy,
      occurredAt: now,
    });

    const identity = await resolveCloudIdentity(app, request);
    if (identity.setCookie) reply.header("Set-Cookie", identity.setCookie);
    const cloudSynced = Boolean(
      await tryPersistDecisionToSupabase(app.atlasEnv, updated, identity.ownerId, {
        userAccessToken: identity.userAccessToken,
      }),
    );

    return { ...updated, cloudSynced };
  });
}

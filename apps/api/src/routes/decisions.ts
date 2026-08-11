import type { FastifyInstance } from "fastify";
import { createDecisionSchema, decisionSchema } from "@atlas/shared";
import { osStore } from "../store/os-store.js";

export async function registerDecisionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/decisions", async () => {
    const items = [...osStore.decisions.values()].flat();
    return {
      items,
      page: 1,
      pageSize: 20,
      total: items.length,
    };
  });

  app.post("/api/v1/decisions", async (request, reply) => {
    const body = createDecisionSchema.parse(request.body);
    const now = new Date().toISOString();
    const decision = decisionSchema.parse({
      id: crypto.randomUUID(),
      projectId: body.projectId ?? null,
      decision: body.decision,
      reason: body.reason ?? [],
      alternatives: body.alternatives ?? [],
      tradeOffs: body.tradeOffs ?? [],
      evidence: body.evidence ?? [],
      status: body.status ?? "ACTIVE",
      confidence: body.confidence ?? 1,
      epistemicState: body.epistemicState ?? "CONFIRMED",
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
      occurredAt: now,
    });
    return reply.status(201).send(decision);
  });
}

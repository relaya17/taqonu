import type { FastifyInstance } from "fastify";
import {
  evaluateGatesRequestSchema,
  uuidSchema,
  waiveGateSchema,
  AtlasError,
} from "@atlas/shared";
import { z } from "zod";
import { evaluateReleaseGateGraph } from "../services/gate-engine.js";
import { appendDomainEvent } from "../services/memory-pipeline.js";
import { osStore } from "../store/os-store.js";

export async function registerGateRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/gates", async (request) => {
    const q = z
      .object({ projectId: uuidSchema.optional() })
      .parse(request.query ?? {});
    const projectId = q.projectId ?? null;
    const existing = osStore.getGateGraph(projectId);
    const graph = existing ?? evaluateReleaseGateGraph(projectId);
    return { graph };
  });

  app.post("/api/v1/gates/evaluate", async (request, reply) => {
    const body = evaluateGatesRequestSchema.parse(request.body ?? {});
    const projectId = body.projectId ?? null;
    const graph = evaluateReleaseGateGraph(projectId);
    appendDomainEvent({
      type: "gate.evaluated",
      projectId,
      epistemicState: "OBSERVED",
      payload: {
        graphId: graph.id,
        summary: graph.plainLanguageSummary,
        statuses: Object.fromEntries(graph.nodes.map((n) => [n.id, n.status])),
      },
    });
    return reply.status(200).send({ graph });
  });

  app.post("/api/v1/gates/:graphId/waive", async (request, reply) => {
    const params = z.object({ graphId: uuidSchema }).parse(request.params);
    const body = waiveGateSchema.parse(request.body);
    const graph = osStore.getGateGraphById(params.graphId);
    if (!graph) {
      throw new AtlasError("NOT_FOUND", "Gate graph not found");
    }
    const now = new Date().toISOString();
    const nodes = graph.nodes.map((n) =>
      n.id === body.gateId
        ? {
            ...n,
            status: "WAIVED" as const,
            waivedBy: body.waivedBy,
            waivedReason: body.reason,
            blockerReason: body.reason,
            updatedAt: now,
          }
        : n,
    );
    const next = {
      ...graph,
      nodes,
      plainLanguageSummary: `Gate ${body.gateId} waived by ${body.waivedBy}: ${body.reason}`,
      updatedAt: now,
    };
    osStore.upsertGateGraph(next);
    return reply.status(200).send({ graph: next });
  });
}

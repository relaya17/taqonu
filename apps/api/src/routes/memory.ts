import type { FastifyInstance } from "fastify";
import { createMemorySchema, memorySchema } from "@atlas/shared";
import { z } from "zod";
import { osStore } from "../store/os-store.js";
import {
  appendDomainEvent,
  approveMemory,
  classifyMemoryType,
  retrieveMemories,
  supersedeMatchingMemories,
} from "../services/memory-pipeline.js";
import { atlasMetrics } from "./metrics.js";

export async function registerMemoryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/memory", async (request) => {
    const q = z
      .object({
        projectId: z.string().uuid().optional(),
        query: z.string().max(200).optional(),
        budget: z.coerce.number().int().positive().max(40).optional(),
        mode: z.enum(["list", "retrieve"]).optional(),
      })
      .parse(request.query ?? {});

    if (q.mode === "retrieve" || q.query || q.budget) {
      const retrieveInput: {
        projectId?: string | null;
        query?: string;
        budget?: number;
      } = {
        projectId: q.projectId ?? null,
        budget: q.budget ?? 12,
      };
      if (q.query !== undefined) retrieveInput.query = q.query;
      const result = retrieveMemories(retrieveInput);
      atlasMetrics.record(
        "retrieval_hit_rate",
        result.items.length > 0 ? 1 : 0,
        { surface: "memory" },
      );
      return {
        items: result.items,
        page: 1,
        pageSize: result.budget,
        total: result.items.length,
        truncated: result.truncated,
        pipeline: "retrieve",
      };
    }

    const items = [...osStore.memories.values()].flat();
    return {
      items,
      page: 1,
      pageSize: 20,
      total: items.length,
      pipeline: "list",
    };
  });

  app.post("/api/v1/memory", async (request, reply) => {
    const body = createMemorySchema.parse(request.body);
    const now = new Date().toISOString();
    const classified = classifyMemoryType(body.statement);
    const memory = memorySchema.parse({
      id: crypto.randomUUID(),
      type: body.type || classified.type,
      projectId: body.projectId ?? null,
      statement: body.statement,
      reason: [
        ...(body.reason ?? []),
        `classified:${classified.type}:${classified.reason}`,
      ],
      status: "ACTIVE",
      confidence: body.confidence ?? classified.confidence,
      category: body.category,
      epistemicState: body.epistemicState,
      observationMode: body.observationMode,
      source: body.source,
      sourceType: body.sourceType,
      sourceId: body.sourceId ?? null,
      evidence: (body.evidence ?? []).map((item) => ({
        id: crypto.randomUUID(),
        ...item,
      })),
      supersededBy: null,
      validFrom: body.validFrom ?? null,
      validUntil: body.validUntil ?? null,
      observedAt: body.observedAt ?? null,
      createdAt: now,
      updatedAt: now,
      createdBy: "user",
      scope: body.scope ?? "PROJECT",
      priority: body.priority ?? "MEDIUM",
    });
    osStore.addMemory(memory);
    atlasMetrics.record("memory_write_rate", 1, { kind: "create" });
    appendDomainEvent({
      type: "memory.created",
      projectId: memory.projectId,
      epistemicState: memory.epistemicState,
      payload: {
        memoryId: memory.id,
        statement: memory.statement,
        type: memory.type,
        classifiedType: classified.type,
      },
    });
    const superseded = supersedeMatchingMemories({
      projectId: memory.projectId,
      statementContains: memory.statement.slice(0, 48),
      newerMemoryId: memory.id,
    });
    return reply.status(201).send({
      ...memory,
      supersededCount: superseded,
      classification: classified,
    });
  });

  app.post("/api/v1/memory/:id/approve", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({ projectId: z.string().uuid().nullable().optional() })
      .parse(request.body ?? {});
    const updated = approveMemory({
      memoryId: params.id,
      projectId: body.projectId ?? null,
    });
    if (!updated) {
      return reply.status(404).send({ error: { message: "Memory not found" } });
    }
    atlasMetrics.record("memory_write_rate", 1, { kind: "approve" });
    return updated;
  });
}

import type { FastifyInstance } from "fastify";
import { createMemorySchema, memorySchema } from "@atlas/shared";
import { tryApproveMemoryInSupabase, tryPersistMemoryToSupabase } from "@atlas/database";
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
import { resolveCloudIdentity } from "../services/cloud-identity.js";

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

    // Best-effort durable dual-write — local osStore remains the source of
    // truth and this never blocks the response (see AUTH_RLS.md).
    const identity = await resolveCloudIdentity(app, request);
    if (identity.setCookie) reply.header("Set-Cookie", identity.setCookie);
    const cloudSynced = Boolean(
      await tryPersistMemoryToSupabase(app.atlasEnv, memory, identity.ownerId, {
        userAccessToken: identity.userAccessToken,
      }),
    );

    return reply.status(201).send({
      ...memory,
      supersededCount: superseded,
      classification: classified,
      cloudSynced,
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

    const identity = await resolveCloudIdentity(app, request);
    if (identity.setCookie) reply.header("Set-Cookie", identity.setCookie);
    const cloudSynced = await tryApproveMemoryInSupabase(
      app.atlasEnv,
      updated.id,
      {
        epistemicState: updated.epistemicState,
        observationMode: updated.observationMode,
        confidence: updated.confidence,
        reason: updated.reason,
        updatedAt: updated.updatedAt,
      },
      identity.userAccessToken,
    );

    return { ...updated, cloudSynced };
  });

  /** Pending review queue — items an approver still needs to act on. */
  app.get("/api/v1/memory/pending", async () => {
    const all = [...osStore.memories.values()].flat();
    const items = all.filter(
      (m) =>
        m.status === "ACTIVE" &&
        (m.epistemicState === "PROPOSED" ||
          m.epistemicState === "INFERRED" ||
          m.epistemicState === "UNVERIFIED" ||
          m.epistemicState === "ASSUMED"),
    );
    return { items, total: items.length };
  });

  /**
   * Portfolio memory moat snapshot — counts by type/epistemic + top retrieve.
   * Does not invent FACT; UNKNOWN when empty.
   */
  app.get("/api/v1/memory/moat", async (request) => {
    const q = z
      .object({
        projectId: z.string().uuid().optional(),
        budget: z.coerce.number().int().positive().max(40).optional(),
      })
      .parse(request.query ?? {});

    const pools: ReturnType<typeof osStore.getMemories> = [];
    if (q.projectId) pools.push(...osStore.getMemories(q.projectId));
    pools.push(...osStore.getMemories("global"));
    if (!q.projectId) {
      for (const [k, list] of osStore.memories.entries()) {
        if (k === "global") continue;
        pools.push(...list);
      }
    }

    const active = pools.filter((m) => m.status === "ACTIVE");
    const byType: Record<string, number> = {};
    const byEpistemic: Record<string, number> = {};
    for (const m of active) {
      byType[m.type] = (byType[m.type] ?? 0) + 1;
      byEpistemic[m.epistemicState] =
        (byEpistemic[m.epistemicState] ?? 0) + 1;
    }

    const retrieve = retrieveMemories({
      projectId: q.projectId ?? null,
      budget: q.budget ?? 8,
    });

    return {
      activeCount: active.length,
      supersededOrStale: pools.filter(
        (m) => m.status === "SUPERSEDED" || m.epistemicState === "STALE",
      ).length,
      pendingApproval: active.filter(
        (m) =>
          m.epistemicState === "PROPOSED" ||
          m.epistemicState === "INFERRED" ||
          m.epistemicState === "UNVERIFIED" ||
          m.epistemicState === "ASSUMED",
      ).length,
      byType,
      byEpistemic,
      top: retrieve.items.map((m) => ({
        id: m.id,
        type: m.type,
        epistemicState: m.epistemicState,
        statement: m.statement.slice(0, 200),
        confidence: m.confidence,
      })),
      epistemicState:
        active.length === 0
          ? ("INSUFFICIENT_EVIDENCE" as const)
          : ("INFERRED" as const),
      note:
        active.length === 0
          ? "No ACTIVE memories — moat empty until classify/approve accumulates."
          : "Portfolio memory rollup — prefer CONFIRMED/VERIFIED over PROPOSED.",
    };
  });
}

import type { FastifyInstance } from "fastify";
import { createMemorySchema, memorySchema, type AuthUser, type Memory } from "@atlas/shared";
import { tryApproveMemoryInSupabase, tryPersistMemoryToSupabase } from "@atlas/database";
import { redactSecrets } from "@atlas/agent-core";
import { z } from "zod";
import { osStore } from "../store/os-store.js";
import { requireSignedInForWrite, requireUser } from "../middleware/auth-guards.js";
import {
  appendDomainEvent,
  approveMemory,
  classifyMemoryType,
  retrieveMemories,
  supersedeMatchingMemories,
} from "../services/memory-pipeline.js";
import { atlasMetrics } from "./metrics.js";
import { resolveCloudIdentity } from "../services/cloud-identity.js";

/**
 * Tenant boundary (P0 fix): a signed-in user only sees memories they own;
 * admins bypass. Applied to every read surface (`GET /memory`,
 * `/memory/pending`, `/memory/moat`) so a signed-in user cannot list, page,
 * or aggregate-count another tenant's memories — including memory statements
 * that may carry sensitive project detail.
 */
function scopeMemoriesToCaller(items: readonly Memory[], user: AuthUser): Memory[] {
  if (user.role === "admin") return [...items];
  return items.filter((memory) => memory.ownerId === user.id);
}

export async function registerMemoryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/memory", async (request) => {
    const user = await requireUser(app, request);
    const q = z
      .object({
        projectId: z.string().uuid().optional(),
        query: z.string().max(200).optional(),
        budget: z.coerce.number().int().positive().max(40).optional(),
        mode: z.enum(["list", "retrieve"]).optional(),
        // Per-agent scoping (P1 fix) — optional filter narrowing results to
        // what `agentId` (the requesting kernel/plugin agent) is allowed to
        // see; a fabricated value can only ever narrow results, never widen
        // them, so no extra trust is required to accept it from the caller.
        agentId: z.string().max(120).optional(),
      })
      .parse(request.query ?? {});

    const callerOwnerId = user.role === "admin" ? undefined : user.id;

    if (q.mode === "retrieve" || q.query || q.budget) {
      const retrieveInput: {
        projectId?: string | null;
        query?: string;
        budget?: number;
        ownerId?: string;
        requestingAgentId?: string;
      } = {
        projectId: q.projectId ?? null,
        budget: q.budget ?? 12,
        ...(callerOwnerId !== undefined ? { ownerId: callerOwnerId } : {}),
        ...(q.agentId !== undefined ? { requestingAgentId: q.agentId } : {}),
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

    const items = scopeMemoriesToCaller(
      [...osStore.memories.values()].flat(),
      user,
    );
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

    // Resolved first (P0 fix): the locally-stored memory needs a real,
    // server-derived ownerId — never client-supplied, to prevent a caller
    // from writing memories into another tenant's bucket. Unauthenticated /
    // system callers fall back to the stub owner (same convention used
    // elsewhere for cloud dual-write, see cloud-identity.ts).
    const identity = await resolveCloudIdentity(app, request);
    if (identity.setCookie) reply.header("Set-Cookie", identity.setCookie);

    // Secret-redaction gate (P0 fix): mirrors agent.ts / conversation.ts —
    // never persist a raw credential/token found in a memory statement or
    // evidence excerpt.
    const safeStatement = redactSecrets(body.statement);
    const safeEvidence = (body.evidence ?? []).map((item) => ({
      id: crypto.randomUUID(),
      ...item,
      ...(item.excerpt !== undefined
        ? { excerpt: redactSecrets(item.excerpt) }
        : {}),
    }));

    const memory = memorySchema.parse({
      id: crypto.randomUUID(),
      ownerId: identity.ownerId,
      type: body.type || classified.type,
      projectId: body.projectId ?? null,
      statement: safeStatement,
      reason: [
        ...(body.reason ?? []),
        `classified:${classified.type}:${classified.reason}`,
      ],
      status: "ACTIVE",
      confidence: body.confidence ?? classified.confidence,
      category: body.category,
      // Already capped server-side by createMemorySchema's transform —
      // untrusted sourceTypes cannot claim FACT/VERIFIED/CONFIRMED here.
      epistemicState: body.epistemicState,
      observationMode: body.observationMode,
      source: body.source,
      sourceType: body.sourceType,
      sourceId: body.sourceId ?? null,
      evidence: safeEvidence,
      supersededBy: null,
      validFrom: body.validFrom ?? null,
      validUntil: body.validUntil ?? null,
      observedAt: body.observedAt ?? null,
      createdAt: now,
      updatedAt: now,
      createdBy: "user",
      scope: body.scope ?? "PROJECT",
      priority: body.priority ?? "MEDIUM",
      // Per-agent scoping (P1 fix) — both optional/nullable and flow
      // through as plain data; unset by default, same as before this fix.
      agentId: body.agentId ?? null,
      allowedAgents: body.allowedAgents ?? null,
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
    // Tenant boundary (P0 fix): approving a memory promotes it to CONFIRMED,
    // so this must require a real signed-in caller — same gate every other
    // mutating handler in this file family uses (see code.ts, kernel.ts,
    // etc.) — and the resulting ownerId must be threaded through to
    // `approveMemory()` so a caller can only approve memories they own.
    // Admins bypass, matching `scopeMemoriesToCaller` elsewhere in this file.
    const user = await requireSignedInForWrite(app, request);
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({ projectId: z.string().uuid().nullable().optional() })
      .parse(request.body ?? {});
    const callerOwnerId = user.role === "admin" ? undefined : user.id;
    const result = approveMemory({
      memoryId: params.id,
      projectId: body.projectId ?? null,
      ...(callerOwnerId !== undefined ? { ownerId: callerOwnerId } : {}),
    });
    if (!result.memory) {
      if (result.reason === "no_evidence") {
        // Distinct from not-found (below): the memory exists and is the
        // caller's own, but has zero evidence entries, so it cannot be
        // promoted to CONFIRMED. This is not a tenancy/existence signal, so
        // it's safe (and more honest) to explain rather than reuse the
        // ambiguous 404.
        return reply.status(400).send({
          error: {
            message:
              "Memory cannot be approved: it has no evidence entries",
            code: "NO_EVIDENCE",
          },
        });
      }
      // Same 404 whether the memory truly doesn't exist or exists under a
      // different owner — never reveal cross-tenant existence.
      return reply.status(404).send({ error: { message: "Memory not found" } });
    }
    const updated = result.memory;
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
  app.get("/api/v1/memory/pending", async (request) => {
    const user = await requireUser(app, request);
    const all = scopeMemoriesToCaller(
      [...osStore.memories.values()].flat(),
      user,
    );
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
    const user = await requireUser(app, request);
    const callerOwnerId = user.role === "admin" ? undefined : user.id;
    const q = z
      .object({
        projectId: z.string().uuid().optional(),
        budget: z.coerce.number().int().positive().max(40).optional(),
      })
      .parse(request.query ?? {});

    const pools: Memory[] = [];
    if (q.projectId) pools.push(...osStore.getMemories(q.projectId, callerOwnerId));
    pools.push(...osStore.getMemories("global", callerOwnerId));
    if (!q.projectId) {
      for (const [k, list] of osStore.memories.entries()) {
        if (k === "global") continue;
        pools.push(...scopeMemoriesToCaller(list, user));
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
      ...(callerOwnerId !== undefined ? { ownerId: callerOwnerId } : {}),
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

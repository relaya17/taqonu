import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { uuidSchema } from "@atlas/shared";
import { requireSignedInForWrite } from "../middleware/auth-guards.js";
import {
  assertProjectReadAccess,
  assertProjectWriteAccess,
} from "../services/project-access.js";
import {
  executeBugIngest,
  executeObserveCycle,
  putExpectedBehaviorModel,
  readObserverState,
} from "../services/observe-cycle.js";
import { enforceEntityWrite } from "../services/risk-audit.js";

export async function registerObserverRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post("/api/v1/observe/cycle", async (request, reply) => {
    const user = await requireSignedInForWrite(app, request);
    enforceEntityWrite({
      entityType: "RECORD",
      action: "EXECUTE",
      routeLabel: "observe.cycle",
      actorId: user.id,
    });
    const result = executeObserveCycle({
      body: request.body,
      envGoldenRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
    });
    return reply.send(result);
  });

  app.post("/api/v1/projects/:id/observe-cycle", async (request, reply) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    const user = await assertProjectWriteAccess(app, request, projectId);
    enforceEntityWrite({
      entityType: "RECORD",
      action: "EXECUTE",
      routeLabel: "projects.observe-cycle",
      actorId: user.id,
      projectId,
    });
    const body =
      typeof request.body === "object" && request.body
        ? { ...(request.body as Record<string, unknown>), projectId }
        : { projectId };
    const result = executeObserveCycle({
      body,
      envGoldenRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
    });
    return reply.send(result);
  });

  app.get("/api/v1/projects/:id/observer", async (request) => {
    // SECURITY FIX (found while widening Policy Engine coverage): this
    // route had ZERO auth — anyone who knew a project id could read its
    // observer findings/risk state.
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    await assertProjectReadAccess(app, request, projectId);
    return readObserverState({
      projectId,
      envGoldenRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
    });
  });

  app.get("/api/v1/projects/:id/observer/expected", async (request) => {
    // SECURITY FIX: same class of gap as the sibling GET above.
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    await assertProjectReadAccess(app, request, projectId);
    const state = readObserverState({
      projectId,
      envGoldenRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
    });
    return {
      expected: state.expected,
      compare: state.expectedCompare,
      error: state.error,
    };
  });

  app.put("/api/v1/projects/:id/observer/expected", async (request, reply) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    const user = await assertProjectWriteAccess(app, request, projectId);
    enforceEntityWrite({
      entityType: "CONFIGURATION",
      action: "UPDATE",
      routeLabel: "projects.observer.expected",
      actorId: user.id,
      projectId,
    });
    const result = putExpectedBehaviorModel({
      projectId,
      body: request.body,
      envGoldenRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
    });
    return reply.send(result);
  });

  app.get("/api/v1/projects/:id/observer/snapshots", async (request) => {
    // SECURITY FIX: same class of gap as the other observer GET routes.
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    await assertProjectReadAccess(app, request, projectId);
    const state = readObserverState({
      projectId,
      envGoldenRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
    });
    return {
      items: state.snapshots,
      total: state.snapshots.length,
      error: state.error,
    };
  });

  app.get("/api/v1/observer/state", async (request) => {
    const q = z
      .object({
        projectId: uuidSchema.optional(),
        workspaceRoot: z.string().max(1000).optional(),
      })
      .parse(request.query);
    // SECURITY FIX: same class of gap as the other observer GET routes —
    // only gated when a projectId is given (workspaceRoot-only calls carry
    // no tenant data to leak).
    if (q.projectId) {
      await assertProjectReadAccess(app, request, q.projectId);
    }
    return readObserverState({
      projectId: q.projectId ?? null,
      workspaceRoot: q.workspaceRoot ?? null,
      envGoldenRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
    });
  });

  app.post("/api/v1/observer/bugs", async (request, reply) => {
    const user = await requireSignedInForWrite(app, request);
    enforceEntityWrite({
      entityType: "RECORD",
      action: "CREATE",
      routeLabel: "observer.bugs",
      actorId: user.id,
    });
    const result = executeBugIngest({
      body: request.body,
      envGoldenRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
    });
    return reply.status(201).send(result);
  });
}

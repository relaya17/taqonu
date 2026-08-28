import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AtlasError, uuidSchema } from "@atlas/shared";
import { authorizeEntityAction } from "@atlas/agent-core";
import { requireSignedInForWrite, requireUser } from "../middleware/auth-guards.js";
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

export async function registerObserverRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post("/api/v1/observe/cycle", async (request, reply) => {
    await requireSignedInForWrite(app, request);

    // Entity-policy gate: observe cycle is RECORD.EXECUTE.
    const entityDecision = authorizeEntityAction("RECORD", "EXECUTE", {
      mode: "WRITE",
      writeGateOpen: true,
      approved: true,
    });
    if (entityDecision.decision !== "ALLOWED") {
      const reason =
        entityDecision.decision === "DENIED"
          ? entityDecision.reason
          : "RECORD.EXECUTE requires explicit approval";
      throw new AtlasError("FORBIDDEN", reason, { statusCode: 403 });
    }

    const result = executeObserveCycle({
      body: request.body,
      envGoldenRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
    });
    return reply.send(result);
  });

  app.post("/api/v1/projects/:id/observe-cycle", async (request, reply) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    await assertProjectWriteAccess(app, request, projectId);
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
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    await assertProjectReadAccess(app, request, projectId);
    return readObserverState({
      projectId,
      envGoldenRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
    });
  });

  app.get("/api/v1/projects/:id/observer/expected", async (request) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
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
    await assertProjectWriteAccess(app, request, projectId);
    const result = putExpectedBehaviorModel({
      projectId,
      body: request.body,
      envGoldenRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
    });
    return reply.send(result);
  });

  app.get("/api/v1/projects/:id/observer/snapshots", async (request) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
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

    // When projectId is provided, require auth and project access.
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
    await requireSignedInForWrite(app, request);
    const result = executeBugIngest({
      body: request.body,
      envGoldenRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
    });
    return reply.status(201).send(result);
  });
}

import type { FastifyInstance } from "fastify";
import {
  AtlasError,
  createArtifactSchema,
  createAssistRunSchema,
} from "@atlas/shared";
import {
  createArtifactFromUpload,
  ensureCreditsInitialized,
  runAssist,
} from "../services/artifacts-assists.js";
import { osStore } from "../store/os-store.js";
import { resolveTier } from "../services/plan-quota.js";
import { requireUser } from "../middleware/auth-guards.js";
import { canReadProjectScoped } from "../services/project-access.js";

export async function registerArtifactRoutes(app: FastifyInstance): Promise<void> {
  osStore.ensureLoaded();

  app.get("/api/v1/artifacts", async (request) => {
    const user = await requireUser(app, request);
    const items = osStore
      .listArtifacts()
      .filter((item) => canReadProjectScoped(user, item.projectId));
    return { items, total: items.length };
  });

  app.post("/api/v1/artifacts", async (request, reply) => {
    const body = createArtifactSchema.parse(request.body);
    try {
      const result = createArtifactFromUpload(body);
      return reply.status(201).send(result);
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_SIZE") {
        throw new AtlasError(
          "VALIDATION_ERROR",
          "Artifact empty or larger than 5MB",
        );
      }
      throw error;
    }
  });

  app.get("/api/v1/assists/runs", async (request) => {
    const user = await requireUser(app, request);
    const items = osStore
      .listAssistRuns()
      .filter((item) => canReadProjectScoped(user, item.projectId));
    return { items, total: items.length };
  });

  app.post("/api/v1/assists/runs", async (request, reply) => {
    const body = createAssistRunSchema.parse(request.body);
    const { tier } = resolveTier(app.atlasEnv);
    ensureCreditsInitialized(tier);
    try {
      const run = await runAssist(
        body,
        app.atlasEnv.OPENAI_API_KEY
          ? { openaiKey: app.atlasEnv.OPENAI_API_KEY }
          : {},
      );
      return reply.status(201).send(run);
    } catch (error) {
      if (error instanceof Error && error.message === "INSUFFICIENT_CREDITS") {
        throw new AtlasError(
          "QUOTA_EXCEEDED",
          "Not enough assist credits. Purchase a pack on Plan or use local-checklist (free).",
          {
            statusCode: 402,
            details: { upgradeHint: "POST /api/v1/billing/credits/purchase" },
          },
        );
      }
      if (error instanceof Error && error.message.startsWith("ARTIFACT_MISSING")) {
        throw new AtlasError("NOT_FOUND", error.message);
      }
      throw error;
    }
  });
}

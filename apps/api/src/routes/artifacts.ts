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
import { requireSignedInForWrite, requireUser } from "../middleware/auth-guards.js";
import { canReadProjectScoped } from "../services/project-access.js";
import { enforceEntityWrite } from "../services/risk-audit.js";

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
    // SECURITY FIX (found while widening Policy Engine coverage): this
    // route had ZERO auth — anyone could upload an artifact (consuming
    // storage) with no attribution. `requireSignedInForWrite` matches the
    // sibling `GET /api/v1/artifacts` route's `requireUser` gate.
    const user = await requireSignedInForWrite(app, request);
    const body = createArtifactSchema.parse(request.body);
    enforceEntityWrite({
      entityType: "DOCUMENT",
      action: "CREATE",
      routeLabel: "artifacts.upload",
      actorId: user.id,
      projectId: body.projectId ?? null,
    });
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
    // SECURITY FIX (found while widening Policy Engine coverage): this
    // route had ZERO auth — anyone could burn AI-assist credits with no
    // attribution or rate limiting via ownership. `requireSignedInForWrite`
    // matches the sibling `GET /api/v1/assists/runs` route's `requireUser`
    // gate.
    const user = await requireSignedInForWrite(app, request);
    const body = createAssistRunSchema.parse(request.body);
    enforceEntityWrite({
      entityType: "RECORD",
      action: "EXECUTE",
      routeLabel: "assists.run",
      actorId: user.id,
      projectId: body.projectId ?? null,
    });
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

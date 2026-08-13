/**
 * Atlas Sentinel — defensive security API routes.
 * No offensive scanning · no exploit guidance · secrets always redacted.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { uuidSchema } from "@atlas/shared";
import { runSentinelScan } from "@atlas/observer";
import { requireSignedInForWrite } from "../middleware/auth-guards.js";
import { resolveObserverWorkspace } from "../services/observe-cycle.js";

export async function registerSentinelRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post("/api/v1/projects/:id/sentinel/scan", async (request, reply) => {
    requireSignedInForWrite(app, request);
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    const body = z
      .object({ workspaceRoot: z.string().min(1).max(1000).optional() })
      .parse(request.body ?? {});
    const resolved = resolveObserverWorkspace({
      projectId,
      workspaceRoot: body.workspaceRoot ?? null,
      envGoldenRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
    });
    const result = runSentinelScan(resolved.workspaceRoot);
    return reply.send({
      ...result,
      projectId,
      projectSlug: resolved.projectSlug,
      agent: "Atlas Sentinel",
      mode: "defensive",
    });
  });

  app.get("/api/v1/projects/:id/sentinel", async (request) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    const resolved = resolveObserverWorkspace({
      projectId,
      envGoldenRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
    });
    // Fresh lightweight read — no write gate for status
    const result = runSentinelScan(resolved.workspaceRoot);
    return {
      ...result,
      projectId,
      projectSlug: resolved.projectSlug,
      agent: "Atlas Sentinel",
      mode: "defensive",
    };
  });
}

/**
 * Workspace-wide replace. Preview is read-only. Apply writes selected files
 * through the workspace write path. Never writes .env. Not Agent Apply.
 */
import type { FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { AtlasError, uuidSchema } from "@atlas/shared";
import { applyWorkspaceReplace, previewWorkspaceReplace } from "@atlas/code-intelligence";
import { assertProjectReadAccess, assertProjectWriteAccess } from "../services/project-access.js";
import { osStore } from "../store/os-store.js";
import { isAgentPtyRequest } from "../services/studio-pty.js";

function linkedWorkspace(projectId: string): string {
  const stored = osStore.getWorkspaceRoot(projectId);
  if (!stored || !existsSync(stored)) {
    throw new AtlasError(
      "VALIDATION_ERROR",
      "Link a local workspaceRoot before using workspace replace.",
      { statusCode: 400 },
    );
  }
  return resolve(stored);
}

export async function registerStudioReplaceRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/projects/:id/studio/replace/preview", async (request) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    await assertProjectReadAccess(app, request, projectId);
    const body = z
      .object({
        query: z.string().min(2).max(80),
        replacement: z.string().max(200),
      })
      .strict()
      .parse(request.body ?? {});
    const root = linkedWorkspace(projectId);
    try {
      return previewWorkspaceReplace(root, body.query, body.replacement);
    } catch (error) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        error instanceof Error ? error.message : "Workspace replace preview failed",
      );
    }
  });

  app.post("/api/v1/projects/:id/studio/replace/apply", async (request) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    if (isAgentPtyRequest(request.headers as Record<string, unknown>)) {
      throw new AtlasError("FORBIDDEN", "Workspace replace is human-only.", { statusCode: 403 });
    }
    const user = await assertProjectWriteAccess(app, request, projectId);
    const body = z
      .object({
        query: z.string().min(2).max(80),
        replacement: z.string().max(200),
        paths: z.array(z.string().min(1).max(500)).min(1).max(40),
      })
      .strict()
      .parse(request.body ?? {});
    const root = linkedWorkspace(projectId);
    const result = applyWorkspaceReplace(root, body.query, body.replacement, body.paths);
    osStore.appendAudit({
      type: "studio.replace.applied",
      projectId,
      actorId: user.id,
      at: new Date().toISOString(),
      query: body.query,
      files: result.written.map((row) => row.path),
      skipped: result.skipped,
    });
    return result;
  });
}

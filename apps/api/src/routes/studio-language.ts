/**
 * Type-aware Studio language intelligence. Uses TypeScript's language service.
 * Human project access required. Rename apply writes through the workspace
 * write path — not Agent Apply, not an LLM.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AtlasError, uuidSchema } from "@atlas/shared";
import {
  applyStudioLanguageEdits,
  readWorkspaceFile,
  studioLanguageDefinition,
  studioLanguageDiagnostics,
  studioLanguageHover,
  studioLanguageReferences,
  studioLanguageRename,
  studioLanguageSymbols,
  writeWorkspaceFile,
} from "@atlas/code-intelligence";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { assertProjectReadAccess, assertProjectWriteAccess } from "../services/project-access.js";
import { osStore } from "../store/os-store.js";
import { isAgentPtyRequest } from "../services/studio-pty.js";

const pathSchema = z.string().min(1).max(500);
const unsavedSchema = z
  .object({
    path: pathSchema,
    content: z.string().max(400_000),
  })
  .optional();

function linkedWorkspace(projectId: string): string {
  const stored = osStore.getWorkspaceRoot(projectId);
  if (!stored || !existsSync(stored)) {
    throw new AtlasError(
      "VALIDATION_ERROR",
      "Link a local workspaceRoot before using Studio language intelligence.",
      { statusCode: 400 },
    );
  }
  return resolve(stored);
}

function headerMap(request: { headers: unknown }): Record<string, unknown> {
  return request.headers as Record<string, unknown>;
}

export async function registerStudioLanguageRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/projects/:id/studio/language/diagnostics", async (request) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    await assertProjectReadAccess(app, request, projectId);
    const body = z
      .object({
        path: pathSchema,
        unsaved: unsavedSchema,
      })
      .strict()
      .parse(request.body ?? {});
    const root = linkedWorkspace(projectId);
    try {
      return {
        path: body.path,
        diagnostics: studioLanguageDiagnostics(root, body.path, body.unsaved),
        engine: "typescript-language-service",
      };
    } catch (error) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        error instanceof Error ? error.message : "Language diagnostics failed",
      );
    }
  });

  app.post("/api/v1/projects/:id/studio/language/hover", async (request) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    await assertProjectReadAccess(app, request, projectId);
    const body = z
      .object({
        path: pathSchema,
        line: z.number().int().min(1).max(100_000),
        column: z.number().int().min(1).max(10_000),
        unsaved: unsavedSchema,
      })
      .strict()
      .parse(request.body ?? {});
    const root = linkedWorkspace(projectId);
    return {
      hover: studioLanguageHover(root, body.path, body.line, body.column, body.unsaved),
    };
  });

  app.post("/api/v1/projects/:id/studio/language/definition", async (request) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    await assertProjectReadAccess(app, request, projectId);
    const body = z
      .object({
        path: pathSchema,
        line: z.number().int().min(1).max(100_000),
        column: z.number().int().min(1).max(10_000),
        unsaved: unsavedSchema,
      })
      .strict()
      .parse(request.body ?? {});
    const root = linkedWorkspace(projectId);
    return {
      location: studioLanguageDefinition(root, body.path, body.line, body.column, body.unsaved),
    };
  });

  app.post("/api/v1/projects/:id/studio/language/references", async (request) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    await assertProjectReadAccess(app, request, projectId);
    const body = z
      .object({
        path: pathSchema,
        line: z.number().int().min(1).max(100_000),
        column: z.number().int().min(1).max(10_000),
        unsaved: unsavedSchema,
      })
      .strict()
      .parse(request.body ?? {});
    const root = linkedWorkspace(projectId);
    return {
      references: studioLanguageReferences(root, body.path, body.line, body.column, body.unsaved),
    };
  });

  app.post("/api/v1/projects/:id/studio/language/symbols", async (request) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    await assertProjectReadAccess(app, request, projectId);
    const body = z.object({ path: pathSchema, unsaved: unsavedSchema }).strict().parse(request.body ?? {});
    const root = linkedWorkspace(projectId);
    return { symbols: studioLanguageSymbols(root, body.path, body.unsaved) };
  });

  app.post("/api/v1/projects/:id/studio/language/rename", async (request) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    if (isAgentPtyRequest(headerMap(request))) {
      throw new AtlasError("FORBIDDEN", "Studio rename is human-only.", { statusCode: 403 });
    }
    const user = await assertProjectWriteAccess(app, request, projectId);
    const body = z
      .object({
        path: pathSchema,
        line: z.number().int().min(1).max(100_000),
        column: z.number().int().min(1).max(10_000),
        newName: z.string().min(1).max(80),
        apply: z.boolean().optional(),
        unsaved: unsavedSchema,
      })
      .strict()
      .parse(request.body ?? {});
    const root = linkedWorkspace(projectId);
    const edits = studioLanguageRename(
      root,
      body.path,
      body.line,
      body.column,
      body.newName,
      body.unsaved,
    );
    if (!body.apply) {
      return { edits, applied: false as const };
    }
    // `edits` is `readonly StudioLsEdit[]`; use a mutable per-file accumulator
    // so `.push` type-checks without weakening the shared readonly return type.
    const byPath = new Map<string, Array<(typeof edits)[number]>>();
    for (const edit of edits) {
      const list = byPath.get(edit.path) ?? [];
      list.push(edit);
      byPath.set(edit.path, list);
    }
    const written: string[] = [];
    for (const [rel, fileEdits] of byPath) {
      const current = readWorkspaceFile(root, rel);
      const next = applyStudioLanguageEdits(current.content, fileEdits, rel);
      writeWorkspaceFile(root, rel, next);
      written.push(rel);
    }
    osStore.appendAudit({
      type: "studio.language.renamed",
      projectId,
      actorId: user.id,
      at: new Date().toISOString(),
      path: body.path,
      newName: body.newName,
      files: written,
    });
    return { edits, applied: true as const, written };
  });
}

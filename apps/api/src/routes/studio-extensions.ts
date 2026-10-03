import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AtlasError, uuidSchema } from "@atlas/shared";
import { requireSignedInForWrite, requireUser } from "../middleware/auth-guards.js";
import {
  assertProjectReadAccess,
  assertProjectWriteAccess,
} from "../services/project-access.js";
import {
  STUDIO_EXTENSION_CONTRACT,
  STUDIO_EXTENSION_PERMISSIONS,
  STUDIO_VERSION,
  installStudioExtension,
  listStudioExtensionCatalog,
  listStudioExtensions,
  setStudioExtensionEnabled,
  setStudioExtensionGrants,
  setStudioExtensionOrder,
  setStudioExtensionView,
  uninstallStudioExtension,
  updateStudioExtension,
  verifyStudioExtension,
  type StudioExtensionDenial,
} from "../services/studio-extensions.js";
import { osStore } from "../store/os-store.js";

const extensionIdSchema = z.string().min(1).max(80).regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);

function fail(denial: StudioExtensionDenial, extensionId: string): never {
  const notFound = denial === "UNKNOWN_EXTENSION";
  throw new AtlasError(
    notFound ? "NOT_FOUND" : "VALIDATION_ERROR",
    `Studio extension "${extensionId}": ${denial}`,
    { statusCode: notFound ? 404 : denial === "BUILTIN_CANNOT_UNINSTALL" ? 403 : 409, details: { denial } },
  );
}

function audit(
  type: string,
  userId: string,
  payload: Record<string, unknown>,
  projectId: string | null = null,
): void {
  osStore.appendAudit({
    type,
    ...(projectId ? { projectId } : {}),
    actorId: userId,
    actorKind: "USER",
    at: new Date().toISOString(),
    ...payload,
  });
}

/**
 * ADR-026 — Studio extensions: official catalog (user scope) and per-project
 * enablement, order, view state and verification. Every change is audited.
 */
export async function registerStudioExtensionRoutes(app: FastifyInstance): Promise<void> {
  // ---- user scope -------------------------------------------------------
  app.get("/api/v1/studio/extensions/catalog", async (request) => {
    const user = await requireUser(app, request);
    return {
      contract: STUDIO_EXTENSION_CONTRACT,
      studioVersion: STUDIO_VERSION,
      permissions: STUDIO_EXTENSION_PERMISSIONS,
      extensions: listStudioExtensionCatalog(user.id),
    };
  });

  app.post("/api/v1/studio/extensions/:extensionId/install", async (request) => {
    const user = await requireSignedInForWrite(app, request);
    const id = extensionIdSchema.parse((request.params as { extensionId: string }).extensionId);
    const result = installStudioExtension(user.id, id);
    if (!result.ok) fail(result.denial, id);
    audit("studio.extension.installed", user.id, { extensionId: id, version: result.value.version });
    return { extensionId: id, install: result.value };
  });

  app.post("/api/v1/studio/extensions/:extensionId/uninstall", async (request) => {
    const user = await requireSignedInForWrite(app, request);
    const id = extensionIdSchema.parse((request.params as { extensionId: string }).extensionId);
    const result = uninstallStudioExtension(user.id, id);
    if (!result.ok) fail(result.denial, id);
    audit("studio.extension.uninstalled", user.id, { extensionId: id });
    return { extensionId: id, uninstalled: true };
  });

  app.post("/api/v1/studio/extensions/:extensionId/update", async (request) => {
    const user = await requireSignedInForWrite(app, request);
    const id = extensionIdSchema.parse((request.params as { extensionId: string }).extensionId);
    const result = updateStudioExtension(user.id, id);
    if (!result.ok) fail(result.denial, id);
    audit("studio.extension.updated", user.id, { extensionId: id, version: result.value.version });
    return { extensionId: id, install: result.value };
  });

  app.post("/api/v1/studio/extensions/:extensionId/permissions", async (request) => {
    const user = await requireSignedInForWrite(app, request);
    const id = extensionIdSchema.parse((request.params as { extensionId: string }).extensionId);
    const body = z
      .object({
        grant: z.array(z.string().min(1).max(80)).max(20).default([]),
        revoke: z.array(z.string().min(1).max(80)).max(20).default([]),
      })
      .parse(request.body ?? {});
    const result = setStudioExtensionGrants(user.id, id, body);
    if (!result.ok) fail(result.denial, id);
    for (const permission of body.grant) {
      audit("studio.extension.permission.granted", user.id, { extensionId: id, permission });
    }
    for (const permission of body.revoke) {
      audit("studio.extension.permission.revoked", user.id, { extensionId: id, permission });
    }
    return { extensionId: id, install: result.value };
  });

  // ---- project scope ----------------------------------------------------
  app.get("/api/v1/projects/:id/studio/extensions", async (request) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    const user = await assertProjectReadAccess(app, request, projectId);
    return {
      contract: STUDIO_EXTENSION_CONTRACT,
      studioVersion: STUDIO_VERSION,
      projectId,
      ...listStudioExtensions(user.id, projectId),
    };
  });

  for (const action of ["enable", "disable"] as const) {
    app.post(`/api/v1/projects/:id/studio/extensions/:extensionId/${action}`, async (request) => {
      const params = request.params as { id: string; extensionId: string };
      const projectId = uuidSchema.parse(params.id);
      const user = await assertProjectWriteAccess(app, request, projectId);
      const id = extensionIdSchema.parse(params.extensionId);
      const result = setStudioExtensionEnabled(user.id, projectId, id, action === "enable");
      if (!result.ok) fail(result.denial, id);
      audit(`studio.extension.${action}d`, user.id, { extensionId: id }, projectId);
      return { extensionId: id, projectId, enabled: result.value.enabled };
    });
  }

  app.put("/api/v1/projects/:id/studio/extensions/order", async (request) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    const user = await assertProjectWriteAccess(app, request, projectId);
    const body = z.object({ order: z.array(extensionIdSchema).max(50) }).parse(request.body);
    const result = setStudioExtensionOrder(projectId, body.order);
    if (!result.ok) fail(result.denial, body.order.join(","));
    audit("studio.extension.order.changed", user.id, { order: result.value }, projectId);
    return { projectId, order: result.value };
  });

  app.put("/api/v1/projects/:id/studio/extensions/view", async (request) => {
    const projectId = uuidSchema.parse((request.params as { id: string }).id);
    await assertProjectWriteAccess(app, request, projectId);
    const body = z
      .object({ view: z.record(z.string().max(80), z.union([z.string().max(200), z.number(), z.boolean(), z.null()])) })
      .parse(request.body);
    if (Object.keys(body.view).length > 40) {
      throw new AtlasError("VALIDATION_ERROR", "Too many view settings", { statusCode: 400 });
    }
    setStudioExtensionView(projectId, body.view);
    return { projectId, view: body.view };
  });

  app.post("/api/v1/projects/:id/studio/extensions/:extensionId/verify", async (request) => {
    const params = request.params as { id: string; extensionId: string };
    const projectId = uuidSchema.parse(params.id);
    const user = await assertProjectWriteAccess(app, request, projectId);
    const id = extensionIdSchema.parse(params.extensionId);
    const result = verifyStudioExtension(projectId, id);
    if (!result.ok) fail(result.denial, id);
    audit("studio.extension.verified", user.id, { extensionId: id, ok: result.value.ok }, projectId);
    return { extensionId: id, projectId, verification: result.value };
  });
}

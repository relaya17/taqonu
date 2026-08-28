import type { FastifyInstance } from "fastify";
import { AtlasError, STUB_OWNER_ID } from "@atlas/shared";
import { osStore } from "../store/os-store.js";
import { requireSignedInForWrite, requireUser } from "../middleware/auth-guards.js";
import { assertProjectWriteAccess } from "../services/project-access.js";
import {
  buildClonePatch,
  canReadExemplar,
  ensureCatalogSeeded,
  ingestExemplarFromDisk,
  parseCloneBody,
  parseIngestBody,
  visibleExemplarsFor,
} from "../services/exemplar-library.js";

export async function registerExemplarRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/api/v1/exemplars", async (request) => {
    const user = await requireUser(app, request);
    ensureCatalogSeeded();
    const items = visibleExemplarsFor(user.id);
    return { items, page: 1, pageSize: items.length, total: items.length };
  });

  app.get("/api/v1/exemplars/:id", async (request) => {
    const user = await requireUser(app, request);
    const id = (request.params as { id: string }).id;
    const record = osStore.getExemplar(id);
    if (!record || !canReadExemplar(record, user.id, user.role)) {
      throw new AtlasError("NOT_FOUND", "Exemplar not found", { statusCode: 404 });
    }
    return record;
  });

  app.post("/api/v1/exemplars/ingest", async (request, reply) => {
    const user = await requireSignedInForWrite(app, request);
    const body = parseIngestBody(request.body);
    const ownerId =
      body.visibility === "catalog" && user.role === "admin"
        ? STUB_OWNER_ID
        : user.id;
    const visibility =
      body.visibility === "catalog" && user.role !== "admin"
        ? "personal"
        : body.visibility;
    const record = ingestExemplarFromDisk({
      ownerId,
      createdBy: user.email,
      body: { ...body, visibility },
    });
    return reply.status(201).send({ exemplar: record });
  });

  app.post("/api/v1/exemplars/:id/clone", async (request, reply) => {
    const user = await requireSignedInForWrite(app, request);
    const id = (request.params as { id: string }).id;
    const body = parseCloneBody(request.body);
    const exemplar = osStore.getExemplar(id);
    if (!exemplar || !canReadExemplar(exemplar, user.id, user.role)) {
      throw new AtlasError("NOT_FOUND", "Exemplar not found", { statusCode: 404 });
    }
    await assertProjectWriteAccess(app, request, body.projectId);
    const workspaceRoot = osStore.getWorkspaceRoot(body.projectId);
    if (!workspaceRoot) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        "Project has no workspaceRoot — link a folder before cloning.",
        { statusCode: 400 },
      );
    }
    const result = buildClonePatch({
      exemplar,
      ...(body.unitId !== undefined ? { unitId: body.unitId } : {}),
      workspaceRoot,
      projectId: body.projectId,
      ...(body.targetPrefix !== undefined ? { targetPrefix: body.targetPrefix } : {}),
      createdBy: user.email,
      ownerId: user.id,
    });
    return reply.status(201).send({
      patch: result.patch,
      memory: result.memory,
      cloneReady: result.cloneReady,
      files: result.patch.filesChanged.length,
      note: "Patch proposed — Approve then Apply. Not copied to disk yet.",
    });
  });
}

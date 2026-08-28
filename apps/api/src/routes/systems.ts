import type { FastifyInstance } from "fastify";
import { AtlasError, systemContractWriteSchema, uuidSchema } from "@atlas/shared";
import { z } from "zod";
import { requireSignedInForWrite, requireUser } from "../middleware/auth-guards.js";
import {
  assertProjectReadAccess,
  assertProjectWriteAccess,
} from "../services/project-access.js";
import { osStore } from "../store/os-store.js";
import { appendDomainEvent } from "../services/memory-pipeline.js";
import { resolveWorkspaceRoot } from "../services/golden-root.js";
import { buildExecutiveReport } from "../services/atlas-verdict.js";
import {
  getManagedSystem,
  getManagedSystemDetail,
  getSystemContract,
  listManagedSystems,
  putSystemContract,
} from "../services/managed-systems.js";

async function assertSystemWrite(
  app: FastifyInstance,
  request: Parameters<typeof requireSignedInForWrite>[1],
  systemId: string,
): Promise<void> {
  const system = getManagedSystem(systemId);
  if (!system) {
    throw new AtlasError("NOT_FOUND", "Managed system not found");
  }
  if (system.projectId) {
    await assertProjectWriteAccess(app, request, system.projectId);
    return;
  }
  await requireSignedInForWrite(app, request);
}

async function assertSystemRead(
  app: FastifyInstance,
  request: Parameters<typeof requireUser>[1],
  systemId: string,
): Promise<void> {
  const system = getManagedSystem(systemId);
  if (!system) {
    throw new AtlasError("NOT_FOUND", "Managed system not found");
  }
  if (system.projectId) {
    await assertProjectReadAccess(app, request, system.projectId);
    return;
  }
  await requireUser(app, request);
}

export async function registerSystemRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Tenant-scoped system list (P0 fix): requires authentication.
   * Without this, any anonymous user could list all managed systems.
   */
  app.get("/api/v1/systems", async (request) => {
    await requireUser(app, request);
    return listManagedSystems();
  });

  app.get("/api/v1/systems/:id", async (request) => {
    const params = z.object({ id: uuidSchema }).parse(request.params);
    await assertSystemRead(app, request, params.id);
    try {
      return getManagedSystemDetail(params.id);
    } catch {
      throw new AtlasError("NOT_FOUND", "Managed system not found");
    }
  });

  app.get("/api/v1/systems/:id/contract", async (request) => {
    const params = z.object({ id: uuidSchema }).parse(request.params);
    await assertSystemRead(app, request, params.id);
    try {
      return getSystemContract(params.id);
    } catch {
      throw new AtlasError("NOT_FOUND", "Managed system not found");
    }
  });

  app.get("/api/v1/systems/:id/executive-report", async (request, reply) => {
    const params = z.object({ id: uuidSchema }).parse(request.params);
    await assertSystemRead(app, request, params.id);
    const q = z
      .object({
        workspaceRoot: z.string().max(1000).optional(),
        locale: z.enum(["he", "en", "ar"]).optional(),
      })
      .parse(request.query ?? {});
    const system = getManagedSystem(params.id);
    if (!system) {
      throw new AtlasError("NOT_FOUND", "Managed system not found");
    }
    if (!system.projectId) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        "Managed system has no bound project — bind a project before Run Audit.",
      );
    }
    const stored = osStore.getWorkspaceRoot(system.projectId);
    const workspaceRoot = resolveWorkspaceRoot({
      queryRoot: q.workspaceRoot ?? stored ?? null,
      envRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
    });
    const report = buildExecutiveReport({
      projectId: system.projectId,
      workspaceRoot,
      locale: q.locale ?? "en",
      systemId: system.id,
    });
    osStore.incrementUsage("reportsGenerated");
    appendDomainEvent({
      type: "evaluation.completed",
      projectId: system.projectId,
      epistemicState: "OBSERVED",
      payload: { kind: "executive-report", reportId: report.id, systemId: system.id },
    });
    return reply.status(200).send(report);
  });

  app.put("/api/v1/systems/:id/contract", async (request) => {
    const params = z.object({ id: uuidSchema }).parse(request.params);
    await assertSystemWrite(app, request, params.id);
    const body = systemContractWriteSchema.parse(request.body ?? {});
    try {
      return putSystemContract(params.id, body);
    } catch {
      throw new AtlasError("NOT_FOUND", "Managed system not found");
    }
  });
}

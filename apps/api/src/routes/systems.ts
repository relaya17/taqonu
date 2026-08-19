import type { FastifyInstance } from "fastify";
import {
  AtlasError,
  systemContractWriteSchema,
  uuidSchema,
  type AuthUser,
} from "@atlas/shared";
import { z } from "zod";
import { requireSignedInForWrite, requireUser } from "../middleware/auth-guards.js";
import { enforceEntityWrite } from "../services/risk-audit.js";
import {
  assertProjectReadAccess,
  assertProjectWriteAccess,
  canReadProjectScoped,
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
): Promise<AuthUser> {
  const system = getManagedSystem(systemId);
  if (!system) {
    throw new AtlasError("NOT_FOUND", "Managed system not found");
  }
  if (system.projectId) {
    return assertProjectWriteAccess(app, request, system.projectId);
  }
  return requireSignedInForWrite(app, request);
}

/** READ-gate mirror of `assertSystemWrite` above — each Managed System is
 * derived 1:1 from a project (see managed-systems.ts's `projectSystem`), so
 * it carries the same ownership boundary as the underlying project. */
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
  app.get("/api/v1/systems", async (request) => {
    // SECURITY FIX (found while widening Policy Engine coverage): this
    // route had ZERO auth and listed a Managed System (workspace root,
    // verdict hint, risk counts) for EVERY project across EVERY tenant —
    // each Managed System maps 1:1 to a project (see managed-systems.ts).
    const user = await requireUser(app, request);
    const list = listManagedSystems();
    return {
      ...list,
      items: list.items.filter((item) =>
        canReadProjectScoped(user, item.projectId),
      ),
    };
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
    // SECURITY FIX: this route had ZERO auth and both leaked report content
    // and triggered real report-generation compute (usage-metered). Gated
    // at write-strength (assertSystemWrite) since it consumes resources,
    // same treatment as engineering-loop.ts's proof/run.
    const params = z.object({ id: uuidSchema }).parse(request.params);
    await assertSystemWrite(app, request, params.id);
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
    const user = await assertSystemWrite(app, request, params.id);
    enforceEntityWrite({
      entityType: "CONFIGURATION",
      action: "UPDATE",
      routeLabel: "systems.contract.update",
      actorId: user.id,
    });
    const body = systemContractWriteSchema.parse(request.body ?? {});
    try {
      return putSystemContract(params.id, body);
    } catch {
      throw new AtlasError("NOT_FOUND", "Managed system not found");
    }
  });
}

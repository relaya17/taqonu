import type { FastifyInstance } from "fastify";
import { AtlasError, systemContractWriteSchema, uuidSchema } from "@atlas/shared";
import { z } from "zod";
import { requireSignedInForWrite } from "../middleware/auth-guards.js";
import { assertProjectWriteAccess } from "../services/project-access.js";
import {
  getManagedSystem,
  getManagedSystemDetail,
  getSystemContract,
  listManagedSystems,
  putSystemContract,
} from "../services/managed-systems.js";

function assertSystemWrite(
  app: FastifyInstance,
  request: Parameters<typeof requireSignedInForWrite>[1],
  systemId: string,
): void {
  const system = getManagedSystem(systemId);
  if (!system) {
    throw new AtlasError("NOT_FOUND", "Managed system not found");
  }
  if (system.projectId) {
    assertProjectWriteAccess(app, request, system.projectId);
    return;
  }
  requireSignedInForWrite(app, request);
}

export async function registerSystemRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/systems", async () => listManagedSystems());

  app.get("/api/v1/systems/:id", async (request) => {
    const params = z.object({ id: uuidSchema }).parse(request.params);
    try {
      return getManagedSystemDetail(params.id);
    } catch {
      throw new AtlasError("NOT_FOUND", "Managed system not found");
    }
  });

  app.get("/api/v1/systems/:id/contract", async (request) => {
    const params = z.object({ id: uuidSchema }).parse(request.params);
    try {
      return getSystemContract(params.id);
    } catch {
      throw new AtlasError("NOT_FOUND", "Managed system not found");
    }
  });

  app.put("/api/v1/systems/:id/contract", async (request) => {
    const params = z.object({ id: uuidSchema }).parse(request.params);
    assertSystemWrite(app, request, params.id);
    const body = systemContractWriteSchema.parse(request.body ?? {});
    try {
      return putSystemContract(params.id, body);
    } catch {
      throw new AtlasError("NOT_FOUND", "Managed system not found");
    }
  });
}

import type { FastifyInstance } from "fastify";
import { AtlasError, uuidSchema } from "@atlas/shared";
import { defaultSystemContract } from "@atlas/system-model";
import { z } from "zod";
import { listManagedSystems } from "../services/managed-systems.js";

export async function registerSystemRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/systems", async () => listManagedSystems());

  app.get("/api/v1/systems/:id/contract", async (request) => {
    const params = z.object({ id: uuidSchema }).parse(request.params);
    const list = listManagedSystems();
    const system = list.items.find((item) => item.id === params.id);
    if (!system) {
      throw new AtlasError("NOT_FOUND", "Managed system not found");
    }
    return defaultSystemContract(system);
  });
}
import type { FastifyInstance } from "fastify";
import { osStore } from "../store/os-store.js";

export async function registerAuditRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/audit", async () => {
    osStore.ensureLoaded();
    const items = [...osStore.listAudit()].reverse();
    return {
      items,
      total: items.length,
      note: "Durable audit trail in .atlas/store.json (ADR-013).",
    };
  });
}

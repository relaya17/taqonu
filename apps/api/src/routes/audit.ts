import type { FastifyInstance } from "fastify";
import { osStore } from "../store/os-store.js";
import {
  countAuditLogLines,
  resolveAuditLogPath,
} from "../services/audit-log.js";

export async function registerAuditRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/audit", async () => {
    osStore.ensureLoaded();
    const items = [...osStore.listAudit()].reverse();
    const logPath = resolveAuditLogPath();
    const durableCount = countAuditLogLines();
    return {
      items,
      total: items.length,
      durableCount,
      durablePath: logPath,
      note:
        "Recent ring in memory/store.json; full append-only hash-chained log at .atlas/audit/audit.ndjson (never truncated).",
    };
  });
}

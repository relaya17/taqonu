import type { FastifyInstance } from "fastify";
import { uuidSchema } from "@atlas/shared";
import { z } from "zod";
import { computeCostIntelligenceSummary } from "../services/cost-intelligence.js";

/**
 * Read-only cost intelligence surface — see
 * apps/api/src/services/cost-intelligence.ts for exactly which real,
 * already-persisted data source this aggregates (osStore.listAudit()) and
 * an honest accounting of how "real" costUsd currently is in this codebase.
 */
export async function registerCostIntelligenceRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/api/v1/cost-intelligence", async (request) => {
    const query = z
      .object({ projectId: uuidSchema.optional() })
      .parse(request.query ?? {});
    const summary = computeCostIntelligenceSummary({
      ...(query.projectId !== undefined ? { projectId: query.projectId } : {}),
    });
    return summary;
  });
}

import type { FastifyInstance } from "fastify";
import { ERROR_AGGREGATE_CONTROL_PATH } from "@atlas/shared";
import { getErrorAggregateSummary } from "@atlas/observability";
import { requireControlPlaneService } from "../services/governed-lifecycle-handoff.js";

/**
 * CP SERVICE → process-local error aggregator.
 * Writes stay in error-handler middleware; this is the missing read surface.
 */
export async function registerErrorAggregateControlRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(ERROR_AGGREGATE_CONTROL_PATH, async (request) => {
    requireControlPlaneService(request.headers.authorization);
    return getErrorAggregateSummary();
  });
}

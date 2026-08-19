import type { FastifyInstance } from "fastify";
import { uuidSchema } from "@atlas/shared";
import { detectAnomalies, type AnomalyResult } from "@atlas/agent-core";
import { z } from "zod";
import {
  computeCostIntelligenceDailySeriesByProject,
  computeCostIntelligenceSummary,
} from "../services/cost-intelligence.js";

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

  /**
   * Runs `@atlas/agent-core`'s `detectAnomalies` (classical z-score/IQR
   * statistics, no ML) over the real per-project daily cost time series
   * computed in `computeCostIntelligenceDailySeriesByProject`. Honest
   * expectation: on a fresh/lightly-used instance most projects will have
   * far fewer than `MIN_SAMPLE_SIZE` (7) distinct days of dispatch cost
   * data and will correctly come back with an `INSUFFICIENT_DATA` verdict
   * per project rather than a fabricated "no anomalies" or invented
   * baseline — see anomaly-detection.ts's file-level comment.
   */
  app.get("/api/v1/cost-intelligence/anomalies", async (request) => {
    const query = z
      .object({
        projectId: uuidSchema.optional(),
        method: z.enum(["zscore", "iqr"]).optional(),
      })
      .parse(request.query ?? {});

    const series = computeCostIntelligenceDailySeriesByProject({
      ...(query.projectId !== undefined ? { projectId: query.projectId } : {}),
    });

    const byProject = series.map((project) => {
      const results: AnomalyResult[] = detectAnomalies(
        project.points.map((p) => ({ timestamp: p.date, value: p.totalUsd })),
        query.method !== undefined ? { method: query.method } : {},
      );
      return {
        projectId: project.projectId,
        sampleSize: project.points.length,
        series: project.points,
        anomalies: results,
      };
    });

    return {
      method: query.method ?? "zscore",
      generatedAt: new Date().toISOString(),
      source:
        "detectAnomalies (@atlas/agent-core, classical z-score/IQR statistics) " +
        "over computeCostIntelligenceDailySeriesByProject (osStore.listAudit(), " +
        "type=agents.dispatch, grouped by UTC calendar day)",
      note:
        "Purely statistical, not ML — no training data required, but also " +
        "no anomaly detection possible with fewer data points than " +
        "detectAnomalies' documented minimum sample size; those projects " +
        "report status INSUFFICIENT_DATA rather than a guess.",
      byProject,
    };
  });
}

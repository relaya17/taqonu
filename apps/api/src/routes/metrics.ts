import type { FastifyInstance } from "fastify";
import { InMemoryMetrics, METRICS_RING_BUFFER_CAP, type MetricName } from "@atlas/observability";
import { z } from "zod";
import {
  appendMetricsLogLine,
  countMetricsLogLines,
  readMetricsLogTail,
  resolveMetricsLogPath,
} from "../services/metrics-log.js";

/** Process-local ring + durable NDJSON under `.atlas/metrics/metrics.ndjson`. */
export const atlasMetrics = new InMemoryMetrics(METRICS_RING_BUFFER_CAP, {
  onRecord: appendMetricsLogLine,
});

const metricNames = [
  "agent_run_duration",
  "tool_failure_rate",
  "retrieval_hit_rate",
  "memory_write_rate",
  "web_verification_rate",
  "citation_rate",
  "hallucination_eval_rate",
  "patch_apply_rate",
  "github_webhook_rate",
] as const satisfies readonly MetricName[];

function metricsJsonPayload() {
  const samples = atlasMetrics.list();
  const byName: Record<string, { count: number; last: number | null }> = {};
  for (const name of metricNames) {
    byName[name] = { count: 0, last: null };
  }
  for (const s of samples) {
    const bucket = byName[s.name] ?? { count: 0, last: null as number | null };
    bucket.count += 1;
    bucket.last = s.value;
    byName[s.name] = bucket;
  }
  return {
    service: "atlas-api",
    sampleCount: samples.length,
    durableLineCount: countMetricsLogLines(),
    durablePath: resolveMetricsLogPath(),
    byName,
    recent: samples.slice(-50).reverse(),
    durableTail: readMetricsLogTail(20).reverse(),
    note: "In-memory ring + durable NDJSON (.atlas/metrics/metrics.ndjson); Prometheus at /api/v1/metrics/prometheus",
  };
}

export async function registerMetricsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/metrics", async () => metricsJsonPayload());

  app.get("/api/v1/metrics/prometheus", async (_request, reply) => {
    return reply
      .type("text/plain; version=0.0.4; charset=utf-8")
      .send(atlasMetrics.toPrometheusText());
  });

  /** Common scrape alias for local Prometheus / ops tooling. */
  app.get("/metrics", async (_request, reply) => {
    return reply
      .type("text/plain; version=0.0.4; charset=utf-8")
      .send(atlasMetrics.toPrometheusText());
  });

  app.post("/api/v1/metrics/record", async (request, reply) => {
    const body = z
      .object({
        name: z.enum(metricNames),
        value: z.number(),
        tags: z.record(z.string()).optional(),
      })
      .parse(request.body);
    if (body.tags) {
      atlasMetrics.record(body.name, body.value, body.tags);
    } else {
      atlasMetrics.record(body.name, body.value);
    }
    return reply.status(201).send({ ok: true, durable: true });
  });
}

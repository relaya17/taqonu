import type { FastifyInstance } from "fastify";
import { InMemoryMetrics, type MetricName } from "@atlas/observability";
import { z } from "zod";

/** Process-local metrics (ADR observability §50 MVP). */
export const atlasMetrics = new InMemoryMetrics();

const metricNames = [
  "agent_run_duration",
  "tool_failure_rate",
  "retrieval_hit_rate",
  "memory_write_rate",
  "web_verification_rate",
  "citation_rate",
  "hallucination_eval_rate",
  "patch_apply_rate",
] as const satisfies readonly MetricName[];

export async function registerMetricsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/metrics", async () => {
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
      byName,
      recent: samples.slice(-50).reverse(),
      note: "In-memory metrics MVP — not Prometheus export yet",
    };
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
    return reply.status(201).send({ ok: true });
  });
}

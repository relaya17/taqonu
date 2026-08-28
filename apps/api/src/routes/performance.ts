/**
 * Stage 18 — Performance Dashboard Routes.
 *
 * Exposes performance metrics, cache stats, and system health.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { readCache, type CacheStats } from "../services/response-cache.js";
import {
  PERFORMANCE_LIMITS,
  getMemoryStats,
  isMemoryPressureHigh,
} from "../services/performance-limits.js";
import { atlasMetrics } from "./metrics.js";

interface PerformanceDashboard {
  timestamp: string;
  memory: ReturnType<typeof getMemoryStats>;
  cache: CacheStats;
  limits: typeof PERFORMANCE_LIMITS;
  metrics: {
    sampleCount: number;
    recentLatencies: number[];
  };
}

function buildDashboard(): PerformanceDashboard {
  const samples = atlasMetrics.list();
  const latencies = samples
    .filter(s => s.name === "http_request_duration_ms")
    .map(s => s.value)
    .slice(-100);

  return {
    timestamp: new Date().toISOString(),
    memory: getMemoryStats(),
    cache: readCache.stats(),
    limits: PERFORMANCE_LIMITS,
    metrics: {
      sampleCount: samples.length,
      recentLatencies: latencies,
    },
  };
}

export async function registerPerformanceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/performance", async () => buildDashboard());

  app.get("/api/v1/performance/memory", async () => getMemoryStats());

  app.get("/api/v1/performance/cache", async () => readCache.stats());

  app.post("/api/v1/performance/cache/clear", async (_request, reply) => {
    readCache.clear();
    return reply.status(200).send({ cleared: true, stats: readCache.stats() });
  });

  app.get("/api/v1/performance/health", async () => ({
    healthy: !isMemoryPressureHigh(),
    memoryPressure: isMemoryPressureHigh(),
    timestamp: new Date().toISOString(),
  }));

  app.get("/api/v1/performance/limits", async () => PERFORMANCE_LIMITS);

  /** Latency percentiles from recent samples */
  app.get("/api/v1/performance/latency", async () => {
    const samples = atlasMetrics.list();
    const latencies = samples
      .filter(s => s.name === "http_request_duration_ms")
      .map(s => s.value)
      .sort((a, b) => a - b);

    if (latencies.length === 0) {
      return {
        sampleCount: 0,
        p50: null,
        p90: null,
        p95: null,
        p99: null,
        min: null,
        max: null,
        avg: null,
      };
    }

    const p = (pct: number) => latencies[Math.floor(latencies.length * pct / 100)] ?? null;
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;

    return {
      sampleCount: latencies.length,
      p50: p(50),
      p90: p(90),
      p95: p(95),
      p99: p(99),
      min: latencies[0],
      max: latencies[latencies.length - 1],
      avg: Math.round(avg * 100) / 100,
    };
  });
}

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { atlasMetrics } from "../routes/metrics.js";

const HTTP_REQUEST_DURATION_MS = "http_request_duration_ms";

declare module "fastify" {
  interface FastifyRequest {
    atlasRequestStartedAt?: number;
  }
}

/**
 * Records wall-clock latency for every request that passes through the app,
 * not just the handful of routes that currently self-instrument via
 * atlasMetrics.record(...) inline. Uses a manual onRequest timestamp rather
 * than reply.elapsedTime/getResponseTime() so this stays correct regardless
 * of the exact installed Fastify 5.x patch version.
 */
export function registerRequestTiming(app: FastifyInstance): void {
  app.addHook("onRequest", async (request: FastifyRequest) => {
    request.atlasRequestStartedAt = Date.now();
  });

  app.addHook("onResponse", async (request: FastifyRequest, reply: FastifyReply) => {
    const startedAt = request.atlasRequestStartedAt;
    const elapsedMs = startedAt !== undefined ? Date.now() - startedAt : 0;
    atlasMetrics.record(HTTP_REQUEST_DURATION_MS, elapsedMs, {
      method: request.method,
      route: request.routeOptions?.url ?? request.url,
      statusCode: String(reply.statusCode),
    });
  });
}

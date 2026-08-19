import type { FastifyInstance } from "fastify";
import { API_V1_ROUTES } from "@atlas/shared";
import { checkSystemHealth } from "../services/health-check.js";

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async () => ({
    product: app.atlasEnv.APP_NAME,
    codename: app.atlasEnv.PRODUCT_CODENAME,
    status: "ok",
    docs: "Engineering Intelligence OS — API-first. Open /health or /api/v1/*",
    endpoints: {
      health: "/health",
      apiHealth: "/api/v1/health",
      projects: "/api/v1/projects",
      state: "/api/v1/projects/:id/state",
      githubSync: "/api/v1/github/sync",
      agent: "/api/v1/agent/runs",
    },
    mvpRoutes: API_V1_ROUTES.filter((route) => route.mvp).map(
      (route) => `${route.method} ${route.path}`,
    ),
  }));

  app.get("/favicon.ico", async (_request, reply) =>
    reply.code(204).send(),
  );

  // Cheap, no-dependency-check liveness probe: intended for load balancers /
  // orchestrators hitting this very frequently (every few seconds). It only
  // proves the process is up and answering HTTP — it deliberately does NOT
  // do a real DB round-trip on every hit, since that could add real load
  // (and, if the DB is briefly degraded, cause an infra-level restart loop
  // for what may just be a transient blip). Use /api/v1/health for the real
  // per-component rollup.
  app.get("/health", async () => ({
    status: "ok",
    product: app.atlasEnv.APP_NAME,
    codename: app.atlasEnv.PRODUCT_CODENAME,
  }));

  // Detailed health rollup: performs the real dependency checks in
  // checkSystemHealth (DB/store round-trip, AI provider configuration,
  // worker liveness — honestly reported as UNKNOWN, see health-check.ts).
  // Kept at HTTP 200 for HEALTHY/WARNING/DEGRADED so monitoring tools that
  // just parse the JSON body keep working; only CRITICAL (a dependency is
  // actually down, not just slow/misconfigured) returns 503 so simpler
  // HTTP-status-only checks (uptime pingers, basic LB health checks) also
  // pick up a hard failure without having to parse the body.
  app.get("/api/v1/health", async (_request, reply) => {
    const health = await checkSystemHealth(app);
    if (health.status === "CRITICAL") {
      reply.code(503);
    }
    return {
      status: health.status,
      version: "v1",
      components: health.components,
    };
  });
}

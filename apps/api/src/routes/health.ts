import type { FastifyInstance } from "fastify";
import { API_V1_ROUTES } from "@atlas/shared";

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

  app.get("/health", async () => ({
    status: "ok",
    product: app.atlasEnv.APP_NAME,
    codename: app.atlasEnv.PRODUCT_CODENAME,
  }));

  app.get("/api/v1/health", async () => ({
    status: "ok",
    version: "v1",
  }));
}

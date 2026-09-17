import type { FastifyInstance } from "fastify";
import { requireControlPlaneService } from "../services/governed-lifecycle-handoff.js";
import { requireUser } from "./auth-guards.js";
import { isPublicAtlasRoute, normalizeRequestPath } from "./public-routes.js";

/**
 * Production request gate used by `buildApp()`.
 *
 * ADR-021 public allow-list first. Control Plane SERVICE hops under
 * `/api/v1/internal/` authenticate with `ATLAS_CONTROL_PLANE_TOKEN` — Control
 * has no browser session, so `requireUser` must not run first. Every other
 * route still requires a signed-in user.
 */
export function isInternalControlPath(url: string): boolean {
  return normalizeRequestPath(url).startsWith("/api/v1/internal/");
}

export function registerAtlasSessionGate(app: FastifyInstance): void {
  app.addHook("onRequest", async (request) => {
    if (isPublicAtlasRoute(request.method, request.url)) return;
    if (isInternalControlPath(request.url)) {
      requireControlPlaneService(request.headers.authorization);
      return;
    }
    await requireUser(app, request);
  });
}

import type { FastifyInstance } from "fastify";
import { requireControlPlaneService } from "../services/governed-lifecycle-handoff.js";
import {
  assertCookieMutationOrigin,
  cookieCsrfRequiresOrigin,
} from "../lib/cookie-csrf.js";
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
    assertCookieMutationOrigin({
      method: request.method,
      origin: typeof request.headers.origin === "string" ? request.headers.origin : undefined,
      referer:
        typeof request.headers.referer === "string"
          ? request.headers.referer
          : typeof request.headers.referrer === "string"
            ? request.headers.referrer
            : undefined,
      cookie: typeof request.headers.cookie === "string" ? request.headers.cookie : undefined,
      authorization:
        typeof request.headers.authorization === "string"
          ? request.headers.authorization
          : undefined,
      webOrigin: app.atlasEnv.WEB_ORIGIN,
      requireOrigin: cookieCsrfRequiresOrigin(),
    });
    await requireUser(app, request);
  });
}

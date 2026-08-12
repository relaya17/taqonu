import type { FastifyInstance, FastifyRequest } from "fastify";
import { AtlasError, type AuthUser } from "@atlas/shared";
import { getRequestUser } from "../services/resolve-identity.js";

/** Session cookie / Auth JWT → user. Throws 401 if missing. */
export function requireUser(
  app: FastifyInstance,
  request: FastifyRequest,
): AuthUser {
  const user = getRequestUser(app, request);
  if (!user) {
    throw new AtlasError("UNAUTHORIZED", "Not signed in", { statusCode: 401 });
  }
  return user;
}

/** Admin role required. Throws 401/403. */
export function requireAdmin(
  app: FastifyInstance,
  request: FastifyRequest,
): AuthUser {
  const user = requireUser(app, request);
  if (user.role !== "admin") {
    throw new AtlasError("FORBIDDEN", "Admin role required", {
      statusCode: 403,
    });
  }
  return user;
}

/**
 * WRITE / mutation gates: signed-in user required.
 * Identity + roles: live Supabase Auth JWT preferred (`resolveRequestIdentity`);
 * local `atlas_session` is offline/dev fallback. Supabase RLS additionally
 * isolates cloud rows when clients use user JWTs (service-role dual-write
 * still bypasses RLS).
 */
export function requireSignedInForWrite(
  app: FastifyInstance,
  request: FastifyRequest,
): AuthUser {
  return requireUser(app, request);
}

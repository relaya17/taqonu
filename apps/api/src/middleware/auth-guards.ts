import type { FastifyInstance, FastifyRequest } from "fastify";
import { AtlasError, type AuthUser } from "@atlas/shared";
import { getRequestUser } from "../routes/auth.js";

/** Session cookie → user. Throws 401 if missing. */
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
 * Local session cookie is the source of truth for API mutations.
 * Supabase RLS additionally isolates cloud rows when migrations are applied
 * and clients use user JWTs (service-role dual-write still bypasses RLS).
 */
export function requireSignedInForWrite(
  app: FastifyInstance,
  request: FastifyRequest,
): AuthUser {
  return requireUser(app, request);
}

import type { FastifyInstance, FastifyRequest } from "fastify";
import { AtlasError, isControlPlaneRole, type AuthUser } from "@atlas/shared";
import { getRequestUser } from "../services/resolve-identity.js";

/**
 * Session cookie / Auth JWT → user. Throws 401 if missing.
 *
 * Async because, on the live-Supabase path, `getRequestUser` must round-trip
 * to Supabase Auth to verify the client-supplied access token before any
 * claim in it (identity, role) can be trusted — see
 * `services/supabase-session.ts#verifySupabaseAccessToken`. Every caller
 * must `await` this.
 */
export async function requireUser(
  app: FastifyInstance,
  request: FastifyRequest,
): Promise<AuthUser> {
  const user = await getRequestUser(app, request);
  if (!user) {
    throw new AtlasError("UNAUTHORIZED", "Not signed in", { statusCode: 401 });
  }
  return user;
}

/** Admin role required. Throws 401/403. */
export async function requireAdmin(
  app: FastifyInstance,
  request: FastifyRequest,
): Promise<AuthUser> {
  const user = await requireUser(app, request);
  if (user.role !== "admin" && !isControlPlaneRole(user.role)) {
    throw new AtlasError("FORBIDDEN", "Admin role required", {
      statusCode: 403,
    });
  }
  return user;
}

/**
 * Atlas Control Plane: owner or operator. Customer `admin` is not enough (ADR-021).
 */
export async function requireOperator(
  app: FastifyInstance,
  request: FastifyRequest,
): Promise<AuthUser> {
  const user = await requireUser(app, request);
  if (!isControlPlaneRole(user.role)) {
    throw new AtlasError(
      "FORBIDDEN",
      "Atlas operator or owner role required",
      { statusCode: 403 },
    );
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
export async function requireSignedInForWrite(
  app: FastifyInstance,
  request: FastifyRequest,
): Promise<AuthUser> {
  return requireUser(app, request);
}

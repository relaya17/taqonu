import type { FastifyInstance, FastifyRequest } from "fastify";
import { AtlasError, isControlPlaneRole, type AuthUser } from "@atlas/shared";
import { getRequestUser } from "../services/resolve-identity.js";

/**
 * Privilege / operator contract (R07 / F18). Written here because these
 * helpers are the role gates. Do not "clean up" F17/F39:
 *
 * Who is who
 * - `admin`  = customer instance admin (`CUSTOMER_ADMIN`). Tenant
 *   administration, not Atlas Control.
 * - `operator` / `owner` = Control Plane roles (`isControlPlaneRole`).
 * - `user`   = tenant-scoped customer user.
 *
 * Which gate is which
 * - `requireUser`            — authenticated. 401 if missing.
 * - `requireAdmin`           — `admin` OR operator OR owner. Broader than
 *   customer-admin alone; used for instance-wide surfaces (audit GET).
 * - `requireOperator`        — operator OR owner only. Customer `admin` 403.
 * - `requireOwner`           — owner only.
 * - `requireSignedInForWrite`— same as `requireUser`.
 *
 * Intentionally broader (do not revoke as a "fix")
 * - F17: instance-admin (`admin`) may read all owners' memories.
 * - F39: `GET /api/v1/audit` is `requireAdmin` and instance-wide (not
 *   owner-filtered). Operator/owner pass the same gate.
 * - Project read/write unscope is `admin` OR Control Plane role.
 *
 * Intentionally narrower
 * - Memory list/export unscope is `admin` only. Operator stays owner-scoped.
 *   That inconsistency with projects is F18 and is documented, not a leak.
 *
 * Tenant-scoped vs instance-wide
 * - Tenant-scoped: ordinary `requireUser` reads (memory for non-admin,
 *   project list for non-admin/non-operator).
 * - Instance-wide: memory for `admin`; projects for `admin|operator|owner`;
 *   audit GET for `requireAdmin`.
 */

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

/** Atlas Owner only. Operator is not enough. */
export async function requireOwner(
  app: FastifyInstance,
  request: FastifyRequest,
): Promise<AuthUser> {
  const user = await requireUser(app, request);
  if (user.role !== "owner") {
    throw new AtlasError("FORBIDDEN", "Atlas owner role required", {
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
export async function requireSignedInForWrite(
  app: FastifyInstance,
  request: FastifyRequest,
): Promise<AuthUser> {
  return requireUser(app, request);
}

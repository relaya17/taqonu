/**
 * ABAC-flavored access combinator: role-capability check (`capabilitiesForRole`)
 * + resource-ownership check (mirrors the admin-bypass / owner-match pattern
 * used by `assertProjectWriteAccess` in project-access.ts), fused into one
 * pure decision function.
 *
 * This module intentionally does no I/O (no fastify, no store/db access) so
 * it stays trivially unit-testable and composable: call it from a route
 * handler (or a higher-level guard) *after* `resolveRequestIdentity()` has
 * produced an actor + role, and *after* the resource's `owner_id` (or
 * equivalent) has been loaded from the store. This function does not throw —
 * callers decide how to turn a "DENIED" decision into an HTTP error (e.g. via
 * `AtlasError`), matching how `assertProjectWriteAccess` layers its own
 * `AtlasError` throw on top of the raw ownership comparison.
 */
import { capabilitiesForRole, type AuthCapability, type UserRole } from "@atlas/shared";

/** Input to `checkResourceAccess`. */
export interface ResourceAccessInput {
  /** id of the actor attempting the action (e.g. `resolveRequestIdentity().user.id`). */
  readonly actorId: string;
  /** the actor's role, as resolved by identity resolution. */
  readonly role: UserRole;
  /** capability the action requires (from `authCapabilitySchema` in auth.schema.ts). */
  readonly requiredCapability: AuthCapability;
  /**
   * owner id of the specific resource instance being acted on, or `null` when
   * the resource has no single owner (e.g. a platform-wide resource) — in
   * that case ownership is not checked and the capability check alone decides.
   */
  readonly resourceOwnerId: string | null;
}

/** Outcome of a `checkResourceAccess` call. */
export interface ResourceAccessResult {
  readonly decision: "ALLOWED" | "DENIED";
  /** human-readable reason, safe to log or surface in an audit trail. */
  readonly reason: string;
}

/**
 * Combine a role→capability check with a resource-ownership check into one
 * ABAC-flavored decision.
 *
 * Logic (mirrors `assertProjectWriteAccess` in project-access.ts):
 *  1. Resolve the role's capabilities via the real `capabilitiesForRole()`.
 *     If `requiredCapability` is not granted, DENIED — ownership is not
 *     even considered.
 *  2. If the capability check passes and `resourceOwnerId` is `null`
 *     (no single owner / platform-wide resource), ALLOWED.
 *  3. If the capability check passes and `resourceOwnerId` is non-null:
 *     - `role === "admin"` bypasses the ownership check entirely (same as
 *       `assertProjectWriteAccess`'s `if (user.role === "admin") return user;`),
 *       so ALLOWED.
 *     - otherwise `actorId` must equal `resourceOwnerId`; mismatch → DENIED.
 *
 * Pure function: no I/O, no fastify/db dependency. Intended to be called
 * from a route handler after identity resolution + resource load, e.g.:
 *
 *   const identity = resolveRequestIdentity(app, request);
 *   const ownerId = getSomeResourceOwnerId(resourceId);
 *   const result = checkResourceAccess({
 *     actorId: identity.user.id,
 *     role: identity.role,
 *     requiredCapability: "write.contract",
 *     resourceOwnerId: ownerId,
 *   });
 *   if (result.decision === "DENIED") throw new AtlasError("FORBIDDEN", result.reason, { statusCode: 403 });
 */
export function checkResourceAccess(input: ResourceAccessInput): ResourceAccessResult {
  const { actorId, role, requiredCapability, resourceOwnerId } = input;

  const grantedCapabilities = capabilitiesForRole(role);
  if (!grantedCapabilities.includes(requiredCapability)) {
    return {
      decision: "DENIED",
      reason: `role "${role}" lacks required capability "${requiredCapability}"`,
    };
  }

  if (resourceOwnerId === null) {
    return {
      decision: "ALLOWED",
      reason: `capability "${requiredCapability}" granted; resource has no single owner`,
    };
  }

  if (role === "admin") {
    return {
      decision: "ALLOWED",
      reason: `capability "${requiredCapability}" granted; admin role bypasses ownership check`,
    };
  }

  if (actorId !== resourceOwnerId) {
    return {
      decision: "DENIED",
      reason: `actor "${actorId}" does not own this resource (owner "${resourceOwnerId}")`,
    };
  }

  return {
    decision: "ALLOWED",
    reason: `capability "${requiredCapability}" granted; actor owns this resource`,
  };
}

/**
 * Small logging helper: format a `ResourceAccessResult` as a single string,
 * useful for audit-log entries (cf. `appendIsolationAudit` in
 * project-access.ts) without callers needing to know the result shape.
 */
export function explainDenial(result: ResourceAccessResult): string {
  return `[${result.decision}] ${result.reason}`;
}

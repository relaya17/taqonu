import { AtlasError } from "@atlas/shared";
import { isAllowedWebOrigin } from "./web-origin.js";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isMutatingHttpMethod(method: string): boolean {
  return MUTATING.has(method.toUpperCase());
}

export function hasBearerAuthorization(authorization: string | undefined): boolean {
  return Boolean(authorization?.toLowerCase().startsWith("bearer "));
}

export function hasAtlasSessionCookie(cookieHeader: string | undefined): boolean {
  if (!cookieHeader) return false;
  return cookieHeader.split(";").some((part) => part.trim().startsWith("atlas_session="));
}

export function originFromReferer(referer: string | undefined): string | undefined {
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}

/**
 * Cookie-session CSRF for writes (G-P1 CSRF review).
 *
 * Production cookies are SameSite=None so they travel on cross-site POSTs.
 * CORS does not stop the mutation. Bearer/HMAC hops are not cookie CSRF.
 * Missing Origin is allowed outside production so tests and local scripts
 * still work; a present disallowed Origin is always refused.
 */
export function assertCookieMutationOrigin(input: {
  readonly method: string;
  readonly origin: string | undefined;
  readonly referer: string | undefined;
  readonly cookie: string | undefined;
  readonly authorization: string | undefined;
  readonly webOrigin: string;
  readonly requireOrigin: boolean;
}): void {
  if (!isMutatingHttpMethod(input.method)) return;
  if (!hasAtlasSessionCookie(input.cookie)) return;
  if (hasBearerAuthorization(input.authorization)) return;

  const presented = input.origin ?? originFromReferer(input.referer);
  if (!presented) {
    if (!input.requireOrigin) return;
    throw new AtlasError("FORBIDDEN", "Cookie mutation requires an allowed Origin", {
      statusCode: 403,
      details: { reason: "CSRF_ORIGIN_REQUIRED" },
    });
  }
  if (!isAllowedWebOrigin(presented, input.webOrigin)) {
    throw new AtlasError("FORBIDDEN", "Cookie mutation refused from this origin", {
      statusCode: 403,
      details: { reason: "CSRF_ORIGIN_DENIED" },
    });
  }
}

export function cookieCsrfRequiresOrigin(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.ATLAS_REQUIRE_COOKIE_CSRF === "1"
  );
}

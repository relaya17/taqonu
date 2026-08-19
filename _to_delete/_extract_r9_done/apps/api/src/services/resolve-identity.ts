import type { FastifyInstance, FastifyRequest } from "fastify";
import { isLiveSupabase } from "@atlas/database";
import {
  authUserSchema,
  capabilitiesForRole,
  type AuthUser,
  type UserRole,
} from "@atlas/shared";
import {
  findUserByEmail,
  findUserById,
  mirrorAuthUserLocally,
  peekSession,
  setLocalUserRole,
  toPublicUser,
} from "./auth-store.js";
import {
  accessTokenClaimsFromMetadata,
  readAccessTokenClaims,
  type AccessTokenClaims,
} from "./identity-reconcile.js";
import {
  readSupabaseSessionCookie,
  resolveRequestSupabaseAccessToken,
  verifySupabaseAccessToken,
  type SupabaseSessionEnv,
} from "./supabase-session.js";

const LOCAL_COOKIE = "atlas_session";

export type IdentitySource = "supabase_auth" | "local_session";

export interface ResolvedIdentity {
  readonly user: AuthUser;
  readonly expiresAt: string;
  readonly role: UserRole;
  readonly capabilities: ReturnType<typeof capabilitiesForRole>;
  readonly source: IdentitySource;
}

function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  const parts = cookieHeader.split(";").map((p) => p.trim());
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx) === name) {
      return decodeURIComponent(part.slice(idx + 1));
    }
  }
  return undefined;
}

function buildUserFromAuthClaims(
  claims: AccessTokenClaims,
  role: UserRole,
): AuthUser {
  const local =
    findUserById(claims.sub) ??
    (claims.email ? findUserByEmail(claims.email) : undefined);
  if (local?.disabledAt) {
    throw new Error("ACCOUNT_DISABLED");
  }
  const email = (claims.email ?? local?.email ?? "").trim().toLowerCase();
  const provider = claims.provider ?? local?.provider ?? ("email" as const);
  const user = authUserSchema.parse({
    id: claims.sub,
    email: email || `user-${claims.sub.slice(0, 8)}@atlas.local`,
    displayName:
      claims.displayName ??
      local?.displayName ??
      (email ? email.split("@")[0] : "user"),
    role,
    locale: claims.locale ?? local?.locale ?? "he",
    provider,
    avatarUrl: claims.avatarUrl ?? local?.avatarUrl ?? null,
    createdAt: local?.createdAt ?? new Date().toISOString(),
    updatedAt: local?.updatedAt,
    emailVerified: Boolean(local?.emailVerifiedAt) || provider !== "local",
    disabled: false,
    hasPassword: Boolean(local?.passwordHash && local?.salt),
  });
  // Keep offline store warm so stub mode / Auth-down still has a row —
  // only write when missing or role/id drift.
  if (
    !local ||
    local.id !== user.id ||
    local.role !== user.role ||
    local.email !== user.email
  ) {
    mirrorAuthUserLocally({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      locale: user.locale,
      provider: user.provider,
      avatarUrl: user.avatarUrl ?? null,
    });
  }
  return user;
}

/**
 * Prefer a live Supabase access token as identity + roles source.
 *
 * `accessToken` here is client-supplied (it comes from the `atlas_sb_session`
 * cookie, readable/settable by any HTTP client, not just a browser) so it
 * MUST be authenticated against Supabase itself before any claim in it is
 * trusted — see `verifySupabaseAccessToken()`. A cheap local decode is used
 * first only to skip an obviously garbage/expired token without a network
 * round trip; that local decode is NEVER, by itself, treated as proof of
 * identity or role.
 *
 * Returns null when Auth is offline, the token is missing/malformed/expired,
 * or Supabase rejects it as invalid/forged (caller should fall back to the
 * local session).
 */
export async function resolveUserFromSupabaseAccessToken(
  env: SupabaseSessionEnv,
  accessToken: string | null | undefined,
): Promise<{ user: AuthUser; expiresAt: string } | null> {
  if (!accessToken) return null;
  // Fast, untrusted pre-check: bail out before hitting the network for
  // tokens that are not even shaped like a JWT, or that locally claim to
  // already be expired. This is purely an optimization — it can only reject
  // tokens early, never accept one; actual trust comes from the verified
  // call below.
  const localPreCheck = readAccessTokenClaims(accessToken);
  if (!localPreCheck) return null;
  if (localPreCheck.expiresAt !== null && localPreCheck.expiresAt <= Date.now()) {
    return null;
  }

  // The actual trust boundary: round-trip to Supabase Auth to confirm this
  // token is genuine (valid signature, not expired, not revoked) before
  // trusting `sub`/`app_metadata.atlas_role`/etc from it.
  const verified = await verifySupabaseAccessToken(env, accessToken);
  if (!verified) return null;

  const claims = accessTokenClaimsFromMetadata({
    sub: verified.id,
    email: verified.email,
    // Supabase's verified user object doesn't carry the token's own `exp`;
    // the locally-decoded value is fine to reuse here purely for display /
    // cookie-refresh bookkeeping, since it was already confirmed genuine by
    // the fact that `verifySupabaseAccessToken` accepted this exact token.
    expiresAt: localPreCheck.expiresAt,
    appMetadata: verified.appMetadata,
    userMetadata: verified.userMetadata,
  });

  const local = findUserById(claims.sub);
  if (local?.disabledAt) return null;
  const role: UserRole = claims.atlasRole ?? local?.role ?? "user";
  if (claims.atlasRole && local && local.role !== claims.atlasRole) {
    setLocalUserRole(claims.sub, claims.atlasRole);
  }
  try {
    const user = buildUserFromAuthClaims(claims, role);
    const expiresAt = claims.expiresAt
      ? new Date(claims.expiresAt).toISOString()
      : new Date(Date.now() + 3600_000).toISOString();
    return { user, expiresAt };
  } catch {
    return null;
  }
}

function resolveFromLocalSession(
  app: FastifyInstance,
  cookieHeader: string | undefined,
): ResolvedIdentity | null {
  const token = readCookie(cookieHeader, LOCAL_COOKIE);
  const peeked = peekSession(token, app.atlasEnv.COOKIE_SECRET);
  if (!peeked) return null;
  const stored = findUserById(peeked.userId);
  if (!stored || stored.disabledAt) return null;
  const user = toPublicUser(stored);
  return {
    user,
    expiresAt: peeked.expiresAt,
    role: user.role,
    capabilities: capabilitiesForRole(user.role),
    source: "local_session",
  };
}

/**
 * Identity resolution for guards / most routes.
 *
 * When Supabase is live and a usable `atlas_sb_session` access token is
 * present, Auth JWT (+ `app_metadata.atlas_role`) wins — but only once that
 * token has been verified against Supabase itself (`verifySupabaseAccessToken`
 * inside `resolveUserFromSupabaseAccessToken`), since it is client-supplied.
 * Otherwise the local `atlas_session` cookie is the offline/dev fallback.
 *
 * Async because the Supabase path requires a real network round trip to
 * verify the token — this is the actual trust boundary, not a decode.
 */
export async function resolveRequestIdentity(
  app: FastifyInstance,
  request: FastifyRequest,
): Promise<ResolvedIdentity | null> {
  if (
    isLiveSupabase({
      SUPABASE_URL: app.atlasEnv.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: app.atlasEnv.SUPABASE_SERVICE_ROLE_KEY,
    })
  ) {
    const sb = readSupabaseSessionCookie(request.headers.cookie);
    if (sb && sb.expiresAt - Date.now() > 0) {
      const fromAuth = await resolveUserFromSupabaseAccessToken(
        app.atlasEnv,
        sb.accessToken,
      );
      if (fromAuth) {
        return {
          user: fromAuth.user,
          expiresAt: fromAuth.expiresAt,
          role: fromAuth.user.role,
          capabilities: capabilitiesForRole(fromAuth.user.role),
          source: "supabase_auth",
        };
      }
    }
  }
  return resolveFromLocalSession(app, request.headers.cookie);
}

/**
 * Async variant for session endpoints / cloud writes: refresh a stale
 * Supabase token first, then resolve Auth-first identity.
 */
export async function resolveRequestIdentityAsync(
  app: FastifyInstance,
  request: FastifyRequest,
): Promise<{
  readonly identity: ResolvedIdentity | null;
  readonly setCookie: string | null;
  readonly accessToken: string | null;
}> {
  let setCookie: string | null = null;
  let accessToken: string | null = null;
  if (
    isLiveSupabase({
      SUPABASE_URL: app.atlasEnv.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: app.atlasEnv.SUPABASE_SERVICE_ROLE_KEY,
    })
  ) {
    const refreshed = await resolveRequestSupabaseAccessToken(
      app.atlasEnv,
      request.headers.cookie,
    );
    setCookie = refreshed.setCookie;
    accessToken = refreshed.accessToken;
    if (refreshed.accessToken) {
      const fromAuth = await resolveUserFromSupabaseAccessToken(
        app.atlasEnv,
        refreshed.accessToken,
      );
      if (fromAuth) {
        return {
          identity: {
            user: fromAuth.user,
            expiresAt: fromAuth.expiresAt,
            role: fromAuth.user.role,
            capabilities: capabilitiesForRole(fromAuth.user.role),
            source: "supabase_auth",
          },
          setCookie,
          accessToken,
        };
      }
    }
  }
  return {
    identity: resolveFromLocalSession(app, request.headers.cookie),
    setCookie,
    accessToken,
  };
}

/** Convenience: Auth-first user or null. Used by WRITE/admin guards. */
export async function getRequestUser(
  app: FastifyInstance,
  request: FastifyRequest,
): Promise<AuthUser | null> {
  return (await resolveRequestIdentity(app, request))?.user ?? null;
}

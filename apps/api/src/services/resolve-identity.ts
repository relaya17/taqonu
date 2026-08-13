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
import { readAccessTokenClaims } from "./identity-reconcile.js";
import {
  readSupabaseSessionCookie,
  resolveRequestSupabaseAccessToken,
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
  claims: NonNullable<ReturnType<typeof readAccessTokenClaims>>,
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
 * Prefer a live, non-expired Supabase access token as identity + roles source.
 * Returns null when Auth is offline, cookie missing, or token expired
 * (caller should fall back to local session).
 */
export function resolveUserFromSupabaseAccessToken(
  accessToken: string | null | undefined,
): { user: AuthUser; expiresAt: string } | null {
  if (!accessToken) return null;
  const claims = readAccessTokenClaims(accessToken);
  if (!claims) return null;
  if (claims.expiresAt !== null && claims.expiresAt <= Date.now()) return null;

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
 * Sync identity resolution for guards / most routes.
 *
 * When Supabase is live and a usable `atlas_sb_session` access token is
 * present, Auth JWT (+ `app_metadata.atlas_role`) wins. Otherwise the local
 * `atlas_session` cookie is the offline/dev fallback.
 */
export function resolveRequestIdentity(
  app: FastifyInstance,
  request: FastifyRequest,
): ResolvedIdentity | null {
  if (
    isLiveSupabase({
      SUPABASE_URL: app.atlasEnv.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: app.atlasEnv.SUPABASE_SERVICE_ROLE_KEY,
    })
  ) {
    const sb = readSupabaseSessionCookie(request.headers.cookie);
    if (sb && sb.expiresAt - Date.now() > 0) {
      const fromAuth = resolveUserFromSupabaseAccessToken(sb.accessToken);
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
      const fromAuth = resolveUserFromSupabaseAccessToken(refreshed.accessToken);
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

/** Convenience: Auth-first user or null (sync; used by WRITE/admin guards). */
export function getRequestUser(
  app: FastifyInstance,
  request: FastifyRequest,
): AuthUser | null {
  return resolveRequestIdentity(app, request)?.user ?? null;
}

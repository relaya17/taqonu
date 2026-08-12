import type { FastifyInstance } from "fastify";
import {
  AtlasError,
  authProvidersSchema,
  authSessionDetailSchema,
  authSessionStateSchema,
  capabilitiesForRole,
  loginSchema,
  registerSchema,
} from "@atlas/shared";
import { isLiveSupabase } from "@atlas/database";
import {
  createLocalUser,
  listUsers,
  rekeyLocalUserId,
  setLocalUserRole,
  signSession,
  upsertOAuthUser,
  verifyLocalPassword,
} from "../services/auth-store.js";
import { requireAdmin } from "../middleware/auth-guards.js";
import {
  finalizeIdentityReconciliation,
  readAccessTokenClaims,
  readAccessTokenSubject,
} from "../services/identity-reconcile.js";
import {
  getRequestUser,
  resolveRequestIdentityAsync,
} from "../services/resolve-identity.js";
import {
  clearSupabaseSessionCookie,
  ensureSupabaseAuthUser,
  serializeSupabaseSessionCookie,
  signInSupabaseUser,
  syncSupabaseAuthRole,
} from "../services/supabase-session.js";

export { getRequestUser };

const COOKIE = "atlas_session";
const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 14;

function sessionCookie(token: string, maxAgeSec: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

function clearCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/auth/providers", async () => {
    const cloud = isLiveSupabase({
      SUPABASE_URL: app.atlasEnv.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: app.atlasEnv.SUPABASE_SERVICE_ROLE_KEY,
    });
    return authProvidersSchema.parse({
      emailPassword: true,
      google: cloud,
      github: cloud,
      cloudAuth: cloud,
      supabaseUrl: cloud ? app.atlasEnv.SUPABASE_URL : null,
    });
  });

  /**
   * Soft session probe for web shells — 200 even when anonymous.
   * Prefer live Supabase Auth JWT for identity + roles; local session fallback.
   */
  app.get("/api/v1/auth/session", async (request, reply) => {
    const { identity, setCookie } = await resolveRequestIdentityAsync(app, request);
    if (setCookie) reply.header("Set-Cookie", setCookie);
    if (!identity) {
      return authSessionStateSchema.parse({
        authenticated: false,
        user: null,
        role: null,
        capabilities: [],
        expiresAt: null,
      });
    }
    return authSessionStateSchema.parse({
      authenticated: true,
      user: identity.user,
      role: identity.role,
      capabilities: [...identity.capabilities],
      expiresAt: identity.expiresAt,
    });
  });

  app.get("/api/v1/auth/me", async (request, reply) => {
    const { identity, setCookie } = await resolveRequestIdentityAsync(app, request);
    if (setCookie) reply.header("Set-Cookie", setCookie);
    if (!identity) {
      throw new AtlasError("UNAUTHORIZED", "Not signed in", { statusCode: 401 });
    }
    return authSessionDetailSchema.parse({
      authenticated: true,
      user: identity.user,
      role: identity.role,
      capabilities: [...identity.capabilities],
      expiresAt: identity.expiresAt,
    });
  });

  app.post("/api/v1/auth/register", async (request, reply) => {
    const body = registerSchema.parse(request.body);
    try {
      const user = createLocalUser({
        email: body.email,
        password: body.password,
        ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
        ...(body.locale !== undefined ? { locale: body.locale } : {}),
        ...(app.atlasEnv.ATLAS_ADMIN_EMAIL
          ? { adminEmail: app.atlasEnv.ATLAS_ADMIN_EMAIL }
          : {}),
      });
      const { token, expiresAt } = signSession(
        user.id,
        app.atlasEnv.COOKIE_SECRET,
        SESSION_MAX_AGE_SEC,
      );
      const cookies = [sessionCookie(token, SESSION_MAX_AGE_SEC)];
      // Mirror into Supabase Auth (same id + atlas_role) so SaaS path uses
      // Auth JWT as identity/roles source; then sign in for a real token.
      await ensureSupabaseAuthUser(app.atlasEnv, {
        id: user.id,
        email: user.email,
        password: body.password,
        role: user.role,
        displayName: user.displayName,
        locale: user.locale,
        provider: user.provider,
      });
      const sbSession = await signInSupabaseUser(app.atlasEnv, {
        email: user.email,
        password: body.password,
      });
      if (sbSession) cookies.push(serializeSupabaseSessionCookie(sbSession));
      reply.header("Set-Cookie", cookies);
      return reply.status(201).send(
        authSessionDetailSchema.parse({
          authenticated: true,
          user,
          role: user.role,
          capabilities: [...capabilitiesForRole(user.role)],
          expiresAt,
        }),
      );
    } catch (error) {
      if (error instanceof Error && error.message === "EMAIL_TAKEN") {
        throw new AtlasError("CONFLICT", "Email already registered", {
          statusCode: 409,
        });
      }
      throw error;
    }
  });

  app.post("/api/v1/auth/login", async (request, reply) => {
    const body = loginSchema.parse(request.body);
    let user = verifyLocalPassword(body.email, body.password);
    if (!user) {
      throw new AtlasError("UNAUTHORIZED", "Invalid email or password", {
        statusCode: 401,
      });
    }
    let sbSession = await signInSupabaseUser(app.atlasEnv, {
      email: user.email,
      password: body.password,
    });
    if (!sbSession) {
      // Likely a user created before Supabase went live — lazily backfill.
      await ensureSupabaseAuthUser(app.atlasEnv, {
        id: user.id,
        email: user.email,
        password: body.password,
        role: user.role,
        displayName: user.displayName,
        locale: user.locale,
        provider: user.provider,
      });
      sbSession = await signInSupabaseUser(app.atlasEnv, {
        email: user.email,
        password: body.password,
      });
    } else {
      // Keep Auth metadata + profiles.role aligned with the known local role
      // when the JWT still lacks atlas_role (pre-migration users).
      const claims = readAccessTokenClaims(sbSession.accessToken);
      const roleFromAuth = claims?.atlasRole;
      if (!roleFromAuth) {
        await syncSupabaseAuthRole(app.atlasEnv, {
          id: user.id,
          role: user.role,
          email: user.email,
          displayName: user.displayName,
          locale: user.locale,
          provider: user.provider,
          avatarUrl: user.avatarUrl ?? null,
        });
        // Re-sign so subsequent requests see atlas_role in the JWT.
        sbSession =
          (await signInSupabaseUser(app.atlasEnv, {
            email: user.email,
            password: body.password,
          })) ?? sbSession;
      } else if (roleFromAuth !== user.role) {
        // Auth wins when live — mirror onto local offline store.
        const mirrored = setLocalUserRole(user.id, roleFromAuth);
        if (mirrored) user = mirrored;
      }
    }
    // If Supabase Auth's uid drifted from the local id (e.g. prior OAuth
    // link left cloud under a different sub), adopt the token's sub.
    if (sbSession) {
      const sbSub = readAccessTokenSubject(sbSession.accessToken);
      if (sbSub && sbSub !== user.id) {
        const rekeyed = rekeyLocalUserId(user.id, sbSub);
        if (rekeyed) {
          await finalizeIdentityReconciliation({
            env: app.atlasEnv,
            fromId: user.id,
            toId: sbSub,
            password: body.password,
          });
          user = rekeyed;
          await syncSupabaseAuthRole(app.atlasEnv, {
            id: user.id,
            role: user.role,
            email: user.email,
            displayName: user.displayName,
            locale: user.locale,
            provider: user.provider,
            avatarUrl: user.avatarUrl ?? null,
          });
        }
      }
    }
    const { token, expiresAt } = signSession(
      user.id,
      app.atlasEnv.COOKIE_SECRET,
      SESSION_MAX_AGE_SEC,
    );
    const cookies = [sessionCookie(token, SESSION_MAX_AGE_SEC)];
    if (sbSession) cookies.push(serializeSupabaseSessionCookie(sbSession));
    reply.header("Set-Cookie", cookies);
    return authSessionDetailSchema.parse({
      authenticated: true,
      user,
      role: user.role,
      capabilities: [...capabilitiesForRole(user.role)],
      expiresAt,
    });
  });

  app.post("/api/v1/auth/logout", async (_request, reply) => {
    reply.header("Set-Cookie", [clearCookie(), clearSupabaseSessionCookie()]);
    return { ok: true };
  });

  /** After Supabase OAuth on the web, sync identity into local + Auth role mirror. */
  app.post("/api/v1/auth/oauth/sync", async (request, reply) => {
    const body = (request.body ?? {}) as {
      email?: string;
      displayName?: string | null;
      provider?: "google" | "github";
      avatarUrl?: string | null;
      id?: string;
      locale?: "he" | "en" | "ar";
      /** The Supabase session the browser already holds from its own OAuth round-trip. */
      accessToken?: string;
      refreshToken?: string | null;
      expiresAt?: number;
    };
    if (!body.email || !body.provider) {
      throw new AtlasError("VALIDATION_ERROR", "email and provider required");
    }
    if (body.provider !== "google" && body.provider !== "github") {
      throw new AtlasError("VALIDATION_ERROR", "provider must be google or github");
    }

    // Prefer role already on the OAuth JWT when present (Auth source of truth).
    const claims = body.accessToken
      ? readAccessTokenClaims(body.accessToken)
      : null;

    const { user, reconciledFromId } = upsertOAuthUser({
      email: body.email,
      provider: body.provider,
      ...(body.id !== undefined ? { id: body.id } : {}),
      ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
      ...(body.avatarUrl !== undefined ? { avatarUrl: body.avatarUrl } : {}),
      ...(body.locale !== undefined ? { locale: body.locale } : {}),
      ...(app.atlasEnv.ATLAS_ADMIN_EMAIL
        ? { adminEmail: app.atlasEnv.ATLAS_ADMIN_EMAIL }
        : {}),
    });

    let effectiveUser = user;
    if (claims?.atlasRole && claims.atlasRole !== user.role) {
      const mirrored = setLocalUserRole(user.id, claims.atlasRole);
      if (mirrored) effectiveUser = mirrored;
    } else {
      // Push local/bootstrap role (incl. ATLAS_ADMIN_EMAIL) into Auth + profiles.
      await syncSupabaseAuthRole(app.atlasEnv, {
        id: effectiveUser.id,
        role: effectiveUser.role,
        email: effectiveUser.email,
        displayName: effectiveUser.displayName,
        locale: effectiveUser.locale,
        provider: effectiveUser.provider,
        avatarUrl: effectiveUser.avatarUrl ?? null,
      });
    }

    // Pre-existing local users who later link OAuth: local id was rewritten
    // to the Supabase OAuth sub — rekey tenant + cloud owner_id so RLS stays
    // consistent. See AUTH_RLS.md.
    if (reconciledFromId) {
      await finalizeIdentityReconciliation({
        env: app.atlasEnv,
        fromId: reconciledFromId,
        toId: effectiveUser.id,
      });
    }
    const { token, expiresAt } = signSession(
      effectiveUser.id,
      app.atlasEnv.COOKIE_SECRET,
      SESSION_MAX_AGE_SEC,
    );
    const cookies = [sessionCookie(token, SESSION_MAX_AGE_SEC)];
    // Browser already authenticated against Supabase for OAuth — reuse that
    // session server-side so Auth JWT remains the SaaS identity source.
    if (body.accessToken) {
      cookies.push(
        serializeSupabaseSessionCookie({
          accessToken: body.accessToken,
          refreshToken: body.refreshToken ?? null,
          expiresAt: body.expiresAt ?? Date.now() + 3600_000,
        }),
      );
    }
    reply.header("Set-Cookie", cookies);
    return authSessionDetailSchema.parse({
      authenticated: true,
      user: effectiveUser,
      role: effectiveUser.role,
      capabilities: [...capabilitiesForRole(effectiveUser.role)],
      expiresAt,
    });
  });

  app.get("/api/v1/admin/users", async (request) => {
    requireAdmin(app, request);
    const users = listUsers();
    return { items: users, total: users.length };
  });

  app.get("/api/v1/admin/overview", async (request) => {
    requireAdmin(app, request);
    const users = listUsers();
    const cloudAuth = isLiveSupabase({
      SUPABASE_URL: app.atlasEnv.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: app.atlasEnv.SUPABASE_SERVICE_ROLE_KEY,
    });
    return {
      userCount: users.length,
      adminCount: users.filter((u) => u.role === "admin").length,
      providers: {
        local: users.filter((u) => u.provider === "local" || u.provider === "email")
          .length,
        google: users.filter((u) => u.provider === "google").length,
        github: users.filter((u) => u.provider === "github").length,
      },
      cloudAuth,
      authMode: cloudAuth ? "supabase_auth_preferred" : "local_session_fallback",
      rlsNote:
        "When SUPABASE_URL is live, identity + roles come from the Supabase Auth JWT (app_metadata.atlas_role) + mirrored profiles.role; local atlas_session is offline/dev fallback. WRITE/admin guards use Auth-first resolveRequestIdentity. Cloud writes use per-user access tokens (RLS auth.uid() = owner_id). OAuth link after local signup reconciles local id → Supabase sub. See packages/database/AUTH_RLS.md.",
    };
  });
}

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  AtlasError,
  adminUpdateUserSchema,
  authDeviceSessionSchema,
  authProvidersSchema,
  authSessionDetailSchema,
  authSessionStateSchema,
  capabilitiesForRole,
  changePasswordSchema,
  deleteAccountSchema,
  forgotPasswordSchema,
  loginSchema,
  mfaCodeSchema,
  mfaRequiredResponseSchema,
  mfaSetupResponseSchema,
  mfaVerifySchema,
  registerSchema,
  resetPasswordSchema,
  revokeSessionSchema,
  updateProfileSchema,
  type AuthUser,
} from "@atlas/shared";
import { isLiveSupabase } from "@atlas/database";
import {
  beginMfaSetup,
  changeLocalPassword,
  confirmMfaSetup,
  consumeMfaLoginChallenge,
  createLocalUser,
  createMfaLoginChallenge,
  deleteLocalUser,
  disableMfa,
  findUserByEmail,
  listUsers,
  peekMfaLoginChallenge,
  peekSession,
  rekeyLocalUserId,
  setLocalPasswordByEmail,
  setLocalUserRole,
  setUserDisabled,
  signSession,
  updateLocalUserProfile,
  upsertOAuthUser,
  verifyLocalPassword,
  verifyMfaLoginCode,
} from "../services/auth-store.js";
import { assertAuthRateLimit } from "../services/auth-rate-limit.js";
import {
  consumePasswordResetToken,
  createPasswordResetToken,
} from "../services/auth-reset.js";
import {
  listAuthSessionsForUser,
  revokeAllAuthSessionsForUser,
  revokeAuthSession,
  revokeOtherAuthSessions,
} from "../services/auth-sessions.js";
import { requireAdmin, requireUser } from "../middleware/auth-guards.js";
import {
  accessTokenClaimsFromMetadata,
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
  verifySupabaseAccessToken,
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

function clientMeta(request: FastifyRequest): {
  userAgent: string | null;
  ip: string | null;
} {
  const ua = request.headers["user-agent"];
  return {
    userAgent: typeof ua === "string" ? ua.slice(0, 300) : null,
    ip: request.ip ?? null,
  };
}

function rateOrThrow(key: string, limit: number, windowMs: number): void {
  try {
    assertAuthRateLimit({ key, limit, windowMs });
  } catch {
    throw new AtlasError("RATE_LIMITED", "Too many attempts — try again later", {
      statusCode: 429,
    });
  }
}

function currentSessionId(
  app: FastifyInstance,
  request: FastifyRequest,
): string | null {
  const raw = request.headers.cookie;
  if (!raw) return null;
  const parts = raw.split(";").map((p) => p.trim());
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx) !== COOKIE) continue;
    const token = decodeURIComponent(part.slice(idx + 1));
    return peekSession(token, app.atlasEnv.COOKIE_SECRET)?.sessionId ?? null;
  }
  return null;
}

/**
 * Shared tail of a successful login: Supabase Auth reconciliation (sign-in /
 * lazy-backfill / role sync / id-rekey) + local session issuance + cookies.
 * Used both by a normal (no-MFA) `/auth/login` and by `/auth/mfa/verify`
 * once the second factor has checked out, so the two paths can never drift
 * out of sync with each other.
 */
async function completeLoginSession(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  initialUser: AuthUser,
  password: string,
): Promise<ReturnType<typeof authSessionDetailSchema.parse>> {
  let user = initialUser;
  let sbSession = await signInSupabaseUser(app.atlasEnv, {
    email: user.email,
    password,
  });
  if (!sbSession) {
    // Likely a user created before Supabase went live — lazily backfill.
    await ensureSupabaseAuthUser(app.atlasEnv, {
      id: user.id,
      email: user.email,
      password,
      role: user.role,
      displayName: user.displayName,
      locale: user.locale,
      provider: user.provider,
    });
    sbSession = await signInSupabaseUser(app.atlasEnv, {
      email: user.email,
      password,
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
          password,
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
          password,
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
  const { token, expiresAt, sessionId } = signSession(
    user.id,
    app.atlasEnv.COOKIE_SECRET,
    SESSION_MAX_AGE_SEC,
    clientMeta(request),
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
    sessionId,
  });
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
      apple: cloud,
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
    rateOrThrow(`register:${request.ip}`, 8, 60_000);
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
      const { token, expiresAt, sessionId } = signSession(
        user.id,
        app.atlasEnv.COOKIE_SECRET,
        SESSION_MAX_AGE_SEC,
        clientMeta(request),
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
          sessionId,
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
    rateOrThrow(`login:${request.ip}`, 20, 60_000);
    const body = loginSchema.parse(request.body);
    const user = verifyLocalPassword(body.email, body.password);
    if (!user) {
      const existing = findUserByEmail(body.email);
      if (existing?.disabledAt) {
        throw new AtlasError("FORBIDDEN", "Account disabled", { statusCode: 403 });
      }
      throw new AtlasError("UNAUTHORIZED", "Invalid email or password", {
        statusCode: 401,
      });
    }
    if (user.mfaEnabled) {
      // Password is correct, but a second factor is still required — do NOT
      // issue a session or a Supabase-authenticated cookie yet. Hand back an
      // opaque, short-lived mfaToken that /auth/mfa/verify must present with
      // a valid TOTP/backup code before completeLoginSession runs.
      const { mfaToken } = createMfaLoginChallenge(user.id, body.password);
      return reply
        .status(200)
        .send(mfaRequiredResponseSchema.parse({ mfaRequired: true, mfaToken }));
    }
    return completeLoginSession(app, request, reply, user, body.password);
  });

  app.post("/api/v1/auth/mfa/verify", async (request, reply) => {
    const body = mfaVerifySchema.parse(request.body);
    rateOrThrow(`mfa-verify:${body.mfaToken}`, 8, 60_000);
    const pending = peekMfaLoginChallenge(body.mfaToken);
    if (!pending) {
      throw new AtlasError("UNAUTHORIZED", "MFA challenge expired or invalid", {
        statusCode: 401,
      });
    }
    const verifiedUser = await verifyMfaLoginCode(pending.userId, body.code);
    if (!verifiedUser) {
      throw new AtlasError("UNAUTHORIZED", "Invalid authentication code", {
        statusCode: 401,
      });
    }
    // Only consume (single-use) the challenge once the code has actually
    // checked out, so a wrong code doesn't burn the user's one shot at it —
    // they can retry up to the mfa-verify rate limit above.
    const consumed = consumeMfaLoginChallenge(body.mfaToken);
    if (!consumed) {
      throw new AtlasError("UNAUTHORIZED", "MFA challenge expired or invalid", {
        statusCode: 401,
      });
    }
    return completeLoginSession(app, request, reply, verifiedUser, consumed.password);
  });

  app.post("/api/v1/auth/mfa/setup", async (request) => {
    const user = await requireUser(app, request);
    rateOrThrow(`mfa-setup:${user.id}`, 5, 60_000);
    let result;
    try {
      result = beginMfaSetup(user.id);
    } catch (error) {
      if (error instanceof Error && error.message === "MFA_ALREADY_ENABLED") {
        throw new AtlasError(
          "CONFLICT",
          "MFA is already enabled — disable it (with a valid code) before setting up a new device",
          { statusCode: 409 },
        );
      }
      throw error;
    }
    if (!result) {
      throw new AtlasError("NOT_FOUND", "User not found", { statusCode: 404 });
    }
    return mfaSetupResponseSchema.parse(result);
  });

  app.post("/api/v1/auth/mfa/confirm", async (request) => {
    const user = await requireUser(app, request);
    rateOrThrow(`mfa-confirm:${user.id}`, 8, 60_000);
    const body = mfaCodeSchema.parse(request.body);
    const updated = await confirmMfaSetup(user.id, body.code);
    if (!updated) {
      throw new AtlasError("UNAUTHORIZED", "Invalid or expired code", {
        statusCode: 401,
      });
    }
    return { ok: true, user: updated };
  });

  app.post("/api/v1/auth/mfa/disable", async (request) => {
    const user = await requireUser(app, request);
    rateOrThrow(`mfa-disable:${user.id}`, 8, 60_000);
    const body = mfaCodeSchema.parse(request.body);
    const updated = await disableMfa(user.id, body.code);
    if (!updated) {
      throw new AtlasError("UNAUTHORIZED", "Invalid authentication code", {
        statusCode: 401,
      });
    }
    return { ok: true, user: updated };
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
      provider?: "google" | "github" | "apple";
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
    if (
      body.provider !== "google" &&
      body.provider !== "github" &&
      body.provider !== "apple"
    ) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        "provider must be google, github, or apple",
      );
    }

    // Prefer role already on the OAuth JWT when present (Auth source of
    // truth) — but `body.accessToken` is raw, client-supplied request-body
    // input (not a token this process obtained from Supabase itself), so an
    // unverified local decode (`readAccessTokenClaims`) is NOT safe to trust
    // for a role claim here: any HTTP client could forge a token with
    // `app_metadata.atlas_role: "admin"`. Round-trip it through Supabase Auth
    // via `verifySupabaseAccessToken` first — only a claim backed by that
    // verified response is trusted. See `supabase-session.ts`'s doc comment.
    const verifiedAccessTokenUser = body.accessToken
      ? await verifySupabaseAccessToken(app.atlasEnv, body.accessToken)
      : null;
    const claims = verifiedAccessTokenUser
      ? accessTokenClaimsFromMetadata({
          sub: verifiedAccessTokenUser.id,
          email: verifiedAccessTokenUser.email,
          expiresAt: null,
          appMetadata: verifiedAccessTokenUser.appMetadata,
          userMetadata: verifiedAccessTokenUser.userMetadata,
        })
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
    // Also require the verified token's own subject to match the user this
    // sync is for — a verified-but-genuine token for a *different* account
    // must never be used to elevate this one.
    if (
      claims?.atlasRole &&
      claims.sub === user.id &&
      claims.atlasRole !== user.role
    ) {
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
    const { token, expiresAt, sessionId } = signSession(
      effectiveUser.id,
      app.atlasEnv.COOKIE_SECRET,
      SESSION_MAX_AGE_SEC,
      clientMeta(request),
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
      sessionId,
    });
  });

  app.patch("/api/v1/auth/profile", async (request) => {
    const user = await requireUser(app, request);
    const body = updateProfileSchema.parse(request.body ?? {});
    const updated = updateLocalUserProfile(user.id, {
      ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
      ...(body.locale !== undefined ? { locale: body.locale } : {}),
      ...(body.avatarUrl !== undefined ? { avatarUrl: body.avatarUrl } : {}),
    });
    if (!updated) {
      throw new AtlasError("NOT_FOUND", "User not found", { statusCode: 404 });
    }
    await syncSupabaseAuthRole(app.atlasEnv, {
      id: updated.id,
      role: updated.role,
      email: updated.email,
      displayName: updated.displayName,
      locale: updated.locale,
      provider: updated.provider,
      avatarUrl: updated.avatarUrl ?? null,
    });
    return { user: updated };
  });

  app.post("/api/v1/auth/password/change", async (request) => {
    const user = await requireUser(app, request);
    rateOrThrow(`pwchange:${user.id}`, 8, 60_000);
    const body = changePasswordSchema.parse(request.body);
    const updated = changeLocalPassword(
      user.id,
      body.currentPassword,
      body.newPassword,
    );
    if (!updated) {
      throw new AtlasError("UNAUTHORIZED", "Current password incorrect", {
        statusCode: 401,
      });
    }
    await ensureSupabaseAuthUser(app.atlasEnv, {
      id: updated.id,
      email: updated.email,
      password: body.newPassword,
      role: updated.role,
      displayName: updated.displayName,
      locale: updated.locale,
      provider: updated.provider,
    });
    return { ok: true, user: updated };
  });

  app.post("/api/v1/auth/password/forgot", async (request) => {
    rateOrThrow(`forgot:${request.ip}`, 8, 60_000);
    const body = forgotPasswordSchema.parse(request.body);
    const existing = findUserByEmail(body.email);
    // Always opaque success to avoid account enumeration.
    const base = {
      ok: true as const,
      message: "If that email exists, a reset token was issued.",
    };
    if (!existing || existing.disabledAt) return base;
    const { token, expiresAt } = createPasswordResetToken(existing.email);
    const expose =
      process.env.NODE_ENV !== "production" ||
      process.env.ATLAS_EXPOSE_RESET_TOKEN === "1";
    return expose
      ? { ...base, resetToken: token, expiresAt, email: existing.email }
      : base;
  });

  app.post("/api/v1/auth/password/reset", async (request, reply) => {
    rateOrThrow(`reset:${request.ip}`, 10, 60_000);
    const body = resetPasswordSchema.parse(request.body);
    const consumed = consumePasswordResetToken(body.token);
    if (!consumed) {
      throw new AtlasError("UNAUTHORIZED", "Invalid or expired reset token", {
        statusCode: 401,
      });
    }
    const updated = setLocalPasswordByEmail(consumed.email, body.newPassword);
    if (!updated) {
      throw new AtlasError("NOT_FOUND", "User not found", { statusCode: 404 });
    }
    revokeAllAuthSessionsForUser(updated.id);
    await ensureSupabaseAuthUser(app.atlasEnv, {
      id: updated.id,
      email: updated.email,
      password: body.newPassword,
      role: updated.role,
      displayName: updated.displayName,
      locale: updated.locale,
      provider: updated.provider,
    });
    const { token, expiresAt, sessionId } = signSession(
      updated.id,
      app.atlasEnv.COOKIE_SECRET,
      SESSION_MAX_AGE_SEC,
      clientMeta(request),
    );
    const cookies = [sessionCookie(token, SESSION_MAX_AGE_SEC)];
    const sbSession = await signInSupabaseUser(app.atlasEnv, {
      email: updated.email,
      password: body.newPassword,
    });
    if (sbSession) cookies.push(serializeSupabaseSessionCookie(sbSession));
    reply.header("Set-Cookie", cookies);
    return authSessionDetailSchema.parse({
      authenticated: true,
      user: updated,
      role: updated.role,
      capabilities: [...capabilitiesForRole(updated.role)],
      expiresAt,
      sessionId,
    });
  });

  app.get("/api/v1/auth/sessions", async (request) => {
    const user = await requireUser(app, request);
    const current = currentSessionId(app, request);
    const items = listAuthSessionsForUser(user.id).map((s) =>
      authDeviceSessionSchema.parse({
        id: s.id,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        expiresAt: s.expiresAt,
        userAgent: s.userAgent,
        ip: s.ip,
        current: current === s.id,
      }),
    );
    return { items, total: items.length, currentSessionId: current };
  });

  app.post("/api/v1/auth/sessions/revoke", async (request) => {
    const user = await requireUser(app, request);
    const body = revokeSessionSchema.parse(request.body);
    const ok = revokeAuthSession(user.id, body.sessionId);
    if (!ok) {
      throw new AtlasError("NOT_FOUND", "Session not found", { statusCode: 404 });
    }
    return { ok: true };
  });

  app.post("/api/v1/auth/sessions/revoke-others", async (request) => {
    const user = await requireUser(app, request);
    const current = currentSessionId(app, request);
    const revoked = revokeOtherAuthSessions(user.id, current);
    return { ok: true, revoked };
  });

  app.delete("/api/v1/auth/account", async (request, reply) => {
    const user = await requireUser(app, request);
    rateOrThrow(`delete:${user.id}`, 5, 60_000);
    const body = deleteAccountSchema.parse(request.body ?? {});
    if (user.hasPassword) {
      if (!body.password || !verifyLocalPassword(user.email, body.password)) {
        throw new AtlasError("UNAUTHORIZED", "Password required to delete account", {
          statusCode: 401,
        });
      }
    } else if (
      !body.confirmEmail ||
      body.confirmEmail.trim().toLowerCase() !== user.email
    ) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        "confirmEmail must match your account email",
      );
    }
    revokeAllAuthSessionsForUser(user.id);
    deleteLocalUser(user.id);
    reply.header("Set-Cookie", [clearCookie(), clearSupabaseSessionCookie()]);
    return { ok: true };
  });

  app.get("/api/v1/admin/users", async (request) => {
    await requireAdmin(app, request);
    const users = listUsers();
    return { items: users, total: users.length };
  });

  app.patch("/api/v1/admin/users/:id", async (request) => {
    const admin = await requireAdmin(app, request);
    const { id } = request.params as { id: string };
    const body = adminUpdateUserSchema.parse(request.body ?? {});
    if (id === admin.id && body.disabled === true) {
      throw new AtlasError("VALIDATION_ERROR", "Cannot disable your own admin account");
    }
    if (id === admin.id && body.role === "user") {
      throw new AtlasError("VALIDATION_ERROR", "Cannot demote your own admin account");
    }
    let updated = listUsers().find((u) => u.id === id) ?? null;
    if (!updated) {
      throw new AtlasError("NOT_FOUND", "User not found", { statusCode: 404 });
    }
    if (body.role !== undefined) {
      // MFA-for-admin policy (P1 audit finding): the admin role can only be
      // GRANTED to an account that already has MFA enabled. This is the one
      // control point we gate on — it covers every way a human operator can
      // hand out admin via this API. We deliberately do NOT also gate the
      // Auth-JWT role-mirroring paths in resolve-identity.ts / the login
      // handler's "Auth wins" branch: when Supabase Auth is live it is the
      // documented source of truth for roles (see AUTH_RLS.md), and refusing
      // to mirror its verdict locally would just desync local state from the
      // JWT without actually blocking access (the JWT's role still applies
      // to the request). Bootstrap admin (first user / ATLAS_ADMIN_EMAIL) is
      // also exempt for the same reason every other auth system exempts
      // bootstrap: nobody exists yet to have set MFA up.
      if (body.role === "admin" && updated.role !== "admin" && !updated.mfaEnabled) {
        throw new AtlasError(
          "VALIDATION_ERROR",
          "User must enable MFA (POST /auth/mfa/setup + /auth/mfa/confirm) before being granted the admin role",
        );
      }
      updated = setLocalUserRole(id, body.role) ?? updated;
      await syncSupabaseAuthRole(app.atlasEnv, {
        id: updated.id,
        role: updated.role,
        email: updated.email,
        displayName: updated.displayName,
        locale: updated.locale,
        provider: updated.provider,
        avatarUrl: updated.avatarUrl ?? null,
      });
    }
    if (body.disabled !== undefined) {
      updated = setUserDisabled(id, body.disabled) ?? updated;
      if (body.disabled) revokeAllAuthSessionsForUser(id);
    }
    return { user: updated };
  });

  app.delete("/api/v1/admin/users/:id", async (request) => {
    const admin = await requireAdmin(app, request);
    const { id } = request.params as { id: string };
    if (id === admin.id) {
      throw new AtlasError("VALIDATION_ERROR", "Cannot delete your own admin account");
    }
    revokeAllAuthSessionsForUser(id);
    const ok = deleteLocalUser(id);
    if (!ok) {
      throw new AtlasError("NOT_FOUND", "User not found", { statusCode: 404 });
    }
    return { ok: true };
  });

  app.get("/api/v1/admin/overview", async (request) => {
    await requireAdmin(app, request);
    const users = listUsers();
    const cloudAuth = isLiveSupabase({
      SUPABASE_URL: app.atlasEnv.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: app.atlasEnv.SUPABASE_SERVICE_ROLE_KEY,
    });
    return {
      userCount: users.length,
      adminCount: users.filter((u) => u.role === "admin").length,
      // Defense-in-depth visibility for the MFA-for-admin policy enforced in
      // PATCH /admin/users/:id: admins promoted before this policy existed
      // (or mirrored in from a live Auth JWT — see the comment there) can
      // still be without MFA. Surfaced here rather than a blocking gate on
      // every admin request, since requireAdmin (middleware/auth-guards.ts)
      // is out of scope for this change.
      adminsWithoutMfa: users.filter((u) => u.role === "admin" && !u.mfaEnabled).length,
      providers: {
        local: users.filter((u) => u.provider === "local" || u.provider === "email")
          .length,
        google: users.filter((u) => u.provider === "google").length,
        github: users.filter((u) => u.provider === "github").length,
        apple: users.filter((u) => u.provider === "apple").length,
      },
      cloudAuth,
      authMode: cloudAuth ? "supabase_auth_preferred" : "local_session_fallback",
      rlsNote:
        "When SUPABASE_URL is live, identity + roles come from the Supabase Auth JWT (app_metadata.atlas_role) + mirrored profiles.role; local atlas_session is offline/dev fallback. WRITE/admin guards use Auth-first resolveRequestIdentity. Cloud writes use per-user access tokens (RLS auth.uid() = owner_id). OAuth link after local signup reconciles local id → Supabase sub. See packages/database/AUTH_RLS.md.",
    };
  });
}

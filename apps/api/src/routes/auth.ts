import type { FastifyInstance, FastifyRequest } from "fastify";
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
  findUserById,
  listUsers,
  peekSession,
  signSession,
  toPublicUser,
  upsertOAuthUser,
  verifyLocalPassword,
} from "../services/auth-store.js";
import { requireAdmin } from "../middleware/auth-guards.js";

const COOKIE = "atlas_session";
const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 14;

function readCookie(request: FastifyRequest, name: string): string | undefined {
  const raw = request.headers.cookie;
  if (!raw) return undefined;
  const parts = raw.split(";").map((p) => p.trim());
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx) === name) {
      return decodeURIComponent(part.slice(idx + 1));
    }
  }
  return undefined;
}

function sessionCookie(token: string, maxAgeSec: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

function clearCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function getRequestUser(app: FastifyInstance, request: FastifyRequest) {
  const token = readCookie(request, COOKIE);
  const peeked = peekSession(token, app.atlasEnv.COOKIE_SECRET);
  if (!peeked) return null;
  const stored = findUserById(peeked.userId);
  return stored ? toPublicUser(stored) : null;
}

function getRequestSession(app: FastifyInstance, request: FastifyRequest) {
  const token = readCookie(request, COOKIE);
  const peeked = peekSession(token, app.atlasEnv.COOKIE_SECRET);
  if (!peeked) return null;
  const stored = findUserById(peeked.userId);
  if (!stored) return null;
  const user = toPublicUser(stored);
  return {
    user,
    expiresAt: peeked.expiresAt,
    role: user.role,
    capabilities: capabilitiesForRole(user.role),
  };
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
   * Returns role + capabilities used by UI gates.
   */
  app.get("/api/v1/auth/session", async (request) => {
    const session = getRequestSession(app, request);
    if (!session) {
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
      user: session.user,
      role: session.role,
      capabilities: [...session.capabilities],
      expiresAt: session.expiresAt,
    });
  });

  app.get("/api/v1/auth/me", async (request) => {
    const session = getRequestSession(app, request);
    if (!session) {
      throw new AtlasError("UNAUTHORIZED", "Not signed in", { statusCode: 401 });
    }
    return authSessionDetailSchema.parse({
      authenticated: true,
      user: session.user,
      role: session.role,
      capabilities: [...session.capabilities],
      expiresAt: session.expiresAt,
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
      reply.header("Set-Cookie", sessionCookie(token, SESSION_MAX_AGE_SEC));
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
    const user = verifyLocalPassword(body.email, body.password);
    if (!user) {
      throw new AtlasError("UNAUTHORIZED", "Invalid email or password", {
        statusCode: 401,
      });
    }
    const { token, expiresAt } = signSession(
      user.id,
      app.atlasEnv.COOKIE_SECRET,
      SESSION_MAX_AGE_SEC,
    );
    reply.header("Set-Cookie", sessionCookie(token, SESSION_MAX_AGE_SEC));
    return authSessionDetailSchema.parse({
      authenticated: true,
      user,
      role: user.role,
      capabilities: [...capabilitiesForRole(user.role)],
      expiresAt,
    });
  });

  app.post("/api/v1/auth/logout", async (_request, reply) => {
    reply.header("Set-Cookie", clearCookie());
    return { ok: true };
  });

  /** After Supabase OAuth on the web, sync identity into local session cookie. */
  app.post("/api/v1/auth/oauth/sync", async (request, reply) => {
    const body = (request.body ?? {}) as {
      email?: string;
      displayName?: string | null;
      provider?: "google" | "github";
      avatarUrl?: string | null;
      id?: string;
      locale?: "he" | "en" | "ar";
    };
    if (!body.email || !body.provider) {
      throw new AtlasError("VALIDATION_ERROR", "email and provider required");
    }
    if (body.provider !== "google" && body.provider !== "github") {
      throw new AtlasError("VALIDATION_ERROR", "provider must be google or github");
    }
    const user = upsertOAuthUser({
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
    const { token, expiresAt } = signSession(
      user.id,
      app.atlasEnv.COOKIE_SECRET,
      SESSION_MAX_AGE_SEC,
    );
    reply.header("Set-Cookie", sessionCookie(token, SESSION_MAX_AGE_SEC));
    return authSessionDetailSchema.parse({
      authenticated: true,
      user,
      role: user.role,
      capabilities: [...capabilitiesForRole(user.role)],
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
    return {
      userCount: users.length,
      adminCount: users.filter((u) => u.role === "admin").length,
      providers: {
        local: users.filter((u) => u.provider === "local" || u.provider === "email")
          .length,
        google: users.filter((u) => u.provider === "google").length,
        github: users.filter((u) => u.provider === "github").length,
      },
      cloudAuth: isLiveSupabase({
        SUPABASE_URL: app.atlasEnv.SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: app.atlasEnv.SUPABASE_SERVICE_ROLE_KEY,
      }),
      authMode: "local_session_enforced",
      rlsNote:
        "Supabase RLS ready when SUPABASE_URL is live and migrations applied; API enforces session + role locally. See packages/database/AUTH_RLS.md.",
    };
  });
}

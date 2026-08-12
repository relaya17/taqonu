import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  createLocalUser,
  findUserById,
  signSession,
} from "./auth-store.js";
import { serializeSupabaseSessionCookie } from "./supabase-session.js";
import {
  getRequestUser,
  resolveRequestIdentity,
  resolveUserFromSupabaseAccessToken,
} from "./resolve-identity.js";

const authDir = mkdtempSync(join(tmpdir(), "atlas-auth-resolve-"));
const authPath = join(authDir, "users.json");

beforeAll(() => {
  process.env.ATLAS_AUTH_PATH = authPath;
});

afterAll(() => {
  delete process.env.ATLAS_AUTH_PATH;
  rmSync(authDir, { recursive: true, force: true });
});

beforeEach(() => {
  mkdirSync(authDir, { recursive: true });
  writeFileSync(authPath, JSON.stringify({ users: [] }), "utf8");
});

function fakeJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
    "base64url",
  );
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${payload}.sig`;
}

function liveEnv() {
  return {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "live-service-role-key-longer-than-twenty",
    COOKIE_SECRET: "test-cookie-secret-at-least-32-chars!!",
  };
}

function stubEnv() {
  return {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "replace-me",
    COOKIE_SECRET: "test-cookie-secret-at-least-32-chars!!",
  };
}

describe("resolveUserFromSupabaseAccessToken", () => {
  it("builds AuthUser from JWT atlas_role (Auth source of truth)", () => {
    const sub = "11111111-1111-4111-8111-111111111111";
    const token = fakeJwt({
      sub,
      email: "admin@example.com",
      exp: Math.floor(Date.now() / 1000) + 3600,
      app_metadata: { atlas_role: "admin", provider: "email" },
      user_metadata: { full_name: "Admin", locale: "en" },
    });
    const resolved = resolveUserFromSupabaseAccessToken(token);
    expect(resolved?.user).toMatchObject({
      id: sub,
      email: "admin@example.com",
      role: "admin",
      displayName: "Admin",
      locale: "en",
    });
    // Offline mirror kept warm
    expect(findUserById(sub)?.role).toBe("admin");
  });

  it("falls back to local mirror role when JWT lacks atlas_role", () => {
    const local = createLocalUser({
      email: "user@example.com",
      password: "correct-horse-battery",
    });
    // First user is admin in empty store
    expect(local.role).toBe("admin");
    const token = fakeJwt({
      sub: local.id,
      email: local.email,
      exp: Math.floor(Date.now() / 1000) + 3600,
      app_metadata: {},
    });
    const resolved = resolveUserFromSupabaseAccessToken(token);
    expect(resolved?.user.role).toBe("admin");
  });

  it("returns null for expired tokens", () => {
    const token = fakeJwt({
      sub: "11111111-1111-4111-8111-111111111111",
      email: "x@example.com",
      exp: Math.floor(Date.now() / 1000) - 10,
      app_metadata: { atlas_role: "user" },
    });
    expect(resolveUserFromSupabaseAccessToken(token)).toBeNull();
  });
});

describe("resolveRequestIdentity preference", () => {
  it("prefers live Supabase JWT over local session when both present", () => {
    const local = createLocalUser({
      email: "dual@example.com",
      password: "correct-horse-battery",
    });
    // Local would be admin (first user); Auth JWT says user.
    const authSub = local.id;
    const accessToken = fakeJwt({
      sub: authSub,
      email: local.email,
      exp: Math.floor(Date.now() / 1000) + 3600,
      app_metadata: { atlas_role: "user", provider: "github" },
      user_metadata: { full_name: "From Auth" },
    });
    const { token: localToken } = signSession(local.id, liveEnv().COOKIE_SECRET);
    const sbCookie = serializeSupabaseSessionCookie({
      accessToken,
      refreshToken: null,
      expiresAt: Date.now() + 3600_000,
    });
    const [sbPair] = sbCookie.split(";");
    const cookieHeader = `atlas_session=${encodeURIComponent(localToken)}; ${sbPair}`;

    const app = { atlasEnv: liveEnv() } as unknown as FastifyInstance;
    const request = {
      headers: { cookie: cookieHeader },
    } as unknown as FastifyRequest;

    const identity = resolveRequestIdentity(app, request);
    expect(identity?.source).toBe("supabase_auth");
    expect(identity?.user.role).toBe("user");
    expect(identity?.user.displayName).toBe("From Auth");
    expect(getRequestUser(app, request)?.role).toBe("user");
  });

  it("uses local session when Supabase is not live (stub mode)", () => {
    const local = createLocalUser({
      email: "stub@example.com",
      password: "correct-horse-battery",
    });
    const { token: localToken } = signSession(local.id, stubEnv().COOKIE_SECRET);
    const app = { atlasEnv: stubEnv() } as unknown as FastifyInstance;
    const request = {
      headers: { cookie: `atlas_session=${encodeURIComponent(localToken)}` },
    } as unknown as FastifyRequest;

    const identity = resolveRequestIdentity(app, request);
    expect(identity?.source).toBe("local_session");
    expect(identity?.user.id).toBe(local.id);
    expect(identity?.user.role).toBe("admin");
  });

  it("falls back to local session when live but no sb cookie", () => {
    const local = createLocalUser({
      email: "fallback@example.com",
      password: "correct-horse-battery",
    });
    const { token: localToken } = signSession(local.id, liveEnv().COOKIE_SECRET);
    const app = { atlasEnv: liveEnv() } as unknown as FastifyInstance;
    const request = {
      headers: { cookie: `atlas_session=${encodeURIComponent(localToken)}` },
    } as unknown as FastifyRequest;

    const identity = resolveRequestIdentity(app, request);
    expect(identity?.source).toBe("local_session");
    expect(identity?.user.id).toBe(local.id);
  });
});

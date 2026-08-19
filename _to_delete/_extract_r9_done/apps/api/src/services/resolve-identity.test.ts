import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  createLocalUser,
  findUserById,
  signSession,
} from "./auth-store.js";
import { serializeSupabaseSessionCookie } from "./supabase-session.js";

/**
 * `resolveUserFromSupabaseAccessToken` / `resolveRequestIdentity` now treat
 * Supabase's own `auth.getUser(accessToken)` round trip as the real trust
 * boundary for any client-supplied access token (see
 * `services/supabase-session.ts#verifySupabaseAccessToken`). Mock
 * `@atlas/database`'s `createDatabaseClients` so we can control exactly what
 * that round trip returns per test, without a real network call — this
 * mirrors the shape `packages/database/src/client.ts#createDatabaseClients`
 * hands back (`{ anon, service }`, each a real `@supabase/supabase-js`
 * client with an `auth.getUser` method).
 */
const authGetUser = vi.fn();

vi.mock("@atlas/database", async () => {
  const actual =
    await vi.importActual<typeof import("@atlas/database")>("@atlas/database");
  return {
    ...actual,
    createDatabaseClients: () => ({
      anon: { auth: { getUser: authGetUser } },
      service: { auth: { getUser: authGetUser } },
    }),
  };
});

const {
  getRequestUser,
  resolveRequestIdentity,
  resolveUserFromSupabaseAccessToken,
} = await import("./resolve-identity.js");

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
  authGetUser.mockReset();
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

/**
 * Configure the mocked `auth.getUser` to respond the way real Supabase Auth
 * would for a *genuine* access token whose payload happens to match
 * `claims` — i.e. simulates "this exact token is authentic and belongs to
 * this user."
 */
function mockGenuineToken(claims: {
  sub: string;
  email?: string | null;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
}) {
  authGetUser.mockResolvedValue({
    data: {
      user: {
        id: claims.sub,
        email: claims.email ?? null,
        app_metadata: claims.app_metadata ?? {},
        user_metadata: claims.user_metadata ?? {},
      },
    },
    error: null,
  });
}

/**
 * Configure the mocked `auth.getUser` to respond the way real Supabase Auth
 * would for a token it cannot verify (bad signature, expired, revoked,
 * or simply made up) — an error, no user.
 */
function mockRejectedToken() {
  authGetUser.mockResolvedValue({
    data: { user: null },
    error: { message: "invalid JWT: signature is invalid", status: 401 },
  });
}

describe("resolveUserFromSupabaseAccessToken", () => {
  it("REJECTS a forged token — attacker-chosen sub/atlas_role, no valid Supabase signature", async () => {
    // Shaped exactly like a real Supabase JWT (so the cheap local shape/exp
    // pre-check passes) but Supabase itself would reject it outright since
    // nothing about the process ever proved this token was signed by
    // Supabase Auth — this is the exact forged-cookie attack the CVE
    // describes: attacker sets `Cookie: atlas_sb_session=...` with a
    // self-crafted access token claiming admin.
    const forgedAdminSub = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const forgedToken = fakeJwt({
      sub: forgedAdminSub,
      email: "attacker@evil.example",
      exp: Math.floor(Date.now() / 1000) + 3600,
      app_metadata: { atlas_role: "admin", provider: "email" },
    });
    mockRejectedToken();

    const resolved = await resolveUserFromSupabaseAccessToken(liveEnv(), forgedToken);

    expect(resolved).toBeNull();
    // The forged sub must never be mirrored into the local store as admin —
    // confirms the claims were never trusted, not just that the top-level
    // return value happened to be null.
    expect(findUserById(forgedAdminSub)).toBeUndefined();
    expect(authGetUser).toHaveBeenCalledWith(forgedToken);
  });

  it("REJECTS when Supabase's verified identity disagrees with the locally-decoded sub (defense in depth)", async () => {
    // Even if `auth.getUser` somehow returned success, this documents that
    // the accepted path only ever trusts the verified response's own `id`
    // — the whole point of not trusting the local JWT decode. Simulate a
    // token that decodes locally to one sub while Supabase reports a
    // different (real) one; the resolved identity must reflect Supabase's
    // answer, never the locally-decoded value.
    const localSub = "11111111-1111-4111-8111-111111111111";
    const realSub = "22222222-2222-4222-8222-222222222222";
    const token = fakeJwt({
      sub: localSub,
      exp: Math.floor(Date.now() / 1000) + 3600,
      app_metadata: { atlas_role: "admin" },
    });
    mockGenuineToken({ sub: realSub, email: "real@example.com" });

    const resolved = await resolveUserFromSupabaseAccessToken(liveEnv(), token);
    expect(resolved?.user.id).toBe(realSub);
    expect(resolved?.user.id).not.toBe(localSub);
  });

  it("ACCEPTS a token Supabase verifies as genuine and builds AuthUser from atlas_role (Auth source of truth)", async () => {
    const sub = "11111111-1111-4111-8111-111111111111";
    const token = fakeJwt({
      sub,
      email: "admin@example.com",
      exp: Math.floor(Date.now() / 1000) + 3600,
      app_metadata: { atlas_role: "admin", provider: "email" },
      user_metadata: { full_name: "Admin", locale: "en" },
    });
    mockGenuineToken({
      sub,
      email: "admin@example.com",
      app_metadata: { atlas_role: "admin", provider: "email" },
      user_metadata: { full_name: "Admin", locale: "en" },
    });

    const resolved = await resolveUserFromSupabaseAccessToken(liveEnv(), token);
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

  it("falls back to local mirror role when the verified user lacks atlas_role", async () => {
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
    mockGenuineToken({ sub: local.id, email: local.email, app_metadata: {} });

    const resolved = await resolveUserFromSupabaseAccessToken(liveEnv(), token);
    expect(resolved?.user.role).toBe("admin");
  });

  it("returns null for locally-expired tokens without ever calling Supabase", async () => {
    const token = fakeJwt({
      sub: "11111111-1111-4111-8111-111111111111",
      email: "x@example.com",
      exp: Math.floor(Date.now() / 1000) - 10,
      app_metadata: { atlas_role: "user" },
    });
    expect(await resolveUserFromSupabaseAccessToken(liveEnv(), token)).toBeNull();
    expect(authGetUser).not.toHaveBeenCalled();
  });

  it("returns null for a token that isn't even JWT-shaped, without calling Supabase", async () => {
    expect(await resolveUserFromSupabaseAccessToken(liveEnv(), "not-a-jwt")).toBeNull();
    expect(authGetUser).not.toHaveBeenCalled();
  });
});

describe("resolveRequestIdentity preference", () => {
  it("prefers a Supabase-verified JWT over local session when both present", async () => {
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
    mockGenuineToken({
      sub: authSub,
      email: local.email,
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

    const identity = await resolveRequestIdentity(app, request);
    expect(identity?.source).toBe("supabase_auth");
    expect(identity?.user.role).toBe("user");
    expect(identity?.user.displayName).toBe("From Auth");
    expect((await getRequestUser(app, request))?.role).toBe("user");
  });

  it("falls back to local session when the cookie's access token fails Supabase verification (forged)", async () => {
    // Bootstrap admin (first user in an empty store) is admin by design —
    // create a throwaway first user so `local` below is a genuine non-admin
    // account, keeping this test about the forged-token rejection rather
    // than the unrelated bootstrap-admin rule.
    createLocalUser({
      email: "bootstrap-admin@example.com",
      password: "correct-horse-battery",
    });
    const local = createLocalUser({
      email: "forged-cookie@example.com",
      password: "correct-horse-battery",
    });
    expect(local.role).toBe("user");
    const forgedToken = fakeJwt({
      sub: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      exp: Math.floor(Date.now() / 1000) + 3600,
      app_metadata: { atlas_role: "admin" },
    });
    mockRejectedToken();
    const { token: localToken } = signSession(local.id, liveEnv().COOKIE_SECRET);
    const sbCookie = serializeSupabaseSessionCookie({
      accessToken: forgedToken,
      refreshToken: null,
      expiresAt: Date.now() + 3600_000,
    });
    const [sbPair] = sbCookie.split(";");
    const cookieHeader = `atlas_session=${encodeURIComponent(localToken)}; ${sbPair}`;

    const app = { atlasEnv: liveEnv() } as unknown as FastifyInstance;
    const request = {
      headers: { cookie: cookieHeader },
    } as unknown as FastifyRequest;

    const identity = await resolveRequestIdentity(app, request);
    // Never trusts the forged admin claim — falls back to the real local
    // session's own (non-admin) role instead of granting admin.
    expect(identity?.source).toBe("local_session");
    expect(identity?.user.id).toBe(local.id);
    expect(identity?.user.role).not.toBe("admin");
  });

  it("uses local session when Supabase is not live (stub mode)", async () => {
    const local = createLocalUser({
      email: "stub@example.com",
      password: "correct-horse-battery",
    });
    const { token: localToken } = signSession(local.id, stubEnv().COOKIE_SECRET);
    const app = { atlasEnv: stubEnv() } as unknown as FastifyInstance;
    const request = {
      headers: { cookie: `atlas_session=${encodeURIComponent(localToken)}` },
    } as unknown as FastifyRequest;

    const identity = await resolveRequestIdentity(app, request);
    expect(identity?.source).toBe("local_session");
    expect(identity?.user.id).toBe(local.id);
    expect(identity?.user.role).toBe("admin");
    expect(authGetUser).not.toHaveBeenCalled();
  });

  it("falls back to local session when live but no sb cookie", async () => {
    const local = createLocalUser({
      email: "fallback@example.com",
      password: "correct-horse-battery",
    });
    const { token: localToken } = signSession(local.id, liveEnv().COOKIE_SECRET);
    const app = { atlasEnv: liveEnv() } as unknown as FastifyInstance;
    const request = {
      headers: { cookie: `atlas_session=${encodeURIComponent(localToken)}` },
    } as unknown as FastifyRequest;

    const identity = await resolveRequestIdentity(app, request);
    expect(identity?.source).toBe("local_session");
    expect(identity?.user.id).toBe(local.id);
  });
});

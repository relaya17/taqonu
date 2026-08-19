import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";
import { generate as generateTotp } from "otplib";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-auth-route-test-"));
process.env.ATLAS_AUTH_PATH = join(tmpDir, "users.json");
process.env.ATLAS_SESSIONS_PATH = join(tmpDir, "sessions.json");
writeFileSync(process.env.ATLAS_AUTH_PATH, JSON.stringify({ users: [] }));

// Same stubbing mechanism as `apps/api/src/routes/admin-ops.test.ts`: mock
// `getRequestUser` so `requireUser`/`requireAdmin` see a fake signed-in user
// without needing a real cookie — used for the `/auth/mfa/*` endpoints that
// require an existing session.
const getRequestUser = vi.fn();

vi.mock("../services/resolve-identity.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/resolve-identity.js")>();
  return {
    ...actual,
    getRequestUser: (...args: unknown[]) => getRequestUser(...args),
  };
});

// `POST /auth/oauth/sync` verifies a client-supplied `accessToken` against
// Supabase Auth itself (`verifySupabaseAccessToken` -> `client.auth.getUser`)
// before trusting any role claim on it. Mock `@atlas/database`'s
// `createDatabaseClients` the same way `resolve-identity.test.ts` does, so
// that round trip is fully controlled per test instead of hitting the
// network. The offline `app` below (SUPABASE_SERVICE_ROLE_KEY: "replace-me")
// never reaches this mock — `isLiveSupabase()` short-circuits it first — so
// this has no effect on the existing MFA/login tests.
const authGetUser = vi.fn();

vi.mock("@atlas/database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@atlas/database")>();
  return {
    ...actual,
    createDatabaseClients: () => ({
      anon: { auth: { getUser: authGetUser } },
      service: {
        auth: {
          getUser: authGetUser,
          admin: {
            createUser: vi.fn().mockResolvedValue({ error: null }),
            updateUserById: vi.fn().mockResolvedValue({ error: null }),
            deleteUser: vi.fn().mockResolvedValue({ error: null }),
          },
        },
        from: () => ({
          upsert: vi.fn().mockResolvedValue({ error: null }),
          update: () => ({
            eq: vi.fn().mockResolvedValue({ error: null, count: 0 }),
          }),
          select: () => ({
            eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }),
          }),
          delete: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        }),
      },
    }),
  };
});

const { registerAuthRoutes } = await import("./auth.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { createLocalUser, findUserByEmail } = await import(
  "../services/auth-store.js"
);

let app: FastifyInstance;
let liveApp: FastifyInstance;

beforeAll(async () => {
  // SUPABASE_SERVICE_ROLE_KEY: "replace-me" forces isLiveSupabase() false —
  // same documented offline-test pattern as billing.test.ts / health.test.ts
  // — so login/mfa-verify never attempt a real Supabase network call.
  app = await buildRouteTestApp(registerAuthRoutes, {
    SUPABASE_SERVICE_ROLE_KEY: "replace-me",
  });
  // A second app instance with a "live" Supabase config (any
  // SUPABASE_SERVICE_ROLE_KEY other than "replace-me"), used only by the
  // `/auth/oauth/sync` accessToken-verification tests below — those need
  // `isLiveSupabase()` to be true so `verifySupabaseAccessToken` actually
  // calls the (mocked) `auth.getUser` instead of short-circuiting to null.
  liveApp = await buildRouteTestApp(registerAuthRoutes, {
    SUPABASE_SERVICE_ROLE_KEY: "live-service-role-key-longer-than-twenty",
  });
});

afterAll(async () => {
  await app.close();
  await liveApp.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  getRequestUser.mockReset();
  authGetUser.mockReset();
});

let mfaUserCounter = 0;

/** Register a fresh local user (own file-store row) and mock the session for it. */
function makeSignedInUser(overrides: Partial<AuthUser> = {}): AuthUser {
  mfaUserCounter += 1;
  const email = `mfa-user-${mfaUserCounter}@example.com`;
  const user = createLocalUser({
    email,
    password: "correct-horse-battery",
    displayName: `MFA User ${mfaUserCounter}`,
  });
  const merged: AuthUser = { ...user, ...overrides };
  getRequestUser.mockReturnValue(merged);
  return merged;
}

describe("POST /api/v1/auth/mfa/setup", () => {
  it("generates a valid base32 secret, otpauth URI, and backup codes without enabling MFA yet", async () => {
    const user = makeSignedInUser();
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/mfa/setup" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.secret).toBe("string");
    expect(body.secret.length).toBeGreaterThanOrEqual(16);
    expect(body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    expect(Array.isArray(body.backupCodes)).toBe(true);
    expect(body.backupCodes.length).toBeGreaterThan(0);

    // Not enabled yet — only setup ran, confirm hasn't.
    const stored = findUserByEmail(user.email);
    expect(stored?.mfaEnabled).toBe(false);
    expect(stored?.mfaSecret).toBe(body.secret);
  });
});

describe("POST /api/v1/auth/mfa/confirm", () => {
  it("fails with a wrong code and leaves MFA disabled", async () => {
    const user = makeSignedInUser();
    const setupRes = await app.inject({ method: "POST", url: "/api/v1/auth/mfa/setup" });
    expect(setupRes.statusCode).toBe(200);

    const badRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/confirm",
      payload: { code: "000000" },
    });
    expect(badRes.statusCode).toBe(401);
    expect(findUserByEmail(user.email)?.mfaEnabled).toBe(false);
  });

  it("enables MFA when given the right TOTP code for the pending secret", async () => {
    const user = makeSignedInUser();
    const setupRes = await app.inject({ method: "POST", url: "/api/v1/auth/mfa/setup" });
    const { secret } = setupRes.json();
    const code = await generateTotp({ secret, strategy: "totp" });

    const confirmRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/confirm",
      payload: { code },
    });
    expect(confirmRes.statusCode).toBe(200);
    expect(confirmRes.json().ok).toBe(true);
    expect(findUserByEmail(user.email)?.mfaEnabled).toBe(true);
  });
});

describe("login + /api/v1/auth/mfa/verify", () => {
  async function setupAndEnableMfa() {
    const user = makeSignedInUser();
    const setupRes = await app.inject({ method: "POST", url: "/api/v1/auth/mfa/setup" });
    const { secret, backupCodes } = setupRes.json();
    const code = await generateTotp({ secret, strategy: "totp" });
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/confirm",
      payload: { code },
    });
    return { user, secret, backupCodes };
  }

  it("login returns mfaRequired + mfaToken instead of a session once MFA is enabled", async () => {
    const { user } = await setupAndEnableMfa();

    const loginRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: user.email, password: "correct-horse-battery" },
    });
    expect(loginRes.statusCode).toBe(200);
    const body = loginRes.json();
    expect(body.mfaRequired).toBe(true);
    expect(typeof body.mfaToken).toBe("string");
    expect(body.user).toBeUndefined();
    // No session cookie handed out at this stage.
    expect(loginRes.headers["set-cookie"]).toBeUndefined();
  });

  it("mfa/verify with the wrong code fails and does not issue a session", async () => {
    const { user } = await setupAndEnableMfa();
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: user.email, password: "correct-horse-battery" },
    });
    const { mfaToken } = loginRes.json();

    const verifyRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/verify",
      payload: { mfaToken, code: "000000" },
    });
    expect(verifyRes.statusCode).toBe(401);
    expect(verifyRes.headers["set-cookie"]).toBeUndefined();
  });

  it("mfa/verify with the correct code issues a real session", async () => {
    const { user, secret } = await setupAndEnableMfa();
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: user.email, password: "correct-horse-battery" },
    });
    const { mfaToken } = loginRes.json();
    const code = await generateTotp({ secret, strategy: "totp" });

    const verifyRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/verify",
      payload: { mfaToken, code },
    });
    expect(verifyRes.statusCode).toBe(200);
    const body = verifyRes.json();
    expect(body.authenticated).toBe(true);
    expect(body.user.email).toBe(user.email);
    expect(body.sessionId).toBeTruthy();
    const cookies = verifyRes.headers["set-cookie"];
    expect(cookies).toBeDefined();
    expect(String(cookies)).toMatch(/atlas_session=/);
  });

  it("a used or expired mfaToken cannot be replayed", async () => {
    const { user, secret } = await setupAndEnableMfa();
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: user.email, password: "correct-horse-battery" },
    });
    const { mfaToken } = loginRes.json();
    const code = await generateTotp({ secret, strategy: "totp" });

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/verify",
      payload: { mfaToken, code },
    });
    expect(first.statusCode).toBe(200);

    const replayCode = await generateTotp({ secret, strategy: "totp" });
    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/verify",
      payload: { mfaToken, code: replayCode },
    });
    expect(replay.statusCode).toBe(401);
  });
});

describe("POST /api/v1/auth/mfa/disable", () => {
  it("rejects a wrong code and leaves MFA enabled", async () => {
    const user = makeSignedInUser();
    const setupRes = await app.inject({ method: "POST", url: "/api/v1/auth/mfa/setup" });
    const { secret } = setupRes.json();
    const code = await generateTotp({ secret, strategy: "totp" });
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/confirm",
      payload: { code },
    });

    const disableRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/disable",
      payload: { code: "000000" },
    });
    expect(disableRes.statusCode).toBe(401);
    expect(findUserByEmail(user.email)?.mfaEnabled).toBe(true);
  });

  it("disables MFA given a valid current TOTP code", async () => {
    const user = makeSignedInUser();
    const setupRes = await app.inject({ method: "POST", url: "/api/v1/auth/mfa/setup" });
    const { secret } = setupRes.json();
    const enableCode = await generateTotp({ secret, strategy: "totp" });
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/confirm",
      payload: { code: enableCode },
    });

    const disableCode = await generateTotp({ secret, strategy: "totp" });
    const disableRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/disable",
      payload: { code: disableCode },
    });
    expect(disableRes.statusCode).toBe(200);
    expect(disableRes.json().ok).toBe(true);
    const stored = findUserByEmail(user.email);
    expect(stored?.mfaEnabled).toBe(false);
    expect(stored?.mfaSecret).toBeNull();
  });

  it("a signed-in session alone (no code) cannot disable MFA — a stolen cookie isn't enough", async () => {
    const user = makeSignedInUser();
    const setupRes = await app.inject({ method: "POST", url: "/api/v1/auth/mfa/setup" });
    const { secret } = setupRes.json();
    const code = await generateTotp({ secret, strategy: "totp" });
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/confirm",
      payload: { code },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/disable",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(findUserByEmail(user.email)?.mfaEnabled).toBe(true);
  });

  it("a backup code can be used to disable MFA, and is single-use", async () => {
    const user = makeSignedInUser();
    const setupRes = await app.inject({ method: "POST", url: "/api/v1/auth/mfa/setup" });
    const { secret, backupCodes } = setupRes.json();
    const enableCode = await generateTotp({ secret, strategy: "totp" });
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/confirm",
      payload: { code: enableCode },
    });

    const disableRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/disable",
      payload: { code: backupCodes[0] },
    });
    expect(disableRes.statusCode).toBe(200);

    // Re-enable, then confirm that same backup code no longer works.
    const user2 = user; // same account
    void user2;
    const setupRes2 = await app.inject({ method: "POST", url: "/api/v1/auth/mfa/setup" });
    const { secret: secret2 } = setupRes2.json();
    const enableCode2 = await generateTotp({ secret: secret2, strategy: "totp" });
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/confirm",
      payload: { code: enableCode2 },
    });
    const reuseRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/disable",
      payload: { code: backupCodes[0] },
    });
    expect(reuseRes.statusCode).toBe(401);
  });
});

describe("MFA is not silently a no-op for admin promotion", () => {
  it("PATCH /admin/users/:id refuses to grant admin without MFA enabled", async () => {
    const admin = makeSignedInUser({ role: "admin" });
    const target = createLocalUser({
      email: "promote-me@example.com",
      password: "correct-horse-battery",
    });
    getRequestUser.mockReturnValue(admin);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/users/${target.id}`,
      payload: { role: "admin" },
    });
    expect(res.statusCode).toBe(400);
    expect(findUserByEmail(target.email)?.role).toBe("user");
  });

  it("PATCH /admin/users/:id grants admin once the target has MFA enabled", async () => {
    const admin = makeSignedInUser({ role: "admin" });
    const target = makeSignedInUser();
    const setupRes = await app.inject({ method: "POST", url: "/api/v1/auth/mfa/setup" });
    const { secret } = setupRes.json();
    const code = await generateTotp({ secret, strategy: "totp" });
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/confirm",
      payload: { code },
    });

    getRequestUser.mockReturnValue(admin);
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/users/${target.id}`,
      payload: { role: "admin" },
    });
    expect(res.statusCode).toBe(200);
    expect(findUserByEmail(target.email)?.role).toBe("admin");
  });
});

describe("POST /api/v1/auth/oauth/sync — accessToken role claims must be verified", () => {
  let oauthCounter = 0;

  function nextEmail(): string {
    oauthCounter += 1;
    return `oauth-sync-${oauthCounter}@example.com`;
  }

  it("a forged accessToken claiming atlas_role: admin does NOT elevate the user's role", async () => {
    // Simulate Supabase Auth rejecting the token outright — a forged JWT with
    // no real signature, or one that simply doesn't correspond to any real
    // session, fails `client.auth.getUser()` the same way.
    authGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: "invalid JWT" },
    });
    const email = nextEmail();
    const id = crypto.randomUUID();

    const res = await liveApp.inject({
      method: "POST",
      url: "/api/v1/auth/oauth/sync",
      payload: {
        email,
        provider: "google",
        id,
        // Forged, attacker-controlled JWT: base64url header/payload with a
        // made-up `sub` and `app_metadata.atlas_role: "admin"`, no valid
        // signature. `verifySupabaseAccessToken` must reject this — its
        // mocked `auth.getUser` above returns no user for any token here.
        accessToken: [
          Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
            "base64url",
          ),
          Buffer.from(
            JSON.stringify({
              sub: id,
              app_metadata: { atlas_role: "admin" },
              exp: Math.floor(Date.now() / 1000) + 3600,
            }),
          ).toString("base64url"),
          "forged-signature",
        ].join("."),
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.role).not.toBe("admin");
    expect(findUserByEmail(email)?.role).not.toBe("admin");
  });

  it("a genuine, Supabase-verified accessToken with a real atlas_role claim still syncs the role", async () => {
    const email = nextEmail();
    const id = crypto.randomUUID();
    // Simulate Supabase Auth confirming this exact token really is genuine,
    // currently valid, and belongs to `id` with `atlas_role: "admin"` in its
    // real app_metadata — the legitimate OAuth-role-sync case this endpoint
    // exists for.
    authGetUser.mockResolvedValue({
      data: {
        user: {
          id,
          email,
          app_metadata: { atlas_role: "admin" },
          user_metadata: {},
        },
      },
      error: null,
    });

    const res = await liveApp.inject({
      method: "POST",
      url: "/api/v1/auth/oauth/sync",
      payload: {
        email,
        provider: "google",
        id,
        accessToken: "genuine-access-token",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.role).toBe("admin");
    expect(findUserByEmail(email)?.role).toBe("admin");
  });
});

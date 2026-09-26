import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate as generateTotp } from "otplib";
import type { FastifyInstance } from "fastify";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-durable-auth-"));
const authPath = join(tmpDir, "users.json");
const sessionsPath = join(tmpDir, "sessions.json");
const resetPath = join(tmpDir, "resets.json");
process.env.ATLAS_AUTH_PATH = authPath;
process.env.ATLAS_SESSIONS_PATH = sessionsPath;
process.env.ATLAS_RESET_PATH = resetPath;
writeFileSync(authPath, JSON.stringify({ users: [] }));
writeFileSync(sessionsPath, JSON.stringify({ sessions: [] }));

interface CloudUser {
  id: string;
  email: string;
  password: string;
  role: string;
}

const { state } = vi.hoisted(() => ({
  state: {
    users: new Map<string, CloudUser>(),
    mode: "ok" as "ok" | "invalid" | "throw" | "down",
    profileWrites: [] as Array<Record<string, unknown>>,
  },
}));

function fakeJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${payload}.sig`;
}

function resetCloud(): void {
  state.users.clear();
  state.mode = "ok";
  state.profileWrites = [];
  writeFileSync(authPath, JSON.stringify({ users: [] }));
  writeFileSync(sessionsPath, JSON.stringify({ sessions: [] }));
  writeFileSync(resetPath, JSON.stringify({ tokens: [] }));
}

vi.mock("@atlas/database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@atlas/database")>();
  return {
    ...actual,
    createDatabaseClients: () => ({
      anon: {
        auth: {
          getUser: async (token: string) => {
            const payload = JSON.parse(
              Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
            ) as { sub?: string };
            const user = payload.sub ? state.users.get(payload.sub) : undefined;
            if (!user) return { data: { user: null }, error: { message: "invalid" } };
            return {
              data: {
                user: {
                  id: user.id,
                  email: user.email,
                  app_metadata: { atlas_role: user.role },
                  user_metadata: {},
                },
              },
              error: null,
            };
          },
          signInWithPassword: async (input: { email: string; password: string }) => {
            if (state.mode === "throw") throw new Error("auth upstream down");
            if (state.mode === "down") {
              return { data: { session: null }, error: { message: "bad gateway", status: 503 } };
            }
            const email = input.email.trim().toLowerCase();
            const user = [...state.users.values()].find((row) => row.email === email);
            if (state.mode === "invalid" || !user || user.password !== input.password) {
              return {
                data: { session: null },
                error: { message: "Invalid login credentials", status: 400 },
              };
            }
            const accessToken = fakeJwt({
              sub: user.id,
              email: user.email,
              exp: 1_900_000_000,
              app_metadata: { atlas_role: user.role },
            });
            return {
              data: {
                session: {
                  access_token: accessToken,
                  refresh_token: "pending-refresh",
                  expires_at: 1_900_000_000,
                },
              },
              error: null,
            };
          },
        },
      },
      service: {
        auth: {
          getUser: async () => ({ data: { user: null }, error: null }),
          admin: {
            createUser: async (input: {
              id?: string;
              email: string;
              password: string;
              app_metadata?: { atlas_role?: string };
            }) => {
              const email = input.email.trim().toLowerCase();
              if ([...state.users.values()].some((row) => row.email === email)) {
                return {
                  data: { user: null },
                  error: { message: "A user with this email address has already been registered", status: 422 },
                };
              }
              const id = input.id ?? crypto.randomUUID();
              state.users.set(id, {
                id,
                email,
                password: input.password,
                role: input.app_metadata?.atlas_role ?? "user",
              });
              return { data: { user: { id } }, error: null };
            },
            updateUserById: async (id: string, patch: { password?: string }) => {
              if (state.mode === "throw") throw new Error("auth upstream down");
              if (state.mode === "down") {
                return { error: { message: "bad gateway", status: 503 } };
              }
              const user = state.users.get(id);
              if (!user) return { error: { message: "not found", status: 404 } };
              if (patch.password) user.password = patch.password;
              return { error: null };
            },
          },
        },
        from: () => ({
          upsert: (row: Record<string, unknown>) => {
            state.profileWrites.push(row);
            return Promise.resolve({ error: null });
          },
        }),
      },
    }),
  };
});

const { registerAuthRoutes } = await import("./auth.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const {
  beginMfaSetup,
  confirmMfaSetup,
  createLocalUser,
  describeMfaLoginChallenge,
  mfaChallengeContainsSecret,
  setLocalUserRole,
} = await import("../services/auth-store.js");
const { createPasswordResetToken } = await import("../services/auth-reset.js");
const { syncSupabaseAuthRole } = await import("../services/supabase-session.js");

let app: FastifyInstance;
const password = "Durable-Test-1";

function cookieLine(res: { headers: Record<string, unknown> }, name: string): string | null {
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw.map(String) : [String(raw ?? "")];
  const line = list.find((item) => item.startsWith(`${name}=`));
  return line ? (line.split(";")[0] ?? null) : null;
}

beforeAll(async () => {
  vi.stubGlobal(
    "fetch",
    async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/auth/v1/admin/users")) {
        if (state.mode === "throw" || state.mode === "down") {
          return { ok: false, status: 503, json: async () => ({}) };
        }
        return {
          ok: true,
          json: async () => ({
            users: [...state.users.values()].map((user) => ({ id: user.id, email: user.email })),
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    },
  );
  app = await buildRouteTestApp(registerAuthRoutes, {
    SUPABASE_SERVICE_ROLE_KEY: "live-service-role-key-longer-than-twenty",
    SUPABASE_URL: "https://example.supabase.co",
  });
});

beforeEach(() => {
  resetCloud();
});

afterAll(async () => {
  await app.close();
  vi.unstubAllGlobals();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("durable auth", () => {
  it("1. Supabase login succeeds", async () => {
    state.users.set("11111111-1111-4111-8111-111111111111", {
      id: "11111111-1111-4111-8111-111111111111",
      email: "kept@example.com",
      password,
      role: "user",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "kept@example.com", password },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.id).toBe("11111111-1111-4111-8111-111111111111");
    expect(cookieLine(res, "atlas_sb_session")).toBeTruthy();
  });

  it("2. Supabase login fails", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "missing@example.com", password },
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("3. local JSON user with no Supabase user is migrated, then authenticated by Supabase", async () => {
    const local = createLocalUser({ email: "migrate@example.com", password });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "migrate@example.com", password },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.id).toBe(local.id);
    expect(state.users.has(local.id)).toBe(true);
    expect(cookieLine(res, "atlas_sb_session")).toBeTruthy();
  });

  it("4. Supabase unavailable does not accept the local password", async () => {
    createLocalUser({ email: "down@example.com", password });
    state.mode = "throw";
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "down@example.com", password },
    });
    expect(res.statusCode).toBe(503);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("5. backfill does not run when the Supabase user already exists", async () => {
    createLocalUser({ email: "both@example.com", password });
    state.users.set("22222222-2222-4222-8222-222222222222", {
      id: "22222222-2222-4222-8222-222222222222",
      email: "both@example.com",
      password: "other-password-value",
      role: "user",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "both@example.com", password },
    });
    expect(res.statusCode).toBe(401);
    expect(state.users.size).toBe(1);
  });

  it("6. backfill cannot authenticate when the confirming Supabase sign-in fails", async () => {
    createLocalUser({ email: "stuck@example.com", password });
    state.mode = "invalid";
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "stuck@example.com", password },
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(res.json().authenticated).toBeUndefined();
  });

  it("7. authorization role follows atlas_role and profiles.role is not given an illegal value", async () => {
    const env = {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "live-service-role-key-longer-than-twenty",
    };
    await syncSupabaseAuthRole(env, {
      id: "33333333-3333-4333-8333-333333333333",
      role: "admin",
      email: "admin-role@example.com",
    });
    await syncSupabaseAuthRole(env, {
      id: "44444444-4444-4444-8444-444444444444",
      role: "owner",
      email: "owner-role@example.com",
    });
    expect(state.profileWrites[0]?.role).toBe("admin");
    expect(state.profileWrites[1]?.role).toBeUndefined();

    const local = createLocalUser({ email: "ranked@example.com", password: "other-password-value" });
    setLocalUserRole(local.id, "user");
    state.users.set(local.id, {
      id: local.id,
      email: local.email,
      password,
      role: "admin",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: local.email, password },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.role).toBe("admin");
  });

  it("8. MFA challenge stores no password and completion still authenticates", async () => {
    const local = createLocalUser({ email: "mfa@example.com", password });
    const setup = beginMfaSetup(local.id);
    if (!setup) throw new Error("mfa setup failed");
    const code = await generateTotp({ secret: setup.secret, strategy: "totp" });
    await confirmMfaSetup(local.id, code);
    state.users.set(local.id, {
      id: local.id,
      email: local.email,
      password,
      role: "user",
    });
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: local.email, password },
    });
    expect(loginRes.statusCode).toBe(200);
    const mfaToken = loginRes.json().mfaToken as string;
    expect(describeMfaLoginChallenge(mfaToken)?.keys).not.toContain("password");
    expect(mfaChallengeContainsSecret(mfaToken, password)).toBe(false);
    const nextCode = await generateTotp({ secret: setup.secret, strategy: "totp" });
    const verified = await app.inject({
      method: "POST",
      url: "/api/v1/auth/mfa/verify",
      payload: { mfaToken, code: nextCode },
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.json().authenticated).toBe(true);
    expect(verified.json().user.id).toBe(local.id);
  });

  it("9. a broken user-file path does not block a valid Supabase login", async () => {
    const blocker = join(tmpDir, "not-a-directory");
    writeFileSync(blocker, "x");
    process.env.ATLAS_AUTH_PATH = join(blocker, "users.json");
    state.users.set("55555555-5555-4555-8555-555555555555", {
      id: "55555555-5555-4555-8555-555555555555",
      email: "nofile@example.com",
      password,
      role: "user",
    });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "nofile@example.com", password },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().user.id).toBe("55555555-5555-4555-8555-555555555555");
    } finally {
      process.env.ATLAS_AUTH_PATH = authPath;
    }
  });

  it("10. a fresh session restores the same auth.users id", async () => {
    const registered = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email: "Fresh@Example.com", password },
    });
    expect(registered.statusCode).toBe(201);
    const id = registered.json().user.id as string;
    writeFileSync(authPath, JSON.stringify({ users: [] }));
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "fresh@example.com", password },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().user.id).toBe(id);
    writeFileSync(authPath, JSON.stringify({ users: [] }));
    const sb = cookieLine(login, "atlas_sb_session");
    expect(sb).toBeTruthy();
    const me = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { cookie: sb ?? "" },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.id).toBe(id);
  });

  it("password reset with working Supabase authenticates only after Auth accepts the new password", async () => {
    const id = "66666666-6666-4666-8666-666666666666";
    createLocalUser({ email: "reset@example.com", password });
    state.users.set(id, { id, email: "reset@example.com", password, role: "user" });
    const next = "Durable-Reset-2";
    const { token } = createPasswordResetToken("reset@example.com");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/reset",
      payload: { token, newPassword: next },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.id).toBe(id);
    expect(cookieLine(res, "atlas_sb_session")).toBeTruthy();
    expect(state.users.get(id)?.password).toBe(next);
    expect(JSON.stringify(res.json())).not.toContain(next);
    const stored = readFileSync(authPath, "utf8") + readFileSync(resetPath, "utf8");
    expect(stored).not.toContain(next);
    expect(stored).not.toContain(password);
  });

  it("password reset with Supabase authentication failure issues no session", async () => {
    const id = "77777777-7777-4777-8777-777777777777";
    state.users.set(id, { id, email: "reject@example.com", password, role: "user" });
    state.mode = "invalid";
    const next = "Durable-Reset-3";
    const { token } = createPasswordResetToken("reject@example.com");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/reset",
      payload: { token, newPassword: next },
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(res.json().authenticated).toBeUndefined();
  });

  it("password reset with Supabase unavailable issues no session", async () => {
    const id = "88888888-8888-4888-8888-888888888888";
    state.users.set(id, { id, email: "outage@example.com", password, role: "user" });
    state.mode = "down";
    const { token } = createPasswordResetToken("outage@example.com");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/reset",
      payload: { token, newPassword: "Durable-Reset-4" },
    });
    expect(res.statusCode).toBe(503);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(state.users.get(id)?.password).toBe(password);
  });

  it("password reset cannot issue local-only authentication", async () => {
    const { verifyLocalPassword } = await import("../services/auth-store.js");
    createLocalUser({ email: "localonly@example.com", password });
    const next = "Durable-Reset-5";
    const { token } = createPasswordResetToken("localonly@example.com");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password/reset",
      payload: { token, newPassword: next },
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(state.users.size).toBe(0);
    expect(verifyLocalPassword("localonly@example.com", password)?.email).toBe("localonly@example.com");
    expect(verifyLocalPassword("localonly@example.com", next)).toBeNull();
  });

  it("a broken session sidecar does not invalidate a Supabase login", async () => {
    const blocker = join(tmpDir, "sessions-blocker");
    writeFileSync(blocker, "x");
    process.env.ATLAS_SESSIONS_PATH = join(blocker, "sessions.json");
    const id = "99999999-9999-4999-8999-999999999999";
    state.users.set(id, { id, email: "sidecar@example.com", password, role: "user" });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "sidecar@example.com", password },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().user.id).toBe(id);
      const sb = cookieLine(res, "atlas_sb_session");
      expect(sb).toBeTruthy();
      const me = await app.inject({
        method: "GET",
        url: "/api/v1/auth/me",
        headers: { cookie: sb ?? "" },
      });
      expect(me.statusCode).toBe(200);
      expect(me.json().user.id).toBe(id);
    } finally {
      process.env.ATLAS_SESSIONS_PATH = sessionsPath;
    }
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-eval-route-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";

const getRequestUser = vi.fn();
vi.mock("../services/resolve-identity.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/resolve-identity.js")>();
  return {
    ...actual,
    getRequestUser: (...args: unknown[]) => getRequestUser(...args),
  };
});

const { registerEvalRoutes } = await import("./eval.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");

function user(partial: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    email: "user@example.com",
    displayName: "User",
    role: "user",
    locale: "en",
    provider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

const admin = user({
  id: "22222222-2222-4222-8222-222222222222",
  email: "admin@example.com",
  role: "admin",
});

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildRouteTestApp(registerEvalRoutes);
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  getRequestUser.mockReset();
});

describe("GET /api/v1/eval/runs", () => {
  it("401s when unsigned", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({ method: "GET", url: "/api/v1/eval/runs" });
    expect(res.statusCode).toBe(401);
  });

  it("403s for a signed-in non-admin", async () => {
    getRequestUser.mockReturnValue(user());
    const res = await app.inject({ method: "GET", url: "/api/v1/eval/runs" });
    expect(res.statusCode).toBe(403);
  });

  it("200s for admin", async () => {
    getRequestUser.mockReturnValue(admin);
    const res = await app.inject({ method: "GET", url: "/api/v1/eval/runs" });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().items)).toBe(true);
  });
});

describe("POST /api/v1/eval/runs", () => {
  it("401s when unsigned", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/eval/runs",
      payload: { suiteId: "11111111-1111-4111-8111-111111111111" },
    });
    expect(res.statusCode).toBe(401);
  });
});

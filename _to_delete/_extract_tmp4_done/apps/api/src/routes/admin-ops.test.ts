import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-admin-ops-route-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";

// Same stubbing mechanism as `apps/api/src/middleware/auth-guards.test.ts`:
// mock `getRequestUser` from the identity-resolution service module so
// `requireAdmin` (and anything else that calls it) sees a fake signed-in
// user without needing real Supabase/local-session cookies.
const getRequestUser = vi.fn();

vi.mock("../services/resolve-identity.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/resolve-identity.js")>();
  return {
    ...actual,
    getRequestUser: (...args: unknown[]) => getRequestUser(...args),
  };
});

const { registerAdminOpsRoutes } = await import("./admin-ops.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");

let app: FastifyInstance;

function adminUser(partial: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    email: "admin@example.com",
    displayName: "Admin",
    role: "admin",
    locale: "en",
    provider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

beforeAll(async () => {
  app = await buildRouteTestApp(registerAdminOpsRoutes);
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  getRequestUser.mockReset();
  getRequestUser.mockReturnValue(adminUser());
});

describe("POST /api/v1/admin/automation/run-checks", () => {
  it("403s with an APPROVAL_REQUIRED reason even for an admin — CONFIGURATION.EXECUTE is DESTRUCTIVE-tier and has no approval workflow yet", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/automation/run-checks",
    });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error.code).toBe("APPROVAL_REQUIRED");
    expect(body.error.message).toMatch(/CONFIGURATION\.EXECUTE|approval/i);
  });
});

describe("POST /api/v1/admin/oracle/refresh-queue (untouched sibling endpoint)", () => {
  it("still 200s for an admin exactly as before — the new gate is scoped to run-checks only", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/oracle/refresh-queue",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.queue).toBeDefined();
  });
});

describe("GET /api/v1/admin/command-center (untouched read endpoint)", () => {
  it("still 200s for an admin", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/command-center",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().platform).toBeDefined();
  });

  it("still 403s for a non-admin (requireAdmin unaffected)", async () => {
    getRequestUser.mockReturnValue(adminUser({ role: "user" }));
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/command-center",
    });
    expect(res.statusCode).toBe(403);
  });
});

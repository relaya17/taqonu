import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-approvals-route-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";

// Same stubbing mechanism as `apps/api/src/routes/admin-ops.test.ts`: mock
// `getRequestUser` from the identity-resolution service module so
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

const { registerApprovalRoutes } = await import("./approvals.js");
const { createApprovalRequest } = await import("../services/approvals.js");
const { resetApprovalsForTests } = await import(
  "../services/approvals-test-store.js"
);
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
  app = await buildRouteTestApp(registerApprovalRoutes);
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  getRequestUser.mockReset();
  getRequestUser.mockReturnValue(adminUser());
  resetApprovalsForTests();
});

describe("GET /api/v1/approvals", () => {
  it("lists approval requests for an admin", async () => {
    await createApprovalRequest({
      entityType: "CONFIGURATION",
      action: "EXECUTE",
      requestedBy: "user-1",
      reason: "run checks",
    });

    const res = await app.inject({ method: "GET", url: "/api/v1/approvals" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].status).toBe("PENDING");
  });

  it("filters by status", async () => {
    await createApprovalRequest({
      entityType: "CONFIGURATION",
      action: "EXECUTE",
      requestedBy: "user-1",
      reason: "run checks",
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/approvals?status=APPROVED",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(0);
  });

  it("403s for a non-admin", async () => {
    getRequestUser.mockReturnValue(adminUser({ role: "user" }));
    const res = await app.inject({ method: "GET", url: "/api/v1/approvals" });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /api/v1/approvals/:id", async () => {
  it("404s for an unknown id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/approvals/00000000-0000-4000-8000-000000000000",
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("returns the approval request for a known id", async () => {
    const request = await createApprovalRequest({
      entityType: "CONFIGURATION",
      action: "EXECUTE",
      requestedBy: "user-1",
      reason: "run checks",
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/approvals/${request.id}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(request.id);
  });
});

describe("POST /api/v1/approvals/:id/decide", async () => {
  it("requires a non-empty reason", async () => {
    const request = await createApprovalRequest({
      entityType: "CONFIGURATION",
      action: "EXECUTE",
      requestedBy: "user-1",
      reason: "run checks",
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${request.id}/decide`,
      payload: { approve: true, reason: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("approves a pending request", async () => {
    const request = await createApprovalRequest({
      entityType: "CONFIGURATION",
      action: "EXECUTE",
      requestedBy: "user-1",
      reason: "run checks",
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${request.id}/decide`,
      payload: { approve: true, reason: "looks good" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("APPROVED");
    expect(body.decidedBy).toBe(adminUser().id);
  });

  it("403s for a non-admin", async () => {
    const request = await createApprovalRequest({
      entityType: "CONFIGURATION",
      action: "EXECUTE",
      requestedBy: "user-1",
      reason: "run checks",
    });
    getRequestUser.mockReturnValue(adminUser({ role: "user" }));

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${request.id}/decide`,
      payload: { approve: true, reason: "looks good" },
    });
    expect(res.statusCode).toBe(403);
  });
});

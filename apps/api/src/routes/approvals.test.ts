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
const { createApprovalRequest, decideApprovalRequest } = await import(
  "../services/approvals.js"
);
const { resetApprovalsForTests } = await import(
  "../services/approvals-test-store.js"
);
const {
  ATLAS_SELF_CONTROL_REQUEST_PATH,
  ATLAS_SELF_CONTROL_VERIFY_PATH,
  atlasSelfApprovalContext,
} = await import("@atlas/shared");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");

let app: FastifyInstance;

function adminUser(partial: Partial<AuthUser> = {}): AuthUser {
  // AuthUser expects `emailVerified` to be present; `Partial<AuthUser>`
  // would otherwise make it optional when spreading.
  const {
    emailVerified = true,
    disabled = false,
    hasPassword = false,
    mfaEnabled = false,
    ...rest
  } = partial;
  return {
    id: "22222222-2222-4222-8222-222222222222",
    email: "admin@example.com",
    displayName: "Admin",
    role: "admin",
    locale: "en",
    provider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    emailVerified,
    disabled,
    hasPassword,
    mfaEnabled,
    ...rest,
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

  it("409s when the requester decides their own Atlas-self approval", async () => {
    const requester = adminUser({
      id: "66666666-6666-4666-8666-666666666666",
      email: "requester@example.com",
    });
    getRequestUser.mockReturnValue(requester);
    const request = await createApprovalRequest({
      entityType: "CONFIGURATION",
      action: "UPDATE",
      requestedBy: requester.id,
      reason: "pause Atlas-self agent",
      context: atlasSelfApprovalContext({ route: "agents.disable" }),
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${request.id}/decide`,
      payload: { approve: true, reason: "self sign-off" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CONFLICT");

    const pending = await app.inject({
      method: "GET",
      url: `/api/v1/approvals/${request.id}`,
    });
    expect(pending.statusCode).toBe(200);
    expect(pending.json().status).toBe("PENDING");
    expect(pending.json().decidedBy).toBeNull();
  });

  it("still allows an independent admin to decide an Atlas-self approval", async () => {
    const requester = adminUser({
      id: "66666666-6666-4666-8666-666666666666",
      email: "requester@example.com",
    });
    const request = await createApprovalRequest({
      entityType: "CONFIGURATION",
      action: "UPDATE",
      requestedBy: requester.id,
      reason: "pause Atlas-self agent",
      context: atlasSelfApprovalContext({ route: "agents.disable" }),
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${request.id}/decide`,
      payload: { approve: true, reason: "independent review" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("APPROVED");
    expect(res.json().decidedBy).toBe(adminUser().id);
  });
});

describe("POST Atlas-self control verify (CP SERVICE)", () => {
  const CP_TOKEN = "phase13-cp-verify-token";

  beforeEach(() => {
    process.env.ATLAS_CONTROL_PLANE_TOKEN = CP_TOKEN;
  });

  function cpHeaders(token = CP_TOKEN): Record<string, string> {
    return { authorization: `Bearer ${token}` };
  }

  it("401s without a Control Plane service token", async () => {
    delete process.env.ATLAS_CONTROL_PLANE_TOKEN;
    const res = await app.inject({
      method: "POST",
      url: ATLAS_SELF_CONTROL_VERIFY_PATH,
      payload: {
        approvalId: "00000000-0000-4000-8000-000000000000",
        agentId: "CODE_ENGINEER",
        action: "pause",
      },
    });
    expect(res.statusCode).toBe(503);
  });

  it("401s with the wrong service token and never verifies", async () => {
    process.env.ATLAS_CONTROL_PLANE_TOKEN = CP_TOKEN;
    const res = await app.inject({
      method: "POST",
      url: ATLAS_SELF_CONTROL_VERIFY_PATH,
      headers: cpHeaders("wrong-token"),
      payload: {
        approvalId: "00000000-0000-4000-8000-000000000000",
        agentId: "CODE_ENGINEER",
        action: "pause",
      },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().verified).not.toBe(true);
  });

  it("mints a PENDING Atlas-self control approval and fail-closes verify until independent decide", async () => {
    const minted = await app.inject({
      method: "POST",
      url: ATLAS_SELF_CONTROL_REQUEST_PATH,
      headers: cpHeaders(),
      payload: { agentId: "CODE_ENGINEER", action: "pause" },
    });
    expect(minted.statusCode).toBe(201);
    const approvalId = minted.json().approvalId as string;

    const pending = await app.inject({
      method: "POST",
      url: ATLAS_SELF_CONTROL_VERIFY_PATH,
      headers: cpHeaders(),
      payload: { approvalId, agentId: "CODE_ENGINEER", action: "pause" },
    });
    expect(pending.statusCode).toBe(200);
    expect(pending.json().verified).toBe(false);
    expect(pending.json().reason).toBe("PENDING");

    const missing = await app.inject({
      method: "POST",
      url: ATLAS_SELF_CONTROL_VERIFY_PATH,
      headers: cpHeaders(),
      payload: {
        approvalId: "00000000-0000-4000-8000-000000000000",
        agentId: "CODE_ENGINEER",
        action: "pause",
      },
    });
    expect(missing.json().verified).toBe(false);
    expect(missing.json().reason).toMatch(/missing/i);

    await decideApprovalRequest(approvalId, {
      decidedBy: "77777777-7777-4777-8777-777777777777",
      approve: true,
      decisionReason: "independent review",
    });
    const ok = await app.inject({
      method: "POST",
      url: ATLAS_SELF_CONTROL_VERIFY_PATH,
      headers: cpHeaders(),
      payload: { approvalId, agentId: "CODE_ENGINEER", action: "pause" },
    });
    expect(ok.json().verified).toBe(true);
    expect(ok.json().approvalId).toBe(approvalId);

    const wrongTarget = await app.inject({
      method: "POST",
      url: ATLAS_SELF_CONTROL_VERIFY_PATH,
      headers: cpHeaders(),
      payload: { approvalId, agentId: "QA", action: "pause" },
    });
    expect(wrongTarget.json().verified).toBe(false);
    expect(wrongTarget.json().reason).toMatch(/target/i);

    const wrongOp = await app.inject({
      method: "POST",
      url: ATLAS_SELF_CONTROL_VERIFY_PATH,
      headers: cpHeaders(),
      payload: { approvalId, agentId: "CODE_ENGINEER", action: "revoke" },
    });
    expect(wrongOp.json().verified).toBe(false);
    expect(wrongOp.json().reason).toMatch(/operation/i);
  });
});

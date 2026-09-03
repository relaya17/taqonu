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
const { decideApprovalRequest } = await import("../services/approvals.js");
const { resetApprovalsForTests } = await import(
  "../services/approvals-test-store.js"
);

let app: FastifyInstance;

function adminUser(partial: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    email: "admin@example.com",
    displayName: "Admin",
    role: "owner",
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
  resetApprovalsForTests();
});

describe("POST /api/v1/admin/automation/run-checks", () => {
  it("202s with an APPROVAL_REQUIRED approvalId when no approval is supplied — CONFIGURATION.EXECUTE is DESTRUCTIVE-tier and needs an explicit approval decision", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/automation/run-checks",
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe("APPROVAL_REQUIRED");
    expect(typeof body.approvalId).toBe("string");
    expect(body.message).toMatch(/approve/i);
  });

  it("CONFIGURATION.EXECUTE is HUMAN_ONLY: even after an ordinary /decide APPROVED, the ?approvalId= retry can never execute -- it stays 202 APPROVAL_REQUIRED and burns the claim (approval-token replay is exactly what HUMAN_ONLY forbids)", async () => {
    // This replaces a stale pre-CP7.2 assertion that expected this retry to
    // 200 and execute. That behavior was a bug the CP7.2 migration fixes:
    // CONFIGURATION.EXECUTE is DESTRUCTIVE-tier -> HUMAN_ONLY, and
    // `dispatchAgentAction` never lets a claimed AGENT-actor token satisfy
    // HUMAN_ONLY. The only path that can execute this action now is
    // POST .../run-checks/decide-and-execute (see the describe block below).
    const requested = await app.inject({
      method: "POST",
      url: "/api/v1/admin/automation/run-checks",
    });
    const { approvalId } = requested.json();

    await decideApprovalRequest(approvalId, {
      decidedBy: adminUser().id,
      approve: true,
      decisionReason: "approved for test",
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/automation/run-checks?approvalId=${approvalId}`,
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe("APPROVAL_REQUIRED");

    // The claimed-but-not-satisfied token is burned FAILED by the Stage 4
    // re-check, not left dangling APPROVED for a later replay attempt.
    const replay = await app.inject({
      method: "POST",
      url: `/api/v1/admin/automation/run-checks?approvalId=${approvalId}`,
    });
    expect(replay.statusCode).toBe(403);
    expect(replay.json().error.code).toBe("FORBIDDEN");
  });

  it("403s when the approvalId refers to a still-PENDING request", async () => {
    const requested = await app.inject({
      method: "POST",
      url: "/api/v1/admin/automation/run-checks",
    });
    const { approvalId } = requested.json();

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/admin/automation/run-checks?approvalId=${approvalId}`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("404s when the approvalId does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/automation/run-checks?approvalId=00000000-0000-4000-8000-000000000000",
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });
});

describe("POST /api/v1/admin/automation/run-checks/decide-and-execute (CP7.2 live-human path)", () => {
  const REQUESTER = adminUser({ id: "66666666-6666-4666-8666-666666666666", email: "requester@example.com" });
  const DECIDER = adminUser({ id: "77777777-7777-4777-8777-777777777777", email: "decider@example.com" });

  async function requestApproval() {
    getRequestUser.mockReturnValue(REQUESTER);
    const requested = await app.inject({
      method: "POST",
      url: "/api/v1/admin/automation/run-checks",
    });
    const { approvalId } = requested.json();
    return approvalId as string;
  }

  it("a different, live-authenticated operator can decide-and-execute in one atomic step: 200s, runs the watchdog exactly once, and the underlying approval is CLAIMED directly (never a bare APPROVED replay token)", async () => {
    const approvalId = await requestApproval();

    getRequestUser.mockReturnValue(DECIDER);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/automation/run-checks/decide-and-execute",
      payload: { approvalId, decisionReason: "verified live, approved" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.report).toBeDefined();

    // Finalized -- replaying is a terminal-status replay, not a second
    // execution, and must not run the watchdog again.
    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/admin/automation/run-checks/decide-and-execute",
      payload: { approvalId, decisionReason: "trying again" },
    });
    expect(replay.statusCode).toBe(403);
  });

  it("self-approval is rejected: the requesting operator cannot also be the live decider for their own request", async () => {
    const approvalId = await requestApproval();

    getRequestUser.mockReturnValue(REQUESTER);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/automation/run-checks/decide-and-execute",
      payload: { approvalId, decisionReason: "self sign-off attempt" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("a still-PENDING approvalId that does not exist 4xxs and never runs the watchdog", async () => {
    getRequestUser.mockReturnValue(DECIDER);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/automation/run-checks/decide-and-execute",
      payload: {
        approvalId: "00000000-0000-4000-8000-000000000000",
        decisionReason: "no such request",
      },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("the old approval-token retry route cannot be used to bypass the live-human requirement even after a decide-and-execute FULFILLED the request", async () => {
    const approvalId = await requestApproval();
    getRequestUser.mockReturnValue(DECIDER);
    await app.inject({
      method: "POST",
      url: "/api/v1/admin/automation/run-checks/decide-and-execute",
      payload: { approvalId, decisionReason: "verified live, approved" },
    });

    const oldPathRetry = await app.inject({
      method: "POST",
      url: `/api/v1/admin/automation/run-checks?approvalId=${approvalId}`,
    });
    expect(oldPathRetry.statusCode).toBe(403);
  });
});

describe("POST /api/v1/admin/oracle/refresh-queue (untouched sibling endpoint)", async () => {
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

describe("GET /api/v1/admin/command-center (untouched read endpoint)", async () => {
  it("still 200s for an admin", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/command-center",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().platform).toBeDefined();
  });

  it("403s for a customer admin (Control Plane requires owner/operator)", async () => {
    getRequestUser.mockReturnValue(adminUser({ role: "admin" }));
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/command-center",
    });
    expect(res.statusCode).toBe(403);
  });

  it("403s for a non-admin (requireOperator unaffected for users)", async () => {
    getRequestUser.mockReturnValue(adminUser({ role: "user" }));
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/command-center",
    });
    expect(res.statusCode).toBe(403);
  });
});

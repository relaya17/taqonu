import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-agent-lifecycle-route-test-"));
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

const { registerAgentLifecycleRoutes } = await import("./agent-lifecycle.js");
const { resetAgentLifecycleForTests } = await import("@atlas/agent-core");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { resetApprovalsForTests } = await import(
  "../services/approvals-test-store.js"
);
const { resetGovernedClaimStartsForTests } = await import(
  "../services/governed-claimed-execution.js"
);

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

const REQUESTER = adminUser({
  id: "66666666-6666-4666-8666-666666666666",
  email: "requester@example.com",
});
const DECIDER = adminUser({
  id: "77777777-7777-4777-8777-777777777777",
  email: "decider@example.com",
});

beforeAll(async () => {
  app = await buildRouteTestApp(registerAgentLifecycleRoutes);
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  getRequestUser.mockReset();
  getRequestUser.mockReturnValue(adminUser());
  resetAgentLifecycleForTests();
  resetApprovalsForTests();
  resetGovernedClaimStartsForTests();
});

afterEach(() => {
  resetAgentLifecycleForTests();
});

describe("GET /api/v1/agents/lifecycle", () => {
  it("is a public read that lists every agent enabled by default", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({ method: "GET", url: "/api/v1/agents/lifecycle" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
    for (const item of body.items) {
      expect(item.enabled).toBe(true);
    }
    const orchestrator = body.items.find((i: { agentId: string }) => i.agentId === "ORCHESTRATOR");
    expect(orchestrator.core).toBe(true);
    const qa = body.items.find((i: { agentId: string }) => i.agentId === "QA");
    expect(qa.core).toBe(false);
  });
});

describe("POST /api/v1/agents/:id/disable", () => {
  it("403s for a non-admin", async () => {
    getRequestUser.mockReturnValue(adminUser({ role: "user" }));
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/QA/disable",
    });
    expect(res.statusCode).toBe(403);
  });

  it("requires independent approval and does not disable yet", async () => {
    getRequestUser.mockReturnValue(REQUESTER);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/QA/disable",
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe("APPROVAL_REQUIRED");
    expect(body.applicationId).toBe("def-000");
    expect(body.executed).toBe(false);
    expect(typeof body.approvalId).toBe("string");

    const list = await app.inject({ method: "GET", url: "/api/v1/agents/lifecycle" });
    const qa = list.json().items.find((i: { agentId: string }) => i.agentId === "QA");
    expect(qa.enabled).toBe(true);
  });

  it("rejects self-approval of the Atlas-self disable request", async () => {
    getRequestUser.mockReturnValue(REQUESTER);
    const requested = await app.inject({
      method: "POST",
      url: "/api/v1/agents/QA/disable",
    });
    const { approvalId } = requested.json();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/QA/disable",
      payload: { approvalId, decisionReason: "self sign-off" },
    });
    expect(res.statusCode).toBe(403);
    const list = await app.inject({ method: "GET", url: "/api/v1/agents/lifecycle" });
    const qa = list.json().items.find((i: { agentId: string }) => i.agentId === "QA");
    expect(qa.enabled).toBe(true);
  });

  it("an independent admin can decide-and-execute the disable", async () => {
    getRequestUser.mockReturnValue(REQUESTER);
    const requested = await app.inject({
      method: "POST",
      url: "/api/v1/agents/QA/disable",
    });
    const { approvalId } = requested.json();
    getRequestUser.mockReturnValue(DECIDER);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/QA/disable",
      payload: { approvalId, decisionReason: "independent review" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ agentId: "QA", enabled: false, core: false });

    const list = await app.inject({ method: "GET", url: "/api/v1/agents/lifecycle" });
    const qa = list.json().items.find((i: { agentId: string }) => i.agentId === "QA");
    expect(qa.enabled).toBe(false);
  });

  it("403s trying to disable a core agent, with a clear reason", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/ORCHESTRATOR/disable",
    });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message.length).toBeGreaterThan(0);

    const list = await app.inject({ method: "GET", url: "/api/v1/agents/lifecycle" });
    const orchestrator = list
      .json()
      .items.find((i: { agentId: string }) => i.agentId === "ORCHESTRATOR");
    expect(orchestrator.enabled).toBe(true);
  });

  it("400s for an unknown agent id via Zod validation", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/NOT_A_REAL_AGENT/disable",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /api/v1/agents/:id/enable", () => {
  it("403s for a non-admin", async () => {
    getRequestUser.mockReturnValue(adminUser({ role: "user" }));
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/QA/enable",
    });
    expect(res.statusCode).toBe(403);
  });

  it("re-enables a previously disabled non-core agent after independent approval", async () => {
    getRequestUser.mockReturnValue(REQUESTER);
    const disableReq = await app.inject({
      method: "POST",
      url: "/api/v1/agents/QA/disable",
    });
    getRequestUser.mockReturnValue(DECIDER);
    const disable = await app.inject({
      method: "POST",
      url: "/api/v1/agents/QA/disable",
      payload: {
        approvalId: disableReq.json().approvalId,
        decisionReason: "disable first",
      },
    });
    expect(disable.statusCode).toBe(200);

    getRequestUser.mockReturnValue(REQUESTER);
    const enableReq = await app.inject({
      method: "POST",
      url: "/api/v1/agents/QA/enable",
    });
    expect(enableReq.statusCode).toBe(202);
    getRequestUser.mockReturnValue(DECIDER);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/QA/enable",
      payload: {
        approvalId: enableReq.json().approvalId,
        decisionReason: "re-enable",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ agentId: "QA", enabled: true, core: false });
  });

  it("400s for an unknown agent id via Zod validation", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/NOT_A_REAL_AGENT/enable",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });
});

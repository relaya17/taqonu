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

// Same stubbing mechanism as `apps/api/src/routes/admin-ops.test.ts` /
// `apps/api/src/routes/approvals.test.ts`: mock `getRequestUser` from the
// identity-resolution service module so `requireAdmin` (and anything else
// that calls it) sees a fake signed-in user without needing real
// Supabase/local-session cookies.
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

  it("admin can disable a non-core agent and the list reflects it", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/QA/disable",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ agentId: "QA", enabled: false, core: false });

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

  it("re-enables a previously disabled non-core agent", async () => {
    const disable = await app.inject({
      method: "POST",
      url: "/api/v1/agents/QA/disable",
    });
    expect(disable.statusCode).toBe(200);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/QA/enable",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ agentId: "QA", enabled: true, core: false });

    const list = await app.inject({ method: "GET", url: "/api/v1/agents/lifecycle" });
    const qa = list.json().items.find((i: { agentId: string }) => i.agentId === "QA");
    expect(qa.enabled).toBe(true);
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

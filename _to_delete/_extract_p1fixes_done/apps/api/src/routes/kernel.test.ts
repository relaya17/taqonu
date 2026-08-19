import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-kernel-route-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";

// Same stubbing mechanism as `apps/api/src/routes/admin-ops.test.ts` /
// `apps/api/src/middleware/auth-guards.test.ts`: mock `getRequestUser` from
// the identity-resolution service module so `requireSignedInForWrite` sees a
// fake signed-in user without needing real Supabase/local-session cookies.
const getRequestUser = vi.fn();

vi.mock("../services/resolve-identity.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/resolve-identity.js")>();
  return {
    ...actual,
    getRequestUser: (...args: unknown[]) => getRequestUser(...args),
  };
});

const { registerKernelRoutes } = await import("./kernel.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");

let app: FastifyInstance;

function testUser(partial: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    email: "operator@example.com",
    displayName: "Operator",
    role: "user",
    locale: "en",
    provider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

beforeAll(async () => {
  app = await buildRouteTestApp(registerKernelRoutes);
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  getRequestUser.mockReset();
  getRequestUser.mockReturnValue(testUser());
});

describe("GET /api/v1/kernel/status", () => {
  it("reports the kernel model and phase status", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/kernel/status" });
    expect(res.statusCode).toBe(200);
    expect(res.json().model).toBe("AGENT_OPERATING_SYSTEM");
  });
});

describe("GET /api/v1/kernel/agents", () => {
  it("lists every registered fabric agent without throwing (regression: LEGAL_MEDIA_COMMS capability length)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/kernel/agents" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.some((a: { id: string }) => a.id === "LEGAL_MEDIA_COMMS")).toBe(
      true,
    );
  });
});

describe("GET /api/v1/kernel/agents/:id", () => {
  it("404s for an id that isn't a fabric agent", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/kernel/agents/NOT_REAL" });
    expect(res.statusCode).toBe(404);
  });

  it("200s for LEGAL_MEDIA_COMMS specifically (regression for the capability-length crash)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/kernel/agents/LEGAL_MEDIA_COMMS",
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("POST /api/v1/kernel/plan", () => {
  it("400s when request is missing", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/kernel/plan", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("200s and returns a TaskPlan for a normal request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/kernel/plan",
      payload: { request: "review the security posture of the auth flow" },
    });
    expect(res.statusCode).toBe(200);
    const plan = res.json();
    expect(plan.requiredAgents).toContain("ORCHESTRATOR");
  });

  // Regression for the objective(4000) vs request(8000) schema mismatch.
  it("does not 400 for a request between 4001-8000 chars (previously crashed with an internal 'objective' validation error)", async () => {
    const midRequest = "review ".repeat(700); // ~4900 chars
    expect(midRequest.length).toBeGreaterThan(4000);
    expect(midRequest.length).toBeLessThan(8000);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/kernel/plan",
      payload: { request: midRequest },
    });
    expect(res.statusCode).toBe(200);
  });

  it("400s for a request over the public 8000-char limit", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/kernel/plan",
      payload: { request: "x".repeat(8001) },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /api/v1/kernel/run", () => {
  it("200s and returns a full kernel run result for a normal request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/kernel/run",
      payload: { request: "how do I add rate limiting to my API?" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.plan).toBeDefined();
    expect(body.judge).toBeDefined();
  });

  // Regression for the objective(4000) vs request(8000) schema mismatch,
  // exercised through the real HTTP boundary this time.
  it("does not 400 for a request between 4001-8000 chars", async () => {
    const midRequest = "review ".repeat(700);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/kernel/run",
      payload: { request: midRequest },
    });
    expect(res.statusCode).toBe(201);
  });

  it("400s for a missing request body (once past the auth guard)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/kernel/run", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  // P0 fix: this route previously had NO auth guard and NO entity-policy
  // coverage at all — anyone could trigger a kernel run.
  it("401s for an unauthenticated caller (no auth guard previously existed here)", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/kernel/run",
      payload: { request: "how do I add rate limiting to my API?" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("threads the real authenticated actor id into the kernel.run evaluation.completed domain event", async () => {
    const { osStore } = await import("../store/os-store.js");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/kernel/run",
      payload: { request: "record my actor id please" },
    });
    expect(res.statusCode).toBe(201);
    const events = osStore.listDomainEvents();
    const kernelRunEvent = [...events]
      .reverse()
      .find(
        (e) =>
          e.type === "evaluation.completed" &&
          (e.payload as { kind?: string }).kind === "kernel.run",
      );
    expect(kernelRunEvent).toBeDefined();
    expect((kernelRunEvent?.payload as { actorId?: string }).actorId).toBe(
      testUser().id,
    );
  });
});

describe("POST /api/v1/kernel/improve", () => {
  it("401s for an unauthenticated caller (no auth guard previously existed here)", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({ method: "POST", url: "/api/v1/kernel/improve" });
    expect(res.statusCode).toBe(401);
  });

  it("201s and runs self-improvement for a signed-in caller", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/kernel/improve" });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(Array.isArray(body.created)).toBe(true);
    expect(Array.isArray(body.rules)).toBe(true);
  });
});

describe("POST /api/v1/kernel/eval/run", () => {
  it("200s with an empty body (defaults apply) and returns an accuracy score", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/kernel/eval/run" });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.accuracy).toBeGreaterThanOrEqual(0);
    expect(body.accuracy).toBeLessThanOrEqual(1);
  });
});

describe("GET/POST /api/v1/kernel/memory/lessons", () => {
  it("GET lists seeded lessons", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/kernel/memory/lessons" });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.length).toBeGreaterThan(0);
  });

  it("POST 400s when required fields are missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/kernel/memory/lessons",
      payload: { title: "only a title" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST 201s and records a new lesson", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/kernel/memory/lessons",
      payload: {
        pattern: "TEST_ROUTE_PATTERN",
        title: "route test lesson",
        summary: "a summary",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().pattern).toBe("TEST_ROUTE_PATTERN");
  });
});

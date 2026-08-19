import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";
import { memorySchema } from "@atlas/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-agent-fabric-route-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";

// Same stubbing mechanism as `apps/api/src/routes/admin-ops.test.ts`: mock
// `getRequestUser` so `requireSignedInForWrite`/`requireUser` see a fake
// signed-in user (or nobody, for the 401 tests) without needing a real
// cookie/session fixture.
const getRequestUser = vi.fn();

vi.mock("../services/resolve-identity.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/resolve-identity.js")>();
  return {
    ...actual,
    getRequestUser: (...args: unknown[]) => getRequestUser(...args),
  };
});

// Same mocking mechanism as `apps/api/src/routes/gates.test.ts`: leave
// `authorizeEntityAction` wired to the REAL implementation by default (so
// the normal-caller regression tests exercise the genuine policy engine,
// not a stub), but let individual tests force a specific decision (e.g.
// DENIED) to prove the route actually enforces whatever the Policy Engine
// decides rather than only checking that some function got called.
const authorizeEntityAction = vi.fn();

vi.mock("@atlas/agent-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@atlas/agent-core")>();
  return {
    ...actual,
    authorizeEntityAction: (
      ...args: Parameters<typeof actual.authorizeEntityAction>
    ) => authorizeEntityAction(...args) ?? actual.authorizeEntityAction(...args),
  };
});

const { registerAgentFabricRoutes } = await import("./agent-fabric.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { osStore } = await import("../store/os-store.js");

let app: FastifyInstance;

const OWNER_A: AuthUser = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  email: "owner-a@example.com",
  displayName: "Owner A",
  role: "user",
  locale: "en",
  provider: "local",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const OWNER_B: AuthUser = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  email: "owner-b@example.com",
  displayName: "Owner B",
  role: "user",
  locale: "en",
  provider: "local",
  createdAt: "2026-01-01T00:00:00.000Z",
};

/** Global-scope (projectId: null) ACTIVE memory owned by `ownerId`. */
function globalMemory(statement: string, ownerId: string) {
  const now = new Date().toISOString();
  return memorySchema.parse({
    id: crypto.randomUUID(),
    ownerId,
    type: "LESSON",
    projectId: null,
    statement,
    reason: ["test"],
    status: "ACTIVE",
    confidence: 0.7,
    category: "GENERATED_REASONING",
    epistemicState: "OBSERVED",
    observationMode: "OBSERVED",
    source: "test",
    sourceType: "SYSTEM",
    sourceId: null,
    evidence: [],
    supersededBy: null,
    validFrom: now,
    validUntil: null,
    observedAt: now,
    createdAt: now,
    updatedAt: now,
    createdBy: "test",
    scope: "GLOBAL",
    priority: "MEDIUM",
  });
}

beforeAll(async () => {
  app = await buildRouteTestApp(registerAgentFabricRoutes);
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  getRequestUser.mockReset();
  // Signed in as Owner A by default — individual tests override this to
  // simulate an unauthenticated caller (mockReturnValue(null)) or a
  // different tenant.
  getRequestUser.mockReturnValue(OWNER_A);
  authorizeEntityAction.mockReset();
  authorizeEntityAction.mockReturnValue(undefined);
});

describe("GET /api/v1/agents", () => {
  it("lists every fabric agent, including LEGAL_MEDIA_COMMS, without throwing", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/agents" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.some((a: { id: string }) => a.id === "LEGAL_MEDIA_COMMS")).toBe(
      true,
    );
  });
});

describe("GET /api/v1/agents/:id", () => {
  it("404s for an unknown agent id", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/agents/NOT_REAL" });
    expect(res.statusCode).toBe(404);
  });

  it("200s for a known agent id", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/agents/SECURITY" });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe("SECURITY");
  });
});

describe("POST /api/v1/agents/plan", () => {
  it("401s for an unauthenticated caller — no signed-in user, no memory leak", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/plan",
      payload: { request: "fix the login bug" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("400s when request is missing (signed in)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/agents/plan", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("200s and includes a memoryContext alongside the plan", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/plan",
      payload: { request: "fix the login bug" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.steps.length).toBeGreaterThan(0);
    expect(body.memoryContext).toBeDefined();
  });

  it("does not 400 for a long (>4000, <=8000 char) request — agentPlanRequestSchema.request has no internal-field mismatch like kernel/plan did", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/plan",
      payload: { request: "fix ".repeat(1500) }, // 7500 chars
    });
    expect(res.statusCode).toBe(200);
  });

  it("only returns the signed-in caller's own tenant memories — never another owner's (P0 tenant-isolation fix)", async () => {
    osStore.addMemory(globalMemory("owner A's private incident note", OWNER_A.id));
    osStore.addMemory(globalMemory("owner B's private incident note", OWNER_B.id));

    getRequestUser.mockReturnValue(OWNER_A);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/plan",
      payload: { request: "incident note" },
    });
    expect(res.statusCode).toBe(200);
    const statements = res
      .json()
      .memoryContext.items.map((m: { statement: string }) => m.statement);
    expect(statements).toContain("owner A's private incident note");
    expect(statements).not.toContain("owner B's private incident note");
  });

  it("does NOT call the Policy Engine (authorizeEntityAction) — planning is a proposal only, mirroring kernel.ts's plan-vs-run split", async () => {
    // Force a DENIED decision; if /agents/plan ever started calling
    // authorizeEntityAction, this would flip the response to a 403 and
    // catch the regression.
    authorizeEntityAction.mockReturnValue({
      decision: "DENIED",
      reason: "should never be reached by /agents/plan",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/plan",
      payload: { request: "fix the login bug" },
    });
    expect(res.statusCode).toBe(200);
    expect(authorizeEntityAction).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/agents/dispatch", () => {
  it("401s for an unauthenticated caller — no signed-in user, no memory leak", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/dispatch",
      payload: { request: "fix the login bug" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s when the Policy Engine (authorizeEntityAction) denies CONFIGURATION.EXECUTE — the confirmed gap this fix closes: dispatch used to call it not at all", async () => {
    authorizeEntityAction.mockReturnValue({
      decision: "DENIED",
      reason: "test-forced denial",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/dispatch",
      payload: { request: "fix the login bug" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
    expect(res.json().error.message).toMatch(/test-forced denial/);
  });

  it("403s when the Policy Engine returns APPROVAL_REQUIRED for CONFIGURATION.EXECUTE (not silently treated as allowed)", async () => {
    authorizeEntityAction.mockReturnValue({
      decision: "APPROVAL_REQUIRED",
      policy: {
        entityType: "CONFIGURATION",
        action: "EXECUTE",
        risk: "DESTRUCTIVE",
        requiresApproval: true,
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/dispatch",
      payload: { request: "fix the login bug" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("201s and returns runs + a judge decision", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/dispatch",
      payload: { request: "fix the login bug" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.runs.length).toBeGreaterThan(0);
    expect(body.judge).toBeDefined();
  });

  it("400s for an empty request string", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/dispatch",
      payload: { request: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("persists totalCostUsd + a per-run runCosts breakdown onto the agents.dispatch audit entry", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/dispatch",
      payload: { request: "fix the login bug" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();

    const auditEntry = osStore
      .listAudit()
      .find(
        (e): e is Record<string, unknown> =>
          typeof e === "object" &&
          e !== null &&
          (e as { type?: unknown }).type === "agents.dispatch" &&
          (e as { id?: unknown }).id === body.id,
      );
    expect(auditEntry).toBeDefined();
    expect(typeof auditEntry?.totalCostUsd).toBe("number");
    // Sums the same per-run costUsd values already present in the HTTP
    // response — the audit entry no longer drops them.
    const expectedTotal = body.runs.reduce(
      (sum: number, r: { costUsd: number }) => sum + r.costUsd,
      0,
    );
    expect(auditEntry?.totalCostUsd).toBeCloseTo(expectedTotal, 6);
    expect(Array.isArray(auditEntry?.runCosts)).toBe(true);
    expect((auditEntry?.runCosts as unknown[]).length).toBe(body.runs.length);
    for (const [i, run] of (
      auditEntry?.runCosts as Array<{ agentId: string; costUsd: number }>
    ).entries()) {
      expect(run.agentId).toBe(body.runs[i].agentId);
      expect(run.costUsd).toBe(body.runs[i].costUsd);
    }
  });

  it("only returns the signed-in caller's own tenant memories — never another owner's (P0 tenant-isolation fix)", async () => {
    osStore.addMemory(globalMemory("owner A's dispatch-only secret", OWNER_A.id));
    osStore.addMemory(globalMemory("owner B's dispatch-only secret", OWNER_B.id));

    getRequestUser.mockReturnValue(OWNER_A);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/agents/dispatch",
      payload: { request: "dispatch-only secret" },
    });
    expect(res.statusCode).toBe(201);
    const statements = res
      .json()
      .memoryContext.items.map((m: { statement: string }) => m.statement);
    expect(statements).toContain("owner A's dispatch-only secret");
    expect(statements).not.toContain("owner B's dispatch-only secret");
  });
});

describe("POST /api/v1/judge/evaluate", () => {
  it("400s when runs array is empty", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/judge/evaluate",
      payload: { runs: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("200s and approves a clean, fully-evidenced run", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/judge/evaluate",
      payload: {
        runs: [
          {
            agentId: "ARCHITECT",
            status: "COMPLETED",
            summary: "architecture review complete",
            claims: ["c1"],
            evidenceRefs: ["e1"],
            epistemicState: "INFERRED",
            costUsd: 0.01,
            durationMs: 5,
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().decision).toBe("APPROVE");
  });
});

describe("knowledge routes", () => {
  it("GET /api/v1/knowledge/verified-sources 200s with an allow-list", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/knowledge/verified-sources" });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().items)).toBe(true);
  });

  it("POST /api/v1/knowledge/search 400s without a query", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/knowledge/search",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  // The route checks requireSignedInForWrite() before the URL allow-list, so
  // an unauthenticated request is correctly rejected with 401 first — the
  // allow-list's 403 only applies to signed-in callers. Covering the
  // allow-list rejection itself would need a full auth-session fixture,
  // which is out of scope for this route-level pass.
  it("POST /api/v1/knowledge/ingest 401s (not signed in) before ever reaching the URL allow-list check", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/knowledge/ingest",
      payload: {
        title: "t",
        excerpt: "e",
        sourceClass: "BLOG",
        url: "https://some-random-blog.example.com/post",
      },
    });
    expect(res.statusCode).toBe(401);
  });
});

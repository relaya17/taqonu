import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

// Isolate the singleton osStore before it's ever imported/loaded.
const tmpDir = mkdtempSync(join(tmpdir(), "atlas-qa-route-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";
process.env.ATLAS_SKIP_EVENT_DISPATCH = "1";

// Same mechanism used by memory.test.ts / projects.test.ts: stub
// `getRequestUser` (the function `requireUser`/`requireSignedInForWrite`
// ultimately calls) so a route test can simulate a signed-in caller without
// a real Supabase/local session cookie.
const getRequestUser = vi.fn();
vi.mock("../services/resolve-identity.js", () => ({
  getRequestUser: (...args: unknown[]) => getRequestUser(...args),
}));

// Same stubbing mechanism as memory.test.ts / projects.test.ts: spread the
// real `@atlas/agent-core` module and only stub `authorizeEntityAction` so
// individual tests can force a DENIED decision.
const authorizeEntityActionMock = vi.fn();
vi.mock("@atlas/agent-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@atlas/agent-core")>();
  return {
    ...actual,
    authorizeEntityAction: (
      ...args: Parameters<typeof actual.authorizeEntityAction>
    ) => authorizeEntityActionMock(...args) ?? actual.authorizeEntityAction(...args),
  };
});

const { registerQaRoutes } = await import("./qa.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { osStore } = await import("../store/os-store.js");

function signedInUser(partial: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    email: "owner@example.com",
    displayName: "Owner",
    role: "user",
    locale: "en",
    provider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

const ownerA = signedInUser();
const ownerB = signedInUser({
  id: "33333333-3333-4333-8333-333333333333",
  email: "other@example.com",
});

function seedGlobalMemory(ownerId: string, statement: string) {
  osStore.ensureLoaded();
  const now = new Date().toISOString();
  osStore.addMemory({
    id: crypto.randomUUID(),
    ownerId,
    type: "LESSON",
    projectId: null,
    statement,
    reason: ["seed"],
    status: "ACTIVE",
    confidence: 0.9,
    category: "GENERATED_REASONING",
    epistemicState: "OBSERVED",
    observationMode: "OBSERVED",
    source: "seed",
    sourceType: "SYSTEM",
    sourceId: null,
    evidence: [],
    supersededBy: null,
    validFrom: now,
    validUntil: null,
    observedAt: now,
    createdAt: now,
    updatedAt: now,
    createdBy: "seed",
    scope: "GLOBAL",
    priority: "MEDIUM",
  });
}

function seedProject(id: string, slug: string) {
  osStore.ensureLoaded();
  const now = new Date().toISOString();
  osStore.upsertProject({
    id,
    slug,
    name: slug,
    description: null,
    status: "ACTIVE",
    techStack: [],
    createdAt: now,
    updatedAt: now,
  });
}

let app: FastifyInstance;

beforeAll(async () => {
  // qa.ts's POST /qa/runs and /qa/process-audit log via `app.atlasLogger`
  // (only decorated by the full create-app.ts bootstrap, not by the minimal
  // route-test harness) — stub it so those calls don't throw.
  app = await buildRouteTestApp(async (fastifyApp) => {
    fastifyApp.decorate("atlasLogger", {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    } as unknown as FastifyInstance["atlasLogger"]);
    await registerQaRoutes(fastifyApp);
  });
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  authorizeEntityActionMock.mockReset();
});

describe("POST /api/v1/qa/learn", () => {
  it("401s when not signed in", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/qa/learn",
      payload: { patternKey: "pattern-a" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("201s and records the learned key when signed in", async () => {
    getRequestUser.mockReturnValue(ownerA);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/qa/learn",
      payload: { patternKey: "pattern-a" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().learnedPatternKeys).toContain("pattern-a");
  });

  it("403s when the Policy Engine denies CONFIGURATION.UPDATE (entity-policy gate wiring)", async () => {
    getRequestUser.mockReturnValue(ownerA);
    authorizeEntityActionMock.mockReturnValue({
      decision: "DENIED",
      reason: "test-forced denial",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/qa/learn",
      payload: { patternKey: "pattern-a" },
    });
    expect(res.statusCode).toBe(403);
    expect(authorizeEntityActionMock).toHaveBeenCalledWith(
      "CONFIGURATION",
      "UPDATE",
      expect.objectContaining({ mode: "WRITE" }),
    );
  });
});

describe("DELETE /api/v1/qa/learn", () => {
  it("401s when not signed in", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "DELETE",
      url: "/api/v1/qa/learn",
      payload: { patternKey: "pattern-a" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("200s and removes the learned key when signed in", async () => {
    getRequestUser.mockReturnValue(ownerA);
    const res = await app.inject({
      method: "DELETE",
      url: "/api/v1/qa/learn",
      payload: { patternKey: "pattern-a" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().learnedPatternKeys).not.toContain("pattern-a");
  });
});

describe("POST /api/v1/qa/runs", () => {
  it("401s when not signed in", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/qa/runs",
      payload: { scope: "ENTIRE_PORTFOLIO" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("a signed-in caller only ever sees their own tenant's memory content, never another tenant's", async () => {
    seedGlobalMemory(ownerA.id, "distinctivephrase owner-A qa lesson");
    seedGlobalMemory(ownerB.id, "distinctivephrase owner-B qa lesson");

    getRequestUser.mockReturnValue(ownerA);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/qa/runs",
      payload: {
        scope: "ENTIRE_PORTFOLIO",
        userRequest: "distinctivephrase",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    const statements = body.memoryContext.items.map(
      (m: { statement: string }) => m.statement,
    );
    expect(statements).toContain("distinctivephrase owner-A qa lesson");
    expect(statements).not.toContain("distinctivephrase owner-B qa lesson");
  });

  it("a different signed-in caller only sees their own memory, confirming isolation both ways", async () => {
    getRequestUser.mockReturnValue(ownerB);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/qa/runs",
      payload: {
        scope: "ENTIRE_PORTFOLIO",
        userRequest: "distinctivephrase",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    const statements = body.memoryContext.items.map(
      (m: { statement: string }) => m.statement,
    );
    expect(statements).toContain("distinctivephrase owner-B qa lesson");
    expect(statements).not.toContain("distinctivephrase owner-A qa lesson");
  });
});

describe("POST /api/v1/qa/process-audit", () => {
  it("401s when not signed in", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/qa/process-audit",
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it("201s for a signed-in caller with no projectId", async () => {
    getRequestUser.mockReturnValue(ownerA);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/qa/process-audit",
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBeDefined();
  });

  it("claims an unowned project for the first signed-in caller who audits it", async () => {
    seedProject("55555555-5555-4555-8555-555555555555", "audited-project");
    getRequestUser.mockReturnValue(ownerA);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/qa/process-audit",
      payload: { projectId: "55555555-5555-4555-8555-555555555555" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("403s when a different caller tries to audit a project owned by someone else", async () => {
    getRequestUser.mockReturnValue(ownerB);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/qa/process-audit",
      payload: { projectId: "55555555-5555-4555-8555-555555555555" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("404s when the projectId doesn't exist", async () => {
    getRequestUser.mockReturnValue(ownerA);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/qa/process-audit",
      payload: { projectId: "66666666-6666-4666-8666-666666666666" },
    });
    expect(res.statusCode).toBe(404);
  });
});

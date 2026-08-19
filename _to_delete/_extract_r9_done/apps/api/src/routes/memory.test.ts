import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-memory-route-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";
process.env.ATLAS_SKIP_EVENT_DISPATCH = "1";

// Same mechanism used by projects.test.ts / graph.test.ts: stub
// `getRequestUser` (the function `requireUser` ultimately calls) so a route
// test can simulate a signed-in caller without a real Supabase/local
// session cookie.
const getRequestUser = vi.fn();
vi.mock("../services/resolve-identity.js", () => ({
  getRequestUser: (...args: unknown[]) => getRequestUser(...args),
}));

// memory.ts (POST) resolves ownerId via `resolveCloudIdentity` (not
// `getRequestUser` directly) — same pattern as billing.test.ts.
const resolveCloudIdentity = vi.fn();
vi.mock("../services/cloud-identity.js", () => ({
  resolveCloudIdentity: (...args: unknown[]) => resolveCloudIdentity(...args),
}));

const { registerMemoryRoutes } = await import("./memory.js");
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
const adminUser = signedInUser({
  id: "44444444-4444-4444-8444-444444444444",
  email: "admin@example.com",
  role: "admin",
});

function cloudIdentityFor(user: AuthUser) {
  return {
    ownerId: user.id,
    userAccessToken: null,
    setCookie: null,
    source: "local_session" as const,
  };
}

function seedMemory(ownerId: string, statement: string, projectId: string | null = null) {
  osStore.ensureLoaded();
  const now = new Date().toISOString();
  osStore.addMemory({
    id: crypto.randomUUID(),
    ownerId,
    type: "LESSON",
    projectId,
    statement,
    reason: ["seed"],
    status: "ACTIVE",
    confidence: 0.7,
    category: "GENERATED_REASONING",
    epistemicState: "INFERRED",
    observationMode: "INFERRED",
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
    scope: projectId ? "PROJECT" : "GLOBAL",
    priority: "MEDIUM",
  });
}

let app: FastifyInstance;

beforeAll(async () => {
  // Force `isLiveSupabase` false so the POST route's best-effort cloud
  // dual-write never attempts a real Supabase network call during tests.
  app = await buildRouteTestApp(registerMemoryRoutes, {
    SUPABASE_SERVICE_ROLE_KEY: "replace-me",
  });
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("GET /api/v1/memory", () => {
  it("401s when not signed in", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({ method: "GET", url: "/api/v1/memory" });
    expect(res.statusCode).toBe(401);
  });

  it("list mode only returns the caller's own memories, not another tenant's", async () => {
    seedMemory(ownerA.id, "owner A private note");
    seedMemory(ownerB.id, "owner B private note");
    getRequestUser.mockReturnValue(ownerA);

    const res = await app.inject({ method: "GET", url: "/api/v1/memory" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const statements = body.items.map((m: { statement: string }) => m.statement);
    expect(statements).toContain("owner A private note");
    expect(statements).not.toContain("owner B private note");
  });

  it("retrieve mode also scopes by ownerId", async () => {
    getRequestUser.mockReturnValue(ownerA);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/memory?mode=retrieve&budget=20",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const statements = body.items.map((m: { statement: string }) => m.statement);
    expect(statements).toContain("owner A private note");
    expect(statements).not.toContain("owner B private note");
  });

  it("admin sees memories across all owners", async () => {
    getRequestUser.mockReturnValue(adminUser);
    const res = await app.inject({ method: "GET", url: "/api/v1/memory" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const statements = body.items.map((m: { statement: string }) => m.statement);
    expect(statements).toContain("owner A private note");
    expect(statements).toContain("owner B private note");
  });
});

describe("GET /api/v1/memory/pending", () => {
  it("401s when not signed in", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({ method: "GET", url: "/api/v1/memory/pending" });
    expect(res.statusCode).toBe(401);
  });

  it("only includes the caller's own pending memories", async () => {
    osStore.ensureLoaded();
    const now = new Date().toISOString();
    osStore.addMemory({
      id: crypto.randomUUID(),
      ownerId: ownerA.id,
      type: "LESSON",
      projectId: null,
      statement: "owner A pending item",
      reason: [],
      status: "ACTIVE",
      confidence: 0.5,
      category: "GENERATED_REASONING",
      epistemicState: "PROPOSED",
      observationMode: "INFERRED",
      source: "seed",
      sourceType: "SYSTEM",
      sourceId: null,
      evidence: [],
      supersededBy: null,
      validFrom: null,
      validUntil: null,
      observedAt: null,
      createdAt: now,
      updatedAt: now,
      createdBy: "seed",
      scope: "GLOBAL",
      priority: "MEDIUM",
    });
    osStore.addMemory({
      id: crypto.randomUUID(),
      ownerId: ownerB.id,
      type: "LESSON",
      projectId: null,
      statement: "owner B pending item",
      reason: [],
      status: "ACTIVE",
      confidence: 0.5,
      category: "GENERATED_REASONING",
      epistemicState: "PROPOSED",
      observationMode: "INFERRED",
      source: "seed",
      sourceType: "SYSTEM",
      sourceId: null,
      evidence: [],
      supersededBy: null,
      validFrom: null,
      validUntil: null,
      observedAt: null,
      createdAt: now,
      updatedAt: now,
      createdBy: "seed",
      scope: "GLOBAL",
      priority: "MEDIUM",
    });

    getRequestUser.mockReturnValue(ownerA);
    const res = await app.inject({ method: "GET", url: "/api/v1/memory/pending" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const statements = body.items.map((m: { statement: string }) => m.statement);
    expect(statements).toContain("owner A pending item");
    expect(statements).not.toContain("owner B pending item");
  });
});

describe("GET /api/v1/memory/moat", () => {
  it("401s when not signed in", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({ method: "GET", url: "/api/v1/memory/moat" });
    expect(res.statusCode).toBe(401);
  });

  it("scopes aggregate counts to the caller's own memories", async () => {
    getRequestUser.mockReturnValue(ownerB);
    const res = await app.inject({ method: "GET", url: "/api/v1/memory/moat" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const statements = body.top.map((m: { statement: string }) => m.statement);
    expect(statements.some((s: string) => s.includes("owner A"))).toBe(false);
  });
});

describe("POST /api/v1/memory/:id/approve", () => {
  it("401s when not signed in", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/memory/${crypto.randomUUID()}/approve`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("cannot approve another tenant's memory (404, not a permission-revealing error)", async () => {
    osStore.ensureLoaded();
    const now = new Date().toISOString();
    const otherMemoryId = crypto.randomUUID();
    osStore.addMemory({
      id: otherMemoryId,
      ownerId: ownerB.id,
      type: "LESSON",
      projectId: null,
      statement: "owner B memory that owner A must not be able to approve",
      reason: [],
      status: "ACTIVE",
      confidence: 0.5,
      category: "GENERATED_REASONING",
      epistemicState: "PROPOSED",
      observationMode: "INFERRED",
      source: "seed",
      sourceType: "SYSTEM",
      sourceId: null,
      evidence: [],
      supersededBy: null,
      validFrom: null,
      validUntil: null,
      observedAt: null,
      createdAt: now,
      updatedAt: now,
      createdBy: "seed",
      scope: "GLOBAL",
      priority: "MEDIUM",
    });

    getRequestUser.mockReturnValue(ownerA);
    resolveCloudIdentity.mockResolvedValue(cloudIdentityFor(ownerA));
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/memory/${otherMemoryId}/approve`,
    });
    expect(res.statusCode).toBe(404);

    // Still belongs to owner B, unchanged and unpromoted.
    getRequestUser.mockReturnValue(ownerB);
    const check = await app.inject({ method: "GET", url: "/api/v1/memory" });
    const mine = check
      .json()
      .items.find((m: { id: string }) => m.id === otherMemoryId);
    expect(mine.epistemicState).toBe("PROPOSED");
  });

  it("an authenticated caller can still approve their own memory", async () => {
    osStore.ensureLoaded();
    const now = new Date().toISOString();
    const ownMemoryId = crypto.randomUUID();
    osStore.addMemory({
      id: ownMemoryId,
      ownerId: ownerA.id,
      type: "LESSON",
      projectId: null,
      statement: "owner A memory pending approval",
      reason: [],
      status: "ACTIVE",
      confidence: 0.5,
      category: "GENERATED_REASONING",
      epistemicState: "PROPOSED",
      observationMode: "INFERRED",
      source: "seed",
      sourceType: "SYSTEM",
      sourceId: null,
      evidence: [],
      supersededBy: null,
      validFrom: null,
      validUntil: null,
      observedAt: null,
      createdAt: now,
      updatedAt: now,
      createdBy: "seed",
      scope: "GLOBAL",
      priority: "MEDIUM",
    });

    getRequestUser.mockReturnValue(ownerA);
    resolveCloudIdentity.mockResolvedValue(cloudIdentityFor(ownerA));
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/memory/${ownMemoryId}/approve`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().epistemicState).toBe("CONFIRMED");
  });
});

describe("POST /api/v1/memory", () => {
  it("binds the new memory to the resolved caller's ownerId, not a client-supplied value", async () => {
    getRequestUser.mockReturnValue(ownerA);
    resolveCloudIdentity.mockResolvedValue(cloudIdentityFor(ownerA));

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/memory",
      payload: {
        type: "LESSON",
        statement: "Prefer immutable data structures here.",
        category: "GENERATED_REASONING",
        epistemicState: "INFERRED",
        observationMode: "INFERRED",
        source: "unit-test",
        sourceType: "USER",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.ownerId).toBe(ownerA.id);
  });

  it("redacts a fake API key found in the statement and evidence excerpt before persisting", async () => {
    getRequestUser.mockReturnValue(ownerA);
    resolveCloudIdentity.mockResolvedValue(cloudIdentityFor(ownerA));

    const leakedKey = "api_key: AKIAABCDEFGHIJKLMNOP";
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/memory",
      payload: {
        type: "LESSON",
        statement: `Deploy note — ${leakedKey} was used in the script.`,
        category: "GENERATED_REASONING",
        epistemicState: "INFERRED",
        observationMode: "INFERRED",
        source: "unit-test",
        sourceType: "USER",
        evidence: [
          {
            kind: "log_excerpt",
            reference: "deploy.log",
            excerpt: `line 42: ${leakedKey}`,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.statement).not.toContain("AKIAABCDEFGHIJKLMNOP");
    expect(body.statement).toContain("[REDACTED_SECRET]");
    expect(body.evidence[0].excerpt).not.toContain("AKIAABCDEFGHIJKLMNOP");
    expect(body.evidence[0].excerpt).toContain("[REDACTED_SECRET]");
  });

  it("downgrades a self-reported sourceType claiming FACT down to PROPOSED (poisoning gate)", async () => {
    getRequestUser.mockReturnValue(ownerA);
    resolveCloudIdentity.mockResolvedValue(cloudIdentityFor(ownerA));

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/memory",
      payload: {
        type: "FACT",
        statement: "The production API is fully migrated to the new schema.",
        category: "REPOSITORY_EVIDENCE",
        epistemicState: "FACT",
        observationMode: "OBSERVED",
        source: "agent-run",
        sourceType: "AGENT",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.epistemicState).toBe("PROPOSED");
  });

  it("a caller cannot see another tenant's memory created via POST", async () => {
    getRequestUser.mockReturnValue(ownerB);
    resolveCloudIdentity.mockResolvedValue(cloudIdentityFor(ownerB));
    await app.inject({
      method: "POST",
      url: "/api/v1/memory",
      payload: {
        type: "LESSON",
        statement: "owner B's freshly created secret note",
        category: "GENERATED_REASONING",
        epistemicState: "INFERRED",
        observationMode: "INFERRED",
        source: "unit-test",
        sourceType: "USER",
      },
    });

    getRequestUser.mockReturnValue(ownerA);
    const res = await app.inject({ method: "GET", url: "/api/v1/memory" });
    const statements = res.json().items.map((m: { statement: string }) => m.statement);
    expect(statements).not.toContain("owner B's freshly created secret note");
  });
});

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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

// Same stubbing mechanism as connections.test.ts / plugins.test.ts: spread
// the real `@atlas/agent-core` module (so `redactSecrets` and the real
// `authorizeEntityAction` still work unmodified by default) and only stub
// `authorizeEntityAction` so individual tests can force a DENIED decision.
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

afterEach(() => {
  authorizeEntityActionMock.mockReset();
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
    expect(body.pageSize).toBe(body.items.length);
    expect(body.total).toBe(body.items.length);
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

describe("GET /api/v1/memory/export", () => {
  it("401s when not signed in", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({ method: "GET", url: "/api/v1/memory/export" });
    expect(res.statusCode).toBe(401);
  });

  it("returns only the caller's memories and does not delete them", async () => {
    seedMemory(ownerA.id, "owner A export row");
    seedMemory(ownerB.id, "owner B export secret");
    getRequestUser.mockReturnValue(ownerA);
    const res = await app.inject({ method: "GET", url: "/api/v1/memory/export" });
    expect(res.statusCode).toBe(200);
    const statements = (res.json().items as Array<{ statement: string }>).map(
      (row) => row.statement,
    );
    expect(statements).toContain("owner A export row");
    expect(statements).not.toContain("owner B export secret");
    expect(res.json().ownerId).toBe(ownerA.id);
    getRequestUser.mockReturnValue(ownerA);
    const still = await app.inject({ method: "GET", url: "/api/v1/memory" });
    expect(
      (still.json().items as Array<{ statement: string }>).map((row) => row.statement),
    ).toContain("owner A export row");
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

  it("an authenticated caller can still approve their own memory (with evidence), and the response carries verifiedBy/verifiedAt", async () => {
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
      // Gate 3 strengthening: non-empty evidence alone is no longer enough
      // (see `hasVerificationSignal()` in memory-pipeline.ts) — `kind:
      // "TEST_RUN"` is one of `evidenceSourceTypeSchema`'s inherently-
      // verified source kinds, so this entry clears the stricter gate too.
      evidence: [
        {
          id: crypto.randomUUID(),
          kind: "TEST_RUN",
          reference: "finding-1",
          excerpt: "supporting evidence excerpt",
        },
      ],
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
    const body = res.json();
    expect(body.epistemicState).toBe("CONFIRMED");
    expect(body.verifiedBy).toBe(ownerA.id);
    expect(body.verifiedAt).toBeTruthy();
  });

  it("rejects approval with 400 (not 404) when the memory's evidence carries no verification signal, and does not promote it", async () => {
    osStore.ensureLoaded();
    const now = new Date().toISOString();
    const unverifiedMemoryId = crypto.randomUUID();
    osStore.addMemory({
      id: unverifiedMemoryId,
      ownerId: ownerA.id,
      type: "LESSON",
      projectId: null,
      statement: "owner A memory with only a bare USER assertion as evidence",
      reason: [],
      status: "ACTIVE",
      confidence: 0.5,
      category: "GENERATED_REASONING",
      epistemicState: "PROPOSED",
      observationMode: "INFERRED",
      source: "seed",
      sourceType: "SYSTEM",
      sourceId: null,
      // Non-empty (clears "no_evidence"), but `kind: "USER"` carries no
      // genuine verification signal — must fail the stricter gate.
      evidence: [
        {
          id: crypto.randomUUID(),
          kind: "USER",
          reference: "conversation-1",
          excerpt: "someone said this is true",
        },
      ],
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
      url: `/api/v1/memory/${unverifiedMemoryId}/approve`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("UNVERIFIED_EVIDENCE");
    // Distinct from both "no_evidence" (also 400, different code) and
    // "not_found" (404) — see `approveMemory()`'s doc comment.
    expect(res.json().error.code).not.toBe("NO_EVIDENCE");

    // Still PROPOSED — never reached CONFIRMED.
    const check = await app.inject({ method: "GET", url: "/api/v1/memory" });
    const mine = check
      .json()
      .items.find((m: { id: string }) => m.id === unverifiedMemoryId);
    expect(mine.epistemicState).toBe("PROPOSED");
  });

  it("rejects approval with 400 (not 404) when the memory has no evidence, and does not promote it", async () => {
    osStore.ensureLoaded();
    const now = new Date().toISOString();
    const noEvidenceMemoryId = crypto.randomUUID();
    osStore.addMemory({
      id: noEvidenceMemoryId,
      ownerId: ownerA.id,
      type: "LESSON",
      projectId: null,
      statement: "owner A memory with no evidence",
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
      url: `/api/v1/memory/${noEvidenceMemoryId}/approve`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("NO_EVIDENCE");

    // Still PROPOSED — never reached CONFIRMED.
    const check = await app.inject({ method: "GET", url: "/api/v1/memory" });
    const mine = check
      .json()
      .items.find((m: { id: string }) => m.id === noEvidenceMemoryId);
    expect(mine.epistemicState).toBe("PROPOSED");
  });
});

describe("POST /api/v1/memory", () => {
  const validPayload = {
    type: "LESSON" as const,
    statement: "Prefer immutable data structures here.",
    category: "GENERATED_REASONING" as const,
    epistemicState: "INFERRED" as const,
    observationMode: "INFERRED" as const,
    source: "unit-test",
    sourceType: "USER" as const,
  };

  it("401s when not signed in (security fix — this route previously had ZERO auth, allowing anonymous memory-poisoning writes into the stub-owner bucket)", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/memory",
      payload: validPayload,
    });
    expect(res.statusCode).toBe(401);
  });

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

  it("403s when the Policy Engine denies RECORD.CREATE (entity-policy gate wiring)", async () => {
    getRequestUser.mockReturnValue(ownerA);
    resolveCloudIdentity.mockResolvedValue(cloudIdentityFor(ownerA));
    authorizeEntityActionMock.mockReturnValue({
      decision: "DENIED",
      reason: "test-forced denial",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/memory",
      payload: validPayload,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toMatch(/test-forced denial/);
    expect(authorizeEntityActionMock).toHaveBeenCalledWith(
      "RECORD",
      "CREATE",
      expect.objectContaining({ mode: "WRITE" }),
    );
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

describe("POST /api/v1/memory/:id/correct", () => {
  it("401s when not signed in", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/memory/${crypto.randomUUID()}/correct`,
      payload: { statement: "corrected statement" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("creates a superseding memory and leaves the original row SUPERSEDED", async () => {
    const originalId = crypto.randomUUID();
    seedMemory(ownerA.id, "old preference about dark theme");
    const seeded = [...osStore.memories.values()]
      .flat()
      .find((row) => row.statement === "old preference about dark theme");
    expect(seeded).toBeDefined();
    const id = seeded?.id ?? originalId;
    getRequestUser.mockReturnValue(ownerA);
    resolveCloudIdentity.mockResolvedValue(cloudIdentityFor(ownerA));
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/memory/${id}/correct`,
      payload: { statement: "prefer light theme in Studio" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.statement).toBe("prefer light theme in Studio");
    expect(body.epistemicState).toBe("PROPOSED");
    expect(body.previousMemoryId).toBe(id);
    expect(body.superseded).toBe(true);

    getRequestUser.mockReturnValue(ownerA);
    const list = await app.inject({ method: "GET", url: "/api/v1/memory" });
    const items = list.json().items as Array<{
      id: string;
      statement: string;
      status: string;
      supersededBy: string | null;
    }>;
    const previous = items.find((row) => row.id === id);
    const next = items.find((row) => row.id === body.id);
    expect(previous?.status).toBe("SUPERSEDED");
    expect(previous?.statement).toBe("old preference about dark theme");
    expect(previous?.supersededBy).toBe(body.id);
    expect(next?.status).toBe("ACTIVE");
  });

  it("cannot correct another tenant's memory (404) and does not delete it", async () => {
    seedMemory(ownerB.id, "owner B private correction target");
    const foreign = [...osStore.memories.values()]
      .flat()
      .find((row) => row.statement === "owner B private correction target");
    expect(foreign).toBeDefined();
    getRequestUser.mockReturnValue(ownerA);
    resolveCloudIdentity.mockResolvedValue(cloudIdentityFor(ownerA));
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/memory/${foreign!.id}/correct`,
      payload: { statement: "stolen correction" },
    });
    expect(res.statusCode).toBe(404);
    getRequestUser.mockReturnValue(ownerB);
    const check = await app.inject({ method: "GET", url: "/api/v1/memory" });
    const mine = check
      .json()
      .items.find((row: { id: string }) => row.id === foreign!.id);
    expect(mine.status).toBe("ACTIVE");
    expect(mine.statement).toBe("owner B private correction target");
  });

  it("409s when the named memory is already superseded", async () => {
    seedMemory(ownerA.id, "first correction source");
    const original = [...osStore.memories.values()]
      .flat()
      .find((row) => row.statement === "first correction source");
    getRequestUser.mockReturnValue(ownerA);
    resolveCloudIdentity.mockResolvedValue(cloudIdentityFor(ownerA));
    const first = await app.inject({
      method: "POST",
      url: `/api/v1/memory/${original!.id}/correct`,
      payload: { statement: "second statement after correct" },
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: "POST",
      url: `/api/v1/memory/${original!.id}/correct`,
      payload: { statement: "third attempt on same id" },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("ALREADY_SUPERSEDED");
  });
});

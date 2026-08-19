import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser, Claim, ProjectStateSnapshot } from "@atlas/shared";

// Isolate the singleton osStore before it's ever imported/loaded (same
// pattern as memory.test.ts / projects.test.ts / commercial.test.ts).
const tmpDir = mkdtempSync(join(tmpdir(), "atlas-conflicts-route-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";
process.env.ATLAS_SKIP_EVENT_DISPATCH = "1";

const getRequestUser = vi.fn();
vi.mock("../services/resolve-identity.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/resolve-identity.js")>();
  return {
    ...actual,
    getRequestUser: (...args: unknown[]) => getRequestUser(...args),
  };
});

// Same stubbing mechanism used across this round's route tests: spread the
// real `@atlas/agent-core` module and only stub `authorizeEntityAction` so
// individual tests can force a DENIED decision while other tests still run
// the real Policy Engine (no-regression coverage).
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

const { registerConflictRoutes } = await import("./conflicts.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { osStore } = await import("../store/os-store.js");
const { bindProjectOwner } = await import("../services/project-access.js");

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

const otherUser = signedInUser({
  id: "33333333-3333-4333-8333-333333333333",
  email: "other@example.com",
});

function makeProject(owner: AuthUser | null) {
  osStore.ensureLoaded();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  osStore.upsertProject({
    id,
    slug: `proj-${id.slice(0, 8)}`,
    name: "Test Project",
    description: null,
    status: "ACTIVE",
    techStack: [],
    createdAt: now,
    updatedAt: now,
  });
  if (owner) {
    bindProjectOwner(id, owner.id, "bound_on_create");
  }
  return id;
}

function makeClaim(projectId: string, overrides: Partial<Claim> = {}): Claim {
  const now = new Date().toISOString();
  const claim: Claim = {
    id: crypto.randomUUID(),
    ownerId: "22222222-2222-4222-8222-222222222222",
    projectId,
    statement: "The service uses PostgreSQL.",
    epistemicState: "OBSERVED",
    confidence: 0.8,
    evidenceIds: [],
    derivedFrom: [],
    source: null,
    authorityRank: "DEVELOPER_STATEMENT",
    verification: { inCode: false, hasTest: false, liveVerified: false },
    observedAt: null,
    verifiedAt: null,
    expiresAt: null,
    asOf: now,
    version: null,
    conflictingClaimIds: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  return claim;
}

/** Seeds a project with a snapshot containing exactly one open conflict
 * between two claims of differing source authority. */
function seedConflict(projectId: string) {
  const claimA = makeClaim(projectId, { authorityRank: "LIVE_PRODUCTION" });
  const claimB = makeClaim(projectId, {
    authorityRank: "LLM_INFERENCE",
    statement: "The service uses MySQL.",
  });
  osStore.claims.set(projectId, [claimA, claimB]);

  const now = new Date().toISOString();
  const conflictId = crypto.randomUUID();
  const snapshot: ProjectStateSnapshot = {
    id: crypto.randomUUID(),
    projectId,
    asOf: now,
    reconciledAt: now,
    slices: [],
    conflicts: [
      {
        id: conflictId,
        sliceKey: "DATABASE",
        claimAId: claimA.id,
        claimBId: claimB.id,
        resolution: null,
        epistemicState: "CONFLICTED",
        detectedAt: now,
      },
    ],
    overallEpistemicState: "UNKNOWN",
    sourceConnectors: ["github"],
  };
  osStore.setSnapshot(snapshot);
  return { conflictId, claimA, claimB };
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildRouteTestApp(registerConflictRoutes);
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  authorizeEntityActionMock.mockReset();
});

describe("GET /api/v1/conflicts", () => {
  it("401s when not signed in (security fix — this route previously had ZERO auth and leaked every tenant's conflicts)", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({ method: "GET", url: "/api/v1/conflicts" });
    expect(res.statusCode).toBe(401);
  });

  it("filters out conflicts belonging to a project owned by someone else", async () => {
    const owner = signedInUser();
    const mineProject = makeProject(owner);
    const foreignProject = makeProject(otherUser);
    const mine = seedConflict(mineProject);
    seedConflict(foreignProject);

    getRequestUser.mockReturnValue(owner);
    const res = await app.inject({ method: "GET", url: "/api/v1/conflicts" });
    expect(res.statusCode).toBe(200);
    const ids = res.json().items.map((i: { id: string }) => i.id);
    expect(ids).toContain(mine.conflictId);
    expect(ids.length).toBe(1);
  });

  it("returns an authority suggestion for the caller's own conflict (no regression)", async () => {
    const owner = signedInUser();
    const projectId = makeProject(owner);
    const { conflictId } = seedConflict(projectId);

    getRequestUser.mockReturnValue(owner);
    const res = await app.inject({ method: "GET", url: "/api/v1/conflicts" });
    expect(res.statusCode).toBe(200);
    const item = res.json().items.find((i: { id: string }) => i.id === conflictId);
    expect(item).toBeDefined();
    expect(item.authoritySuggestion).toContain("Prefer claimA");
    expect(item.resolved).toBe(false);
  });
});

describe("POST /api/v1/conflicts/:id/suggest", () => {
  it("401s when not signed in (security fix — this route previously had ZERO auth)", async () => {
    const owner = signedInUser();
    const projectId = makeProject(owner);
    const { conflictId } = seedConflict(projectId);

    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/conflicts/${conflictId}/suggest`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("404s for a signed-in caller who cannot see the owning project", async () => {
    const owner = signedInUser();
    const projectId = makeProject(owner);
    const { conflictId } = seedConflict(projectId);

    getRequestUser.mockReturnValue(otherUser);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/conflicts/${conflictId}/suggest`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("suggests the higher-authority claim as winner for the owner (no regression)", async () => {
    const owner = signedInUser();
    const projectId = makeProject(owner);
    const { conflictId, claimA } = seedConflict(projectId);

    getRequestUser.mockReturnValue(owner);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/conflicts/${conflictId}/suggest`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().winnerClaimId).toBe(claimA.id);
  });
});

describe("POST /api/v1/conflicts/:id/resolve", () => {
  it("401s when not signed in (security fix — this route previously had ZERO auth/ownership check)", async () => {
    const owner = signedInUser();
    const projectId = makeProject(owner);
    const { conflictId } = seedConflict(projectId);

    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/conflicts/${conflictId}/resolve`,
      payload: { resolution: "Confirmed via production logs", method: "manual" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s for a non-owning signed-in user", async () => {
    const owner = signedInUser();
    const projectId = makeProject(owner);
    const { conflictId } = seedConflict(projectId);

    getRequestUser.mockReturnValue(otherUser);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/conflicts/${conflictId}/resolve`,
      payload: { resolution: "Confirmed via production logs", method: "manual" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("403s when the Policy Engine denies RECORD.UPDATE (entity-policy gate wiring)", async () => {
    const owner = signedInUser();
    const projectId = makeProject(owner);
    const { conflictId } = seedConflict(projectId);

    getRequestUser.mockReturnValue(owner);
    authorizeEntityActionMock.mockReturnValue({
      decision: "DENIED",
      reason: "test-forced denial",
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/conflicts/${conflictId}/resolve`,
      payload: { resolution: "Confirmed via production logs", method: "manual" },
    });
    expect(res.statusCode).toBe(403);
    expect(authorizeEntityActionMock).toHaveBeenCalledWith(
      "RECORD",
      "UPDATE",
      expect.objectContaining({ mode: "WRITE" }),
    );
  });

  it("resolves by authority for the owner and marks the conflict resolved (no regression)", async () => {
    const owner = signedInUser();
    const projectId = makeProject(owner);
    const { conflictId, claimA } = seedConflict(projectId);

    getRequestUser.mockReturnValue(owner);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/conflicts/${conflictId}/resolve`,
      payload: { resolution: "Confirmed via production logs", method: "authority" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.resolved).toBe(true);
    expect(body.winnerClaimId).toBe(claimA.id);

    const listRes = await app.inject({ method: "GET", url: "/api/v1/conflicts" });
    const item = listRes
      .json()
      .items.find((i: { id: string }) => i.id === conflictId);
    expect(item.resolved).toBe(true);
  });
});

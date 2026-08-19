import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-projects-route-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";

// Same mechanism used by portfolio.test.ts / graph.test.ts: stub
// `getRequestUser` (the function `requireUser`/`requireSignedInForWrite`
// ultimately calls) so a route test can simulate a signed-in caller without
// a real Supabase/local session cookie.
const getRequestUser = vi.fn();
vi.mock("../services/resolve-identity.js", () => ({
  getRequestUser: (...args: unknown[]) => getRequestUser(...args),
}));

// Same stubbing mechanism as memory.test.ts / connections.test.ts: spread
// the real `@atlas/agent-core` module and only stub `authorizeEntityAction`
// so individual tests can force a DENIED decision.
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

const { registerProjectRoutes } = await import("./projects.js");
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

const adminUser = signedInUser({
  id: "44444444-4444-4444-8444-444444444444",
  email: "admin@example.com",
  role: "admin",
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

let app: FastifyInstance;
const dirs: string[] = [tmpDir];

beforeAll(async () => {
  app = await buildRouteTestApp(registerProjectRoutes);
});

afterAll(async () => {
  await app.close();
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

afterEach(() => {
  authorizeEntityActionMock.mockReset();
});

describe("GET /api/v1/projects", () => {
  it("401s when not signed in", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({ method: "GET", url: "/api/v1/projects" });
    expect(res.statusCode).toBe(401);
  });

  it("filters out projects owned by someone else, but includes own + unowned", async () => {
    const owner = signedInUser();
    const mineId = makeProject(owner);
    const foreignId = makeProject(otherUser);
    const unownedId = makeProject(null);

    getRequestUser.mockReturnValue(owner);
    const res = await app.inject({ method: "GET", url: "/api/v1/projects" });
    expect(res.statusCode).toBe(200);
    const ids = res.json().items.map((p: { id: string }) => p.id);
    expect(ids).toContain(mineId);
    expect(ids).toContain(unownedId);
    expect(ids).not.toContain(foreignId);
  });

  it("admin sees every project including ones owned by others", async () => {
    const foreignId = makeProject(otherUser);
    getRequestUser.mockReturnValue(adminUser);
    const res = await app.inject({ method: "GET", url: "/api/v1/projects" });
    expect(res.statusCode).toBe(200);
    const ids = res.json().items.map((p: { id: string }) => p.id);
    expect(ids).toContain(foreignId);
  });
});

describe("GET /api/v1/projects/:id", () => {
  it("401s when not signed in", async () => {
    const id = makeProject(null);
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({ method: "GET", url: `/api/v1/projects/${id}` });
    expect(res.statusCode).toBe(401);
  });

  it("404s for an unknown project id", async () => {
    getRequestUser.mockReturnValue(signedInUser());
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${crypto.randomUUID()}`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("403s for a signed-in user who does not own the project", async () => {
    const owner = signedInUser();
    const id = makeProject(owner);
    getRequestUser.mockReturnValue(otherUser);
    const res = await app.inject({ method: "GET", url: `/api/v1/projects/${id}` });
    expect(res.statusCode).toBe(403);
  });

  it("200s for the owning user (no regression)", async () => {
    const owner = signedInUser();
    const id = makeProject(owner);
    getRequestUser.mockReturnValue(owner);
    const res = await app.inject({ method: "GET", url: `/api/v1/projects/${id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(id);
  });

  it("200s for admin regardless of owner", async () => {
    const id = makeProject(otherUser);
    getRequestUser.mockReturnValue(adminUser);
    const res = await app.inject({ method: "GET", url: `/api/v1/projects/${id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(id);
  });
});

describe("GET /api/v1/projects/:id/resume", () => {
  it("401s when not signed in", async () => {
    const id = makeProject(null);
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${id}/resume`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s for a non-owning signed-in user", async () => {
    const owner = signedInUser();
    const id = makeProject(owner);
    getRequestUser.mockReturnValue(otherUser);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${id}/resume`,
    });
    expect(res.statusCode).toBe(403);
  });

  it("200s for the owning user (no regression)", async () => {
    const owner = signedInUser();
    const id = makeProject(owner);
    getRequestUser.mockReturnValue(owner);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${id}/resume`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().projectId).toBe(id);
  });
});

describe("GET /api/v1/projects/:id/context-export", () => {
  it("401s when not signed in", async () => {
    const id = makeProject(null);
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${id}/context-export`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s for a non-owning signed-in user", async () => {
    const owner = signedInUser();
    const id = makeProject(owner);
    getRequestUser.mockReturnValue(otherUser);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${id}/context-export`,
    });
    expect(res.statusCode).toBe(403);
  });

  it("200s for the owning user (no regression)", async () => {
    const owner = signedInUser();
    const id = makeProject(owner);
    getRequestUser.mockReturnValue(owner);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${id}/context-export`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().projectId).toBe(id);
  });
});

/**
 * SECURITY FIX: POST /:id/cloud previously had ZERO auth/ownership check —
 * any caller could trigger a cloud-sync for ANY project id. These tests
 * exercise the "already synced" short-circuit branch (seeded via
 * `osStore.setCloudLink` directly) so the auth/entity-gate wiring can be
 * proven without needing a real/mocked Supabase round trip.
 *
 * Uses its own app instance with `SUPABASE_SERVICE_ROLE_KEY: "replace-me"`
 * (same override billing.test.ts uses) — the already-synced branch still
 * calls `getAccountPlan`, which calls `isLiveSupabase`; the shared `app`
 * above builds with the default non-"replace-me" test key against a
 * non-localhost SUPABASE_URL, which would make `isLiveSupabase` true and
 * send a real (hanging) network call.
 */
describe("POST /api/v1/projects/:id/cloud", () => {
  let cloudApp: FastifyInstance;

  beforeAll(async () => {
    cloudApp = await buildRouteTestApp(registerProjectRoutes, {
      SUPABASE_SERVICE_ROLE_KEY: "replace-me",
    });
  });

  afterAll(async () => {
    await cloudApp.close();
  });

  it("401s when not signed in", async () => {
    const id = makeProject(null);
    getRequestUser.mockReturnValue(null);
    const res = await cloudApp.inject({ method: "POST", url: `/api/v1/projects/${id}/cloud` });
    expect(res.statusCode).toBe(401);
  });

  it("403s for a non-owning signed-in user", async () => {
    const owner = signedInUser();
    const id = makeProject(owner);
    getRequestUser.mockReturnValue(otherUser);
    const res = await cloudApp.inject({ method: "POST", url: `/api/v1/projects/${id}/cloud` });
    expect(res.statusCode).toBe(403);
  });

  it("403s when the Policy Engine denies RECORD.UPDATE (entity-policy gate wiring)", async () => {
    const owner = signedInUser();
    const id = makeProject(owner);
    getRequestUser.mockReturnValue(owner);
    authorizeEntityActionMock.mockReturnValue({
      decision: "DENIED",
      reason: "test-forced denial",
    });
    const res = await cloudApp.inject({ method: "POST", url: `/api/v1/projects/${id}/cloud` });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toMatch(/test-forced denial/);
    expect(authorizeEntityActionMock).toHaveBeenCalledWith(
      "RECORD",
      "UPDATE",
      expect.objectContaining({ mode: "WRITE" }),
    );
  });

  it("200s for the owning user on the already-synced short-circuit path (no regression)", async () => {
    const owner = signedInUser();
    const id = makeProject(owner);
    osStore.setCloudLink(id, {
      cloudProjectId: "cloud-abc",
      syncedAt: "2026-01-01T00:00:00.000Z",
    });
    getRequestUser.mockReturnValue(owner);
    const res = await cloudApp.inject({ method: "POST", url: `/api/v1/projects/${id}/cloud` });
    expect(res.statusCode).toBe(200);
    expect(res.json().alreadySynced).toBe(true);
  });
});

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

/**
 * Seeds a CRITICAL memory on `projectId` — `buildCentralOpinion` copies the
 * first 200 chars of every BUG/HIGH/CRITICAL memory statement into its
 * findings, so this is the exact tenant data the unauthenticated
 * central-opinion routes used to leak.
 */
function seedCriticalMemory(ownerId: string, projectId: string, statement: string) {
  osStore.ensureLoaded();
  const now = new Date().toISOString();
  osStore.addMemory({
    id: crypto.randomUUID(),
    ownerId,
    type: "BUG",
    projectId,
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
    scope: "PROJECT",
    priority: "CRITICAL",
  });
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

/**
 * SECURITY FIX (cross-tenant isolation audit): these five sub-routes checked
 * only that the project existed — no `requireUser`, no ownership check — so a
 * fully anonymous caller who knew a project UUID could read that tenant's
 * reachability, manager reminders, and (worst) the central opinion, which
 * embeds the first 200 chars of every BUG/HIGH/CRITICAL memory statement.
 * They now use the same `assertProjectReadAccess` gate as the sibling
 * `/resume` and `/context-export` routes, hence the identical 401/403/200
 * expectations below.
 */
describe("project read-gate on previously unauthenticated sub-routes", () => {
  const subRoutes = [
    "reachability",
    "central-opinion",
    "central-opinion.html",
    "central-opinion.pdf",
    "manager-reminders",
  ] as const;

  for (const subRoute of subRoutes) {
    describe(`GET /api/v1/projects/:id/${subRoute}`, () => {
      it("401s when not signed in", async () => {
        const id = makeProject(null);
        getRequestUser.mockReturnValue(null);
        const res = await app.inject({
          method: "GET",
          url: `/api/v1/projects/${id}/${subRoute}`,
        });
        expect(res.statusCode).toBe(401);
      });

      it("403s for a non-owning signed-in user", async () => {
        const owner = signedInUser();
        const id = makeProject(owner);
        getRequestUser.mockReturnValue(otherUser);
        const res = await app.inject({
          method: "GET",
          url: `/api/v1/projects/${id}/${subRoute}`,
        });
        expect(res.statusCode).toBe(403);
      });

      it("200s for the owning user (no regression — these are real features)", async () => {
        const owner = signedInUser();
        const id = makeProject(owner);
        getRequestUser.mockReturnValue(owner);
        const res = await app.inject({
          method: "GET",
          url: `/api/v1/projects/${id}/${subRoute}`,
        });
        expect(res.statusCode).toBe(200);
      });

      /**
       * FIX 2: correct status, too-talkative body. The 403 must not name the
       * real owner — that would turn every denial into an account-enumeration
       * oracle (guess a project id, read back the victim's user id).
       */
      it("403 body does not disclose the owner's user id", async () => {
        const owner = signedInUser();
        const id = makeProject(owner);
        getRequestUser.mockReturnValue(otherUser);
        const res = await app.inject({
          method: "GET",
          url: `/api/v1/projects/${id}/${subRoute}`,
        });
        expect(res.statusCode).toBe(403);
        expect(res.body).not.toContain(owner.id);
        // the actor's own id is fine — the caller already knows who they are
        expect(res.json().error.message).toMatch(/does not own/);
      });
    });
  }

  it("central-opinion denial leaks none of the project's memory statements", async () => {
    const owner = signedInUser();
    const id = makeProject(owner);
    const secret = "CRITICAL-MEMORY-SECRET-do-not-leak-across-tenants";
    seedCriticalMemory(owner.id, id, secret);

    // sanity: the owner really can see the statement, so the assertions below
    // are proving the gate works and not that the fixture is empty.
    getRequestUser.mockReturnValue(owner);
    const allowed = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${id}/central-opinion`,
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.body).toContain(secret);

    for (const subRoute of ["central-opinion", "central-opinion.html", "central-opinion.pdf"]) {
      getRequestUser.mockReturnValue(otherUser);
      const denied = await app.inject({
        method: "GET",
        url: `/api/v1/projects/${id}/${subRoute}`,
      });
      expect(denied.statusCode).toBe(403);
      expect(denied.body).not.toContain(secret);
      expect(denied.body).not.toContain(owner.id);
    }

    getRequestUser.mockReturnValue(null);
    const anonymous = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${id}/central-opinion`,
    });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.body).not.toContain(secret);
  });
});

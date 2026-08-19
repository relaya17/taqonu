import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

// Isolate the singleton osStore before it's ever imported/loaded (same
// pattern as conflicts.test.ts / db-feeds.test.ts).
const tmpDir = mkdtempSync(join(tmpdir(), "atlas-systems-route-test-"));
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

const { registerSystemRoutes } = await import("./systems.js");
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

function makeProject(owner: AuthUser | null, slug?: string) {
  osStore.ensureLoaded();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  osStore.upsertProject({
    id,
    slug: slug ?? `proj-${id.slice(0, 8)}`,
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

beforeAll(async () => {
  app = await buildRouteTestApp(registerSystemRoutes);
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  getRequestUser.mockReset();
});

describe("GET /api/v1/systems", () => {
  it("401s when not signed in (security fix — this route previously had ZERO auth and listed every tenant's projects as Managed Systems)", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({ method: "GET", url: "/api/v1/systems" });
    expect(res.statusCode).toBe(401);
  });

  it("filters out systems belonging to a project owned by someone else", async () => {
    const owner = signedInUser();
    const mineProject = makeProject(owner);
    makeProject(otherUser);

    getRequestUser.mockReturnValue(owner);
    const res = await app.inject({ method: "GET", url: "/api/v1/systems" });
    expect(res.statusCode).toBe(200);
    const ids = res.json().items.map((i: { projectId: string | null }) => i.projectId);
    expect(ids).toContain(mineProject);
  });
});

describe("GET /api/v1/systems/:id", () => {
  it("404s for an unknown system id (pre-existing lookup-then-auth ordering, unchanged)", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/systems/${crypto.randomUUID()}`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("401s when not signed in for a system id that does exist (security fix — this route previously had ZERO auth)", async () => {
    const owner = signedInUser();
    const projectId = makeProject(owner);
    getRequestUser.mockReturnValue(owner);
    const list = await app.inject({ method: "GET", url: "/api/v1/systems" });
    const systemId = list
      .json()
      .items.find((i: { projectId: string | null }) => i.projectId === projectId).id;

    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/systems/${systemId}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s for a non-owning signed-in user on a system id that does exist", async () => {
    const owner = signedInUser();
    const projectId = makeProject(owner);
    getRequestUser.mockReturnValue(owner);
    const list = await app.inject({ method: "GET", url: "/api/v1/systems" });
    const systemId = list
      .json()
      .items.find((i: { projectId: string | null }) => i.projectId === projectId).id;

    getRequestUser.mockReturnValue(otherUser);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/systems/${systemId}`,
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("PUT /api/v1/systems/:id/contract", () => {
  it("404s for an unknown system id (pre-existing lookup-then-auth ordering, unchanged)", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/systems/${crypto.randomUUID()}/contract`,
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });
});

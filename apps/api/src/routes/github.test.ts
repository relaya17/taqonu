import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

// Isolate the singleton osStore before it's ever imported/loaded (same
// pattern as conflicts.test.ts / db-feeds.test.ts).
const tmpDir = mkdtempSync(join(tmpdir(), "atlas-github-route-test-"));
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

const { registerGithubRoutes } = await import("./github.js");
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

let app: FastifyInstance;

beforeAll(async () => {
  // github.ts logs via `app.atlasLogger` on several paths (only decorated
  // by the full create-app.ts bootstrap, not by the minimal route-test
  // harness) — stub it so those calls don't throw. Same pattern as
  // qa.test.ts / state.test.ts.
  app = await buildRouteTestApp(async (fastifyApp) => {
    fastifyApp.decorate("atlasLogger", {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    } as unknown as FastifyInstance["atlasLogger"]);
    await registerGithubRoutes(fastifyApp);
  });
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  authorizeEntityActionMock.mockReset();
});

describe("GET /api/v1/github", () => {
  it("401s when not signed in (security fix — this route previously had ZERO auth and leaked every tenant's GitHub App installations)", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({ method: "GET", url: "/api/v1/github" });
    expect(res.statusCode).toBe(401);
  });

  it("200s for a signed-in caller (no regression)", async () => {
    getRequestUser.mockReturnValue(signedInUser());
    const res = await app.inject({ method: "GET", url: "/api/v1/github" });
    expect(res.statusCode).toBe(200);
  });

  it("filters out installations belonging to a project owned by someone else", async () => {
    const owner = signedInUser();
    const mineProject = makeProject(owner);
    const foreignProject = makeProject(otherUser);
    const now = new Date().toISOString();
    osStore.upsertGithubAppInstallation({
      installationId: "mine-1",
      projectId: mineProject,
      accountLogin: "owner-org",
      accountType: "Organization",
      targetType: "Organization",
      repositorySelection: "all",
      setupAction: null,
      suspendedAt: null,
      installedAt: now,
      updatedAt: now,
    });
    osStore.upsertGithubAppInstallation({
      installationId: "foreign-1",
      projectId: foreignProject,
      accountLogin: "other-org",
      accountType: "Organization",
      targetType: "Organization",
      repositorySelection: "all",
      setupAction: null,
      suspendedAt: null,
      installedAt: now,
      updatedAt: now,
    });

    getRequestUser.mockReturnValue(owner);
    const res = await app.inject({ method: "GET", url: "/api/v1/github" });
    expect(res.statusCode).toBe(200);
    const ids = res.json().installations.map(
      (i: { installationId: string }) => i.installationId,
    );
    expect(ids).toContain("mine-1");
    expect(ids).not.toContain("foreign-1");
  });
});

describe("POST /api/v1/github/discover", () => {
  it("401s when not signed in (security fix — this route previously had ZERO auth)", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/github/discover",
      payload: { repositories: [{ fullName: "acme/widgets" }] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s when the Policy Engine denies RECORD.CREATE (entity-policy gate wiring)", async () => {
    getRequestUser.mockReturnValue(signedInUser());
    authorizeEntityActionMock.mockReturnValue({
      decision: "DENIED",
      reason: "test-forced denial",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/github/discover",
      payload: { repositories: [{ fullName: "acme/widgets" }] },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /api/v1/github/sync", () => {
  it("401s when not signed in (security fix — this route previously had ZERO auth)", async () => {
    const projectId = makeProject(null);
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/github/sync",
      payload: { projectId, fullName: "acme/widgets" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s for a non-owning signed-in user", async () => {
    const owner = signedInUser();
    const projectId = makeProject(owner);
    getRequestUser.mockReturnValue(otherUser);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/github/sync",
      payload: { projectId, fullName: "acme/widgets" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("201s for the owner (no regression)", async () => {
    const owner = signedInUser();
    const projectId = makeProject(owner);
    getRequestUser.mockReturnValue(owner);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/github/sync",
      payload: { projectId, fullName: "acme/widgets", reconcile: false },
    });
    expect(res.statusCode).toBe(201);
  });
});

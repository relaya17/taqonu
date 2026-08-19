import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

// Isolate the singleton osStore before it's ever imported/loaded (same
// pattern as conflicts.test.ts / db-feeds.test.ts / github.test.ts).
const tmpDir = mkdtempSync(join(tmpdir(), "atlas-legal-media-route-test-"));
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

const { registerLegalMediaRoutes } = await import("./legal-media.js");
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
  // legal-media.ts logs via `app.atlasLogger` (only decorated by the full
  // create-app.ts bootstrap, not by the minimal route-test harness) — stub
  // it so those calls don't throw. Same pattern as github.test.ts.
  app = await buildRouteTestApp(async (fastifyApp) => {
    fastifyApp.decorate("atlasLogger", {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    } as unknown as FastifyInstance["atlasLogger"]);
    await registerLegalMediaRoutes(fastifyApp);
  });
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  authorizeEntityActionMock.mockReset();
});

describe("GET /api/v1/legal-media/sources", () => {
  it("200s without auth (static allow-listed source catalog, no tenant data, unchanged this round)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/legal-media/sources" });
    expect(res.statusCode).toBe(200);
  });
});

describe("POST /api/v1/legal-media/review", () => {
  it("401s when not signed in and no projectId is given (security fix — this route previously had ZERO auth in the no-projectId case, and never ran an entity/risk/audit gate at all)", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/legal-media/review",
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s for a non-owning signed-in user when projectId is given", async () => {
    const owner = signedInUser();
    const projectId = makeProject(owner);
    getRequestUser.mockReturnValue(otherUser);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/legal-media/review",
      payload: { projectId },
    });
    expect(res.statusCode).toBe(403);
  });

  it("403s when the Policy Engine denies RECORD.EXECUTE (entity-policy gate wiring)", async () => {
    getRequestUser.mockReturnValue(signedInUser());
    authorizeEntityActionMock.mockReturnValue({
      decision: "DENIED",
      reason: "test-forced denial",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/legal-media/review",
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it("200s for a signed-in caller with no projectId (no regression)", async () => {
    getRequestUser.mockReturnValue(signedInUser());
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/legal-media/review",
      payload: {},
    });
    expect(res.statusCode).toBe(200);
  });

  it("200s for the owner when projectId is given (no regression)", async () => {
    const owner = signedInUser();
    const projectId = makeProject(owner);
    getRequestUser.mockReturnValue(owner);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/legal-media/review",
      payload: { projectId },
    });
    expect(res.statusCode).toBe(200);
  });
});

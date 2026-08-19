import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser, PatchArtifact } from "@atlas/shared";

// Focused on the read-only GET /api/v1/code/patches[/:id] handlers only —
// the apply/approve/rollback handlers in code.ts are owned by another agent
// this round and are intentionally untouched/untested here.

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-code-patches-route-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";

const getRequestUser = vi.fn();
vi.mock("../services/resolve-identity.js", () => ({
  getRequestUser: (...args: unknown[]) => getRequestUser(...args),
}));

const { registerCodeRoutes } = await import("./code.js");
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

function makePatch(projectId: string | null): PatchArtifact {
  osStore.ensureLoaded();
  const now = new Date().toISOString();
  const patch: PatchArtifact = {
    id: crypto.randomUUID(),
    projectId,
    title: "Fix bug",
    reason: "Repro'd via failing test",
    mode: "fix",
    status: "PROPOSED",
    risk: "LOW",
    baseCommit: null,
    targetBranch: null,
    filesChanged: [
      { path: "src/index.ts", action: "modify", summary: "fix off-by-one" },
    ],
    evidenceIds: [],
    claimIds: [],
    expectedImpact: "none",
    tests: [],
    evaluationSummary: null,
    approvals: [],
    appliedAt: null,
    verifiedAt: null,
    rollbackRef: null,
    rollbackSnapshot: [],
    createdAt: now,
    updatedAt: now,
    createdBy: "test",
    epistemicState: "PROPOSED",
    confidence: 0.5,
    authorityHint: "LLM_INFERENCE",
  };
  osStore.upsertPatch(patch);
  return patch;
}

let app: FastifyInstance;
const dirs: string[] = [tmpDir];

beforeAll(async () => {
  app = await buildRouteTestApp(registerCodeRoutes);
});

afterAll(async () => {
  await app.close();
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("GET /api/v1/code/patches", () => {
  it("401s when not signed in", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({ method: "GET", url: "/api/v1/code/patches" });
    expect(res.statusCode).toBe(401);
  });

  it("filters out patches tied to a project owned by someone else", async () => {
    const owner = signedInUser();
    const mineProject = makeProject(owner);
    const foreignProject = makeProject(otherUser);
    const mine = makePatch(mineProject);
    const foreign = makePatch(foreignProject);
    const global = makePatch(null);

    getRequestUser.mockReturnValue(owner);
    const res = await app.inject({ method: "GET", url: "/api/v1/code/patches" });
    expect(res.statusCode).toBe(200);
    const ids = res.json().items.map((p: { id: string }) => p.id);
    expect(ids).toContain(mine.id);
    expect(ids).toContain(global.id);
    expect(ids).not.toContain(foreign.id);
  });

  it("403s when explicitly querying by a foreign projectId", async () => {
    const foreignProject = makeProject(otherUser);
    getRequestUser.mockReturnValue(signedInUser());
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/code/patches?projectId=${foreignProject}`,
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /api/v1/code/patches/:id", () => {
  it("401s when not signed in", async () => {
    const patch = makePatch(null);
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/code/patches/${patch.id}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s for a signed-in user who does not own the patch's project", async () => {
    const owner = signedInUser();
    const projectId = makeProject(owner);
    const patch = makePatch(projectId);
    getRequestUser.mockReturnValue(otherUser);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/code/patches/${patch.id}`,
    });
    expect(res.statusCode).toBe(403);
  });

  it("200s for the owning user (no regression)", async () => {
    const owner = signedInUser();
    const projectId = makeProject(owner);
    const patch = makePatch(projectId);
    getRequestUser.mockReturnValue(owner);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/code/patches/${patch.id}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(patch.id);
  });
});

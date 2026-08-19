import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser, Decision } from "@atlas/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-decisions-route-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";

const getRequestUser = vi.fn();
vi.mock("../services/resolve-identity.js", () => ({
  getRequestUser: (...args: unknown[]) => getRequestUser(...args),
}));

const { registerDecisionRoutes } = await import("./decisions.js");
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

function makeDecision(projectId: string | null): Decision {
  osStore.ensureLoaded();
  const now = new Date().toISOString();
  const decision: Decision = {
    id: crypto.randomUUID(),
    projectId,
    decision: "Use PostgreSQL",
    reason: ["fits the workload"],
    alternatives: [],
    tradeOffs: [],
    evidence: [],
    status: "ACTIVE",
    confidence: 0.9,
    epistemicState: "CONFIRMED",
    supersededBy: null,
    adrPath: null,
    decidedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  osStore.addDecision(decision);
  return decision;
}

let app: FastifyInstance;
const dirs: string[] = [tmpDir];

beforeAll(async () => {
  app = await buildRouteTestApp(registerDecisionRoutes);
});

afterAll(async () => {
  await app.close();
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("GET /api/v1/decisions", () => {
  it("401s when not signed in", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({ method: "GET", url: "/api/v1/decisions" });
    expect(res.statusCode).toBe(401);
  });

  it("filters out decisions tied to a project owned by someone else", async () => {
    const owner = signedInUser();
    const mineProject = makeProject(owner);
    const foreignProject = makeProject(otherUser);
    const mine = makeDecision(mineProject);
    const foreign = makeDecision(foreignProject);
    const global = makeDecision(null);

    getRequestUser.mockReturnValue(owner);
    const res = await app.inject({ method: "GET", url: "/api/v1/decisions" });
    expect(res.statusCode).toBe(200);
    const ids = res.json().items.map((d: { id: string }) => d.id);
    expect(ids).toContain(mine.id);
    expect(ids).toContain(global.id);
    expect(ids).not.toContain(foreign.id);
  });

  it("403s when explicitly querying by a foreign projectId", async () => {
    const owner = signedInUser();
    const foreignProject = makeProject(owner);
    getRequestUser.mockReturnValue(otherUser);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/decisions?projectId=${foreignProject}`,
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /api/v1/decisions/:id", () => {
  it("401s when not signed in", async () => {
    const decision = makeDecision(null);
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/decisions/${decision.id}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s for a signed-in user who does not own the decision's project", async () => {
    const owner = signedInUser();
    const projectId = makeProject(owner);
    const decision = makeDecision(projectId);
    getRequestUser.mockReturnValue(otherUser);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/decisions/${decision.id}`,
    });
    expect(res.statusCode).toBe(403);
  });

  it("200s for the owning user (no regression)", async () => {
    const owner = signedInUser();
    const projectId = makeProject(owner);
    const decision = makeDecision(projectId);
    getRequestUser.mockReturnValue(owner);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/decisions/${decision.id}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(decision.id);
  });

  it("200s for a signed-in user reading a decision with no project (global)", async () => {
    const decision = makeDecision(null);
    getRequestUser.mockReturnValue(otherUser);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/decisions/${decision.id}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(decision.id);
  });
});

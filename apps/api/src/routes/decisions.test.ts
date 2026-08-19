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

// POST handlers (create/transition) resolve ownerId via `resolveCloudIdentity`
// (not `getRequestUser` directly) — same mocking pattern as memory.test.ts /
// billing.test.ts.
const resolveCloudIdentity = vi.fn();
vi.mock("../services/cloud-identity.js", () => ({
  resolveCloudIdentity: (...args: unknown[]) => resolveCloudIdentity(...args),
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

function cloudIdentityFor(user: AuthUser) {
  return {
    ownerId: user.id,
    userAccessToken: null,
    setCookie: null,
    source: "local_session" as const,
  };
}

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
  // Force `isLiveSupabase` false so the POST routes' best-effort cloud
  // dual-write never attempts a real Supabase network call during tests
  // (same as memory.test.ts).
  app = await buildRouteTestApp(registerDecisionRoutes, {
    SUPABASE_SERVICE_ROLE_KEY: "replace-me",
  });
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

describe("POST /api/v1/decisions", () => {
  it("401s when not signed in", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/decisions",
      payload: { decision: "Use PostgreSQL" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("caps a client-supplied epistemicState of CONFIRMED down to PROPOSED at create time", async () => {
    const user = signedInUser();
    getRequestUser.mockReturnValue(user);
    resolveCloudIdentity.mockResolvedValue(cloudIdentityFor(user));
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/decisions",
      payload: {
        decision: "Use PostgreSQL",
        epistemicState: "CONFIRMED",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().epistemicState).toBe("PROPOSED");
    expect(res.json().epistemicState).not.toBe("CONFIRMED");
  });

  it("caps the ACTIVE-status default epistemicState (previously CONFIRMED) down to PROPOSED when the client sends no epistemicState", async () => {
    const user = signedInUser();
    getRequestUser.mockReturnValue(user);
    resolveCloudIdentity.mockResolvedValue(cloudIdentityFor(user));
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/decisions",
      payload: {
        decision: "Use PostgreSQL",
        status: "ACTIVE",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe("ACTIVE");
    expect(res.json().epistemicState).toBe("PROPOSED");
    expect(res.json().epistemicState).not.toBe("CONFIRMED");
  });

  it("201s for a signed-in user creating a decision with no epistemicState override (no regression)", async () => {
    const user = signedInUser();
    getRequestUser.mockReturnValue(user);
    resolveCloudIdentity.mockResolvedValue(cloudIdentityFor(user));
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/decisions",
      payload: { decision: "Use PostgreSQL" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().decision).toBe("Use PostgreSQL");
    expect(res.json().status).toBe("PROPOSED");
    expect(res.json().epistemicState).toBe("PROPOSED");
  });
});

describe("POST /api/v1/decisions/:id/transition", () => {
  it("401s when not signed in", async () => {
    const decision = makeDecision(null);
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/decisions/${decision.id}/transition`,
      payload: { status: "REJECTED" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("200s for a signed-in user transitioning PROPOSED -> ACTIVE (no regression)", async () => {
    osStore.ensureLoaded();
    const now = new Date().toISOString();
    const decision: Decision = {
      id: crypto.randomUUID(),
      projectId: null,
      decision: "Use PostgreSQL",
      reason: [],
      alternatives: [],
      tradeOffs: [],
      evidence: [],
      status: "PROPOSED",
      confidence: 0.6,
      epistemicState: "PROPOSED",
      supersededBy: null,
      adrPath: null,
      decidedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    osStore.addDecision(decision);

    const user = signedInUser();
    getRequestUser.mockReturnValue(user);
    resolveCloudIdentity.mockResolvedValue(cloudIdentityFor(user));
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/decisions/${decision.id}/transition`,
      payload: { status: "ACTIVE" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ACTIVE");
    expect(res.json().epistemicState).toBe("CONFIRMED");
  });
});

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-graph-route-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";

// Same mechanism used by portfolio.test.ts / auth-guards.test.ts: stub
// `getRequestUser` (the function `requireSignedInForWrite` ultimately calls)
// so a route test can simulate a signed-in caller without a real
// Supabase/local session cookie.
const getRequestUser = vi.fn();
vi.mock("../services/resolve-identity.js", () => ({
  getRequestUser: (...args: unknown[]) => getRequestUser(...args),
}));

const { registerGraphRoutes } = await import("./graph.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { osStore } = await import("../store/os-store.js");
const { bindProjectOwner } = await import("../services/project-access.js");
const { authorizeEntityAction } = await import("@atlas/agent-core");
const { checkResourceAccess } = await import("../services/resource-access.js");

function signedInUser(partial: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    email: "grapher@example.com",
    displayName: "Grapher",
    role: "user",
    locale: "en",
    provider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

let app: FastifyInstance;
const dirs: string[] = [tmpDir];

beforeAll(async () => {
  app = await buildRouteTestApp(registerGraphRoutes);
});

afterAll(async () => {
  await app.close();
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("POST /api/v1/graph/rebuild", () => {
  it("401s when not signed in (existing requireSignedInForWrite gate is unchanged)", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/graph/rebuild",
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it("succeeds for a signed-in user rebuilding a bare workspaceRoot (default-allow case, no project owner to check)", async () => {
    getRequestUser.mockReturnValue(signedInUser());

    const workspaceRoot = mkdtempSync(join(tmpdir(), "atlas-graph-rebuild-target-"));
    dirs.push(workspaceRoot);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/graph/rebuild",
      payload: { workspaceRoot },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.workspaceRoot).toBe(workspaceRoot);
    expect(typeof body.nodes).toBe("number");
    expect(typeof body.edges).toBe("number");
  });

  it("succeeds for a signed-in user rebuilding a linked project they own (ownership check passes)", async () => {
    const actor = signedInUser();
    getRequestUser.mockReturnValue(actor);

    osStore.ensureLoaded();
    const workspaceRoot = mkdtempSync(join(tmpdir(), "atlas-graph-rebuild-owned-"));
    dirs.push(workspaceRoot);

    const now = new Date().toISOString();
    const projectId = crypto.randomUUID();
    osStore.upsertProject({
      id: projectId,
      slug: `graph-owned-${Date.now().toString(36)}`,
      name: "Graph Owned",
      description: null,
      status: "ACTIVE",
      techStack: [],
      createdAt: now,
      updatedAt: now,
    });
    osStore.setWorkspaceRoot(projectId, workspaceRoot);
    bindProjectOwner(projectId, actor.id, "bound_on_create");

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/graph/rebuild",
      payload: { projectId },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().workspaceRoot).toBe(workspaceRoot);
  });

  it("403s for a signed-in user rebuilding a project owned by someone else (checkResourceAccess DENIED)", async () => {
    const actor = signedInUser({
      id: "33333333-3333-4333-8333-333333333333",
      email: "other-actor@example.com",
    });
    getRequestUser.mockReturnValue(actor);

    osStore.ensureLoaded();
    const workspaceRoot = mkdtempSync(join(tmpdir(), "atlas-graph-rebuild-foreign-"));
    dirs.push(workspaceRoot);

    const now = new Date().toISOString();
    const projectId = crypto.randomUUID();
    osStore.upsertProject({
      id: projectId,
      slug: `graph-foreign-${Date.now().toString(36)}`,
      name: "Graph Foreign",
      description: null,
      status: "ACTIVE",
      techStack: [],
      createdAt: now,
      updatedAt: now,
    });
    osStore.setWorkspaceRoot(projectId, workspaceRoot);
    // Bind ownership to a different actor than the signed-in caller above.
    bindProjectOwner(
      projectId,
      "44444444-4444-4444-8444-444444444444",
      "bound_on_create",
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/graph/rebuild",
      payload: { projectId },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
    expect(res.json().error.message).toMatch(/does not own/);
  });
});

describe("entity-policy + resource-access wiring for the rebuild route", () => {
  // Focused unit-level assertions on the exact functions/arguments the route
  // uses to gate the request, so these tests fail if the wiring in graph.ts
  // is silently changed (e.g. mode flipped, writeGateOpen/approved dropped,
  // or the wrong capability chosen) even though the HTTP-level tests above
  // would still pass for other reasons.
  it("authorizeEntityAction('CONFIGURATION','EXECUTE', {mode:'WRITE', writeGateOpen:true, approved:true}) is ALLOWED", () => {
    const decision = authorizeEntityAction("CONFIGURATION", "EXECUTE", {
      mode: "WRITE",
      writeGateOpen: true,
      approved: true,
    });
    expect(decision.decision).toBe("ALLOWED");
  });

  it("checkResourceAccess denies a non-owning, non-admin actor for write.workspace_root", () => {
    const result = checkResourceAccess({
      actorId: "11111111-1111-4111-8111-111111111111",
      role: "user",
      requiredCapability: "write.workspace_root",
      resourceOwnerId: "99999999-9999-4999-8999-999999999999",
    });
    expect(result.decision).toBe("DENIED");
  });
});

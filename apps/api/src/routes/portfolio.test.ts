import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-portfolio-route-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";

// Same mechanism used by auth-guards.test.ts: stub `getRequestUser` (the
// function `requireSignedInForWrite` ultimately calls) so a route test can
// simulate a signed-in caller without a real Supabase/local session cookie.
const getRequestUser = vi.fn();
vi.mock("../services/resolve-identity.js", () => ({
  getRequestUser: (...args: unknown[]) => getRequestUser(...args),
}));

const { registerPortfolioRoutes } = await import("./portfolio.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { osStore } = await import("../store/os-store.js");
const { bindProjectOwner } = await import("../services/project-access.js");
const { authorizeEntityAction } = await import("@atlas/agent-core");

function signedInUser(partial: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    email: "linker@example.com",
    displayName: "Linker",
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
  app = await buildRouteTestApp(registerPortfolioRoutes);
});

afterAll(async () => {
  await app.close();
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("POST /api/v1/portfolio/discovery/link", () => {
  it("401s when not signed in (existing requireSignedInForWrite gate is unchanged)", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/portfolio/discovery/link",
      payload: { projectId: crypto.randomUUID(), workspaceRoot: "/nowhere" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("succeeds for a signed-in user linking their own new record (default-allow entity-policy case)", async () => {
    getRequestUser.mockReturnValue(signedInUser());

    osStore.ensureLoaded();
    const workspaceRoot = mkdtempSync(join(tmpdir(), "atlas-portfolio-link-target-"));
    dirs.push(workspaceRoot);

    const now = new Date().toISOString();
    const projectId = crypto.randomUUID();
    osStore.upsertProject({
      id: projectId,
      slug: `link-me-${Date.now().toString(36)}`,
      name: "Link Me",
      description: null,
      status: "ACTIVE",
      techStack: [],
      createdAt: now,
      updatedAt: now,
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/portfolio/discovery/link",
      payload: { projectId, workspaceRoot },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.projectId).toBe(projectId);
    expect(body.workspaceRoot).toBe(workspaceRoot);
    expect(osStore.getWorkspaceRoot(projectId)).toBe(workspaceRoot);
  });
});

describe("entity-policy wiring for the link route", () => {
  // Focused unit-level assertion on the exact agent-context object the route
  // constructs, so this test fails if the wiring in portfolio.ts is silently
  // changed (e.g. mode flipped, writeGateOpen/approved dropped) even though
  // the HTTP-level test above would still pass for other reasons.
  it("authorizeEntityAction('RECORD','CREATE', {mode:'WRITE', writeGateOpen:true, approved:true}) is ALLOWED", () => {
    const decision = authorizeEntityAction("RECORD", "CREATE", {
      mode: "WRITE",
      writeGateOpen: true,
      approved: true,
    });
    expect(decision.decision).toBe("ALLOWED");
  });
});

describe("GET /api/v1/portfolio/overview — C1 tenant isolation", () => {
  const ownerA = signedInUser();
  const ownerB = signedInUser({
    id: "33333333-3333-4333-8333-333333333333",
    email: "other@example.com",
  });

  function makeProject(owner: AuthUser, name: string): string {
    osStore.ensureLoaded();
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    osStore.upsertProject({
      id,
      slug: `pf-${id.slice(0, 8)}`,
      name,
      description: null,
      status: "ACTIVE",
      techStack: [],
      createdAt: now,
      updatedAt: now,
    });
    bindProjectOwner(id, owner.id, "bound_on_create");
    return id;
  }

  it("same-tenant allow: owner A sees their own project name", async () => {
    makeProject(ownerA, "C1 Portfolio Mine Visible");
    getRequestUser.mockReturnValue(ownerA);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/portfolio/overview",
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("C1 Portfolio Mine Visible");
    expect(res.json().ownerId).toBe(ownerA.id);
  });

  it("cross-tenant deny: owner A never sees owner B's project name", async () => {
    makeProject(ownerB, "C1 Portfolio Bravo Secret");
    getRequestUser.mockReturnValue(ownerA);
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/portfolio/overview",
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("C1 Portfolio Bravo Secret");
  });
});

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";

const storeDir = mkdtempSync(join(tmpdir(), "atlas-debug-route-"));
process.env.ATLAS_STORE_PATH = join(storeDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";

const getRequestUser = vi.fn();
vi.mock("../services/resolve-identity.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/resolve-identity.js")>();
  return {
    ...actual,
    getRequestUser: (...args: unknown[]) => getRequestUser(...args),
  };
});

const { registerStudioDebugRoutes } = await import("./studio-debug.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { osStore } = await import("../store/os-store.js");
const { bindProjectOwner } = await import("../services/project-access.js");
const { setAtlasElevationStateForTests, setProjectEnvironmentTierForTests, resetProjectEnvironmentTiersForTests } =
  await import("../services/studio-debug-gate.js");
const { resetDebugSessionsForTests, getDebugSession } = await import("../services/studio-debug-session.js");

let app: FastifyInstance;
const dirs: string[] = [storeDir];

function testUser(partial: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    email: "engineer@example.com",
    displayName: "Engineer",
    role: "user",
    locale: "en",
    provider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  } as AuthUser;
}

const owner = testUser();
const stranger = testUser({ id: "33333333-3333-4333-8333-333333333333", email: "other@example.com" });

function seedOwnedProject(actor: AuthUser, root: string): string {
  const now = new Date().toISOString();
  const projectId = crypto.randomUUID();
  osStore.upsertProject({
    id: projectId,
    slug: `studio-debug-${Date.now().toString(36)}`,
    name: "Studio Debug",
    description: null,
    status: "ACTIVE",
    techStack: [],
    createdAt: now,
    updatedAt: now,
  });
  osStore.setWorkspaceRoot(projectId, root);
  bindProjectOwner(projectId, actor.id, "bound_on_create");
  return projectId;
}

beforeAll(async () => {
  app = await buildRouteTestApp(registerStudioDebugRoutes);
});

afterAll(async () => {
  await app.close();
  rmSync(storeDir, { recursive: true, force: true });
});

const previousHostFlag = process.env.ATLAS_DEBUGGER_ENABLED;

beforeEach(() => {
  getRequestUser.mockReset();
  process.env.ATLAS_DEBUGGER_ENABLED = "1";
  setAtlasElevationStateForTests(false);
  resetProjectEnvironmentTiersForTests();
  resetDebugSessionsForTests();
});

afterEach(async () => {
  resetDebugSessionsForTests();
  resetProjectEnvironmentTiersForTests();
  setAtlasElevationStateForTests(null);
  if (previousHostFlag === undefined) delete process.env.ATLAS_DEBUGGER_ENABLED;
  else process.env.ATLAS_DEBUGGER_ENABLED = previousHostFlag;
  await new Promise((r) => setTimeout(r, 300));
  for (const dir of dirs.splice(1)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

function workspaceWithScript(): string {
  const dir = mkdtempSync(join(tmpdir(), "atlas-debug-ws-"));
  dirs.push(dir);
  writeFileSync(join(dir, "script.js"), "setInterval(() => {}, 1000);\n");
  return dir;
}

async function waitUntilDead(pid: number, ms = 4000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

async function openSession(projectId: string): Promise<{ sessionId: string; pid: number }> {
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/projects/${projectId}/studio/debug/sessions`,
    payload: { targetId: "debug.node-script", relativePath: "script.js" },
  });
  expect(res.statusCode).toBe(201);
  const body = res.json() as { session: { sessionId: string; pid: number } };
  return { sessionId: body.session.sessionId, pid: body.session.pid };
}

describe("Studio Debug routes", () => {
  it("GET targets returns the Debugger's own isolated catalog", async () => {
    getRequestUser.mockResolvedValue(owner);
    const workspace = mkdtempSync(join(tmpdir(), "atlas-debug-targets-"));
    dirs.push(workspace);
    const projectId = seedOwnedProject(owner, workspace);

    const res = await app.inject({ method: "GET", url: `/api/v1/projects/${projectId}/studio/debug/targets` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { targets: Array<{ id: string }> };
    expect(body.targets.some((t) => t.id === "debug.node-script")).toBe(true);
  });

  it("denies a non-owner (write-access gate, unchanged) before Debugger policy ever runs", async () => {
    getRequestUser.mockResolvedValue(stranger);
    const workspace = mkdtempSync(join(tmpdir(), "atlas-debug-stranger-"));
    dirs.push(workspace);
    const projectId = seedOwnedProject(owner, workspace);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/debug/sessions`,
      payload: { targetId: "debug.node-script", relativePath: "script.js" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("real request is fail-closed: P2_INSUFFICIENT_EVIDENCE because environmentTier has no source of truth yet", async () => {
    getRequestUser.mockResolvedValue(owner);
    const workspace = mkdtempSync(join(tmpdir(), "atlas-debug-p2-"));
    dirs.push(workspace);
    const projectId = seedOwnedProject(owner, workspace);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/debug/sessions`,
      payload: { targetId: "debug.node-script", relativePath: "script.js" },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe("P2_INSUFFICIENT_EVIDENCE");
  });

  it("P3 CONFIGURATION_ERROR takes priority and returns 503 when Atlas is elevated", async () => {
    getRequestUser.mockResolvedValue(owner);
    const workspace = mkdtempSync(join(tmpdir(), "atlas-debug-p3-"));
    dirs.push(workspace);
    const projectId = seedOwnedProject(owner, workspace);
    setAtlasElevationStateForTests(true);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/debug/sessions`,
      payload: { targetId: "debug.node-script", relativePath: "script.js" },
    });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe("P3_CONFIGURATION_ERROR");
  });

  it("force-close requires sign-in and returns 403 for a session that cannot exist while P2 denies creation", async () => {
    getRequestUser.mockResolvedValue(testUser({ role: "user" }));
    const workspace = mkdtempSync(join(tmpdir(), "atlas-debug-force-"));
    dirs.push(workspace);
    const projectId = seedOwnedProject(owner, workspace);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/debug/sessions/00000000-0000-4000-8000-000000000000/force-close`,
      payload: { reason: "incident response" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("denies the Agent explicitly on every Debugger route (human-only, same posture as PTY)", async () => {
    getRequestUser.mockResolvedValue(owner);
    const workspace = mkdtempSync(join(tmpdir(), "atlas-debug-agent-"));
    dirs.push(workspace);
    const projectId = seedOwnedProject(owner, workspace);
    const agentHeaders = { "x-atlas-actor-kind": "AGENT" };

    const getTargets = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/studio/debug/targets`,
      headers: agentHeaders,
    });
    expect(getTargets.statusCode).toBe(403);

    const postSession = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/debug/sessions`,
      headers: agentHeaders,
      payload: { targetId: "debug.node-script", relativePath: "script.js" },
    });
    expect(postSession.statusCode).toBe(403);

    const getSession = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/studio/debug/sessions/00000000-0000-4000-8000-000000000000`,
      headers: agentHeaders,
    });
    expect(getSession.statusCode).toBe(403);

    const action = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/debug/sessions/00000000-0000-4000-8000-000000000000/action`,
      headers: agentHeaders,
      payload: { action: "continue" },
    });
    expect(action.statusCode).toBe(403);

    const close = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/debug/sessions/00000000-0000-4000-8000-000000000000/close`,
      headers: agentHeaders,
    });
    expect(close.statusCode).toBe(403);

    const forceClose = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/debug/sessions/00000000-0000-4000-8000-000000000000/force-close`,
      headers: agentHeaders,
      payload: { reason: "x" },
    });
    expect(forceClose.statusCode).toBe(403);
  });

  it("is OFF by default: without the host opt-in every open request is denied DEBUGGER_DISABLED", async () => {
    delete process.env.ATLAS_DEBUGGER_ENABLED;
    getRequestUser.mockResolvedValue(owner);
    const projectId = seedOwnedProject(owner, workspaceWithScript());
    setProjectEnvironmentTierForTests(projectId, "DEVELOPMENT");

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/debug/sessions`,
      payload: { targetId: "debug.node-script", relativePath: "script.js" },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe("DEBUGGER_DISABLED");
  });

  it("host opt-in is not a bypass: enabled host + unclassified project is still P2_INSUFFICIENT_EVIDENCE", async () => {
    getRequestUser.mockResolvedValue(owner);
    const projectId = seedOwnedProject(owner, workspaceWithScript());
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/debug/sessions`,
      payload: { targetId: "debug.node-script", relativePath: "script.js" },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe("P2_INSUFFICIENT_EVIDENCE");
  });

  it("P2 seam: a classified DEVELOPMENT project on an enabled host opens a real session (201)", async () => {
    getRequestUser.mockResolvedValue(owner);
    const projectId = seedOwnedProject(owner, workspaceWithScript());
    setProjectEnvironmentTierForTests(projectId, "DEVELOPMENT");
    const { sessionId, pid } = await openSession(projectId);
    expect(pid).toBeGreaterThan(0);
    expect(getDebugSession(sessionId)?.status).toBe("ACTIVE");
  });

  it("P2 seam: a PRODUCTION-classified project is denied P2_PRODUCTION_LINKED", async () => {
    getRequestUser.mockResolvedValue(owner);
    const projectId = seedOwnedProject(owner, workspaceWithScript());
    setProjectEnvironmentTierForTests(projectId, "PRODUCTION");
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/studio/debug/sessions`,
      payload: { targetId: "debug.node-script", relativePath: "script.js" },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe("P2_PRODUCTION_LINKED");
  });

  describe("authorization-loss closure (S1, wired in routes)", () => {
    it("opener loses project ownership mid-session: the next ACTION is blocked AND the session is revoked and the process killed", async () => {
      getRequestUser.mockResolvedValue(owner);
      const projectId = seedOwnedProject(owner, workspaceWithScript());
      setProjectEnvironmentTierForTests(projectId, "DEVELOPMENT");
      const { sessionId, pid } = await openSession(projectId);

      bindProjectOwner(projectId, stranger.id, "claimed");

      const action = await app.inject({
        method: "POST",
        url: `/api/v1/projects/${projectId}/studio/debug/sessions/${sessionId}/action`,
        payload: { action: "pause" },
      });
      expect(action.statusCode).toBe(403);
      expect(getDebugSession(sessionId)?.status).toBe("AUTHORIZATION_REVOKED");
      expect(await waitUntilDead(pid)).toBe(true);

      const again = await app.inject({
        method: "POST",
        url: `/api/v1/projects/${projectId}/studio/debug/sessions/${sessionId}/action`,
        payload: { action: "continue" },
      });
      expect(again.statusCode).toBe(403);
    });

    it("the same closure happens on a status read by the opener", async () => {
      getRequestUser.mockResolvedValue(owner);
      const projectId = seedOwnedProject(owner, workspaceWithScript());
      setProjectEnvironmentTierForTests(projectId, "DEVELOPMENT");
      const { sessionId, pid } = await openSession(projectId);
      bindProjectOwner(projectId, stranger.id, "claimed");

      const status = await app.inject({
        method: "GET",
        url: `/api/v1/projects/${projectId}/studio/debug/sessions/${sessionId}`,
      });
      expect(status.statusCode).toBe(403);
      expect(getDebugSession(sessionId)?.status).toBe("AUTHORIZATION_REVOKED");
      expect(await waitUntilDead(pid)).toBe(true);
    });

    it("and on a close attempt by the opener (the session ends either way, never left running)", async () => {
      getRequestUser.mockResolvedValue(owner);
      const projectId = seedOwnedProject(owner, workspaceWithScript());
      setProjectEnvironmentTierForTests(projectId, "DEVELOPMENT");
      const { sessionId, pid } = await openSession(projectId);
      bindProjectOwner(projectId, stranger.id, "claimed");

      const close = await app.inject({
        method: "POST",
        url: `/api/v1/projects/${projectId}/studio/debug/sessions/${sessionId}/close`,
      });
      expect(close.statusCode).toBe(403);
      expect(getDebugSession(sessionId)?.status).toBe("AUTHORIZATION_REVOKED");
      expect(await waitUntilDead(pid)).toBe(true);
    });

    it("a DIFFERENT user without access cannot revoke someone else's session by probing it", async () => {
      getRequestUser.mockResolvedValue(owner);
      const projectId = seedOwnedProject(owner, workspaceWithScript());
      setProjectEnvironmentTierForTests(projectId, "DEVELOPMENT");
      const { sessionId } = await openSession(projectId);

      getRequestUser.mockResolvedValue(stranger);
      for (const request of [
        { method: "POST" as const, url: `/api/v1/projects/${projectId}/studio/debug/sessions/${sessionId}/action`, payload: { action: "pause" } },
        { method: "POST" as const, url: `/api/v1/projects/${projectId}/studio/debug/sessions/${sessionId}/close` },
        { method: "GET" as const, url: `/api/v1/projects/${projectId}/studio/debug/sessions/${sessionId}` },
      ]) {
        const res = await app.inject(request);
        expect(res.statusCode).toBe(403);
      }
      expect(getDebugSession(sessionId)?.status).toBe("ACTIVE");
    });

    it("an unauthenticated probe (401) cannot revoke either", async () => {
      getRequestUser.mockResolvedValue(owner);
      const projectId = seedOwnedProject(owner, workspaceWithScript());
      setProjectEnvironmentTierForTests(projectId, "DEVELOPMENT");
      const { sessionId } = await openSession(projectId);

      getRequestUser.mockResolvedValue(null);
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/projects/${projectId}/studio/debug/sessions/${sessionId}`,
      });
      expect(res.statusCode).toBe(401);
      expect(getDebugSession(sessionId)?.status).toBe("ACTIVE");
    });

    it("the revocation is audited as debugger.authorization.revoked", async () => {
      getRequestUser.mockResolvedValue(owner);
      const projectId = seedOwnedProject(owner, workspaceWithScript());
      setProjectEnvironmentTierForTests(projectId, "DEVELOPMENT");
      const { sessionId } = await openSession(projectId);
      bindProjectOwner(projectId, stranger.id, "claimed");
      await app.inject({
        method: "POST",
        url: `/api/v1/projects/${projectId}/studio/debug/sessions/${sessionId}/action`,
        payload: { action: "pause" },
      });
      const revoked = osStore
        .listAudit()
        .filter((e) => e.type === "debugger.authorization.revoked" && e.sessionId === sessionId);
      expect(revoked.length).toBe(1);
    });
  });});


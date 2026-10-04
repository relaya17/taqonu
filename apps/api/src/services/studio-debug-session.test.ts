import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

process.env.ATLAS_STORE_PATH = join(mkdtempSync(join(tmpdir(), "atlas-debug-session-store-")), "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";

const {
  closeDebugSessionVoluntary,
  createDebugSession,
  DEBUG_WATCHDOG_INTERVAL_MS,
  forceCloseDebugSession,
  getDebugSession,
  hasActiveDebugSessionForTarget,
  isDebugWatchdogRunning,
  performDebugAction,
  resetDebugSessionsForTests,
  revokeDebugSessionAuthorization,
  runDebugOwnershipWatchdogOnce,
  systemCloseDebugSession,
} = await import("./studio-debug-session.js");
const { bindProjectOwner } = await import("./project-access.js");
const { osStore } = await import("../store/os-store.js");

const dirs: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  resetDebugSessionsForTests();
  await new Promise((r) => setTimeout(r, 300));
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "atlas-debug-session-"));
  dirs.push(dir);
  writeFileSync(join(dir, "script.js"), "setInterval(() => {}, 1000);\n");
  return dir;
}

const PROJECT = "11111111-1111-4111-8111-111111111111";
const OPENER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

describe("Debug Session lifecycle", () => {
  it("creates a real ACTIVE session with a minted ticket", () => {
    const result = createDebugSession({
      projectId: PROJECT,
      openerId: OPENER,
      targetId: "debug.node-script",
      workspaceRoot: workspace(),
      relativePath: "script.js",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.status).toBe("ACTIVE");
      expect(result.ticket.length).toBeGreaterThan(8);
      expect(getDebugSession(result.session.sessionId)?.status).toBe("ACTIVE");
    }
  });

  it("hasActiveDebugSessionForTarget is true after create, false for a different target", () => {
    createDebugSession({
      projectId: PROJECT,
      openerId: OPENER,
      targetId: "debug.node-script",
      workspaceRoot: workspace(),
      relativePath: "script.js",
    });
    expect(hasActiveDebugSessionForTarget(PROJECT, "debug.node-script")).toBe(true);
    expect(hasActiveDebugSessionForTarget(PROJECT, "some-other-target")).toBe(false);
  });

  it("action: opener can act while session is ACTIVE", () => {
    const created = createDebugSession({
      projectId: PROJECT,
      openerId: OPENER,
      targetId: "debug.node-script",
      workspaceRoot: workspace(),
      relativePath: "script.js",
    });
    if (!created.ok) throw new Error("setup failed");
    const result = performDebugAction({ sessionId: created.session.sessionId, actorId: OPENER, action: "pause" });
    expect(result.ok).toBe(true);
  });

  it("action: a non-opener is denied (NOT_OPENER)", () => {
    const created = createDebugSession({
      projectId: PROJECT,
      openerId: OPENER,
      targetId: "debug.node-script",
      workspaceRoot: workspace(),
      relativePath: "script.js",
    });
    if (!created.ok) throw new Error("setup failed");
    const result = performDebugAction({ sessionId: created.session.sessionId, actorId: OTHER, action: "continue" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.denial).toBe("NOT_OPENER");
  });

  it("action: denied once the session is no longer ACTIVE", () => {
    const created = createDebugSession({
      projectId: PROJECT,
      openerId: OPENER,
      targetId: "debug.node-script",
      workspaceRoot: workspace(),
      relativePath: "script.js",
    });
    if (!created.ok) throw new Error("setup failed");
    closeDebugSessionVoluntary(created.session.sessionId, OPENER);
    const result = performDebugAction({ sessionId: created.session.sessionId, actorId: OPENER, action: "step" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.denial).toBe("SESSION_NOT_ACTIVE");
  });

  it("voluntary close: opener succeeds", () => {
    const created = createDebugSession({
      projectId: PROJECT,
      openerId: OPENER,
      targetId: "debug.node-script",
      workspaceRoot: workspace(),
      relativePath: "script.js",
    });
    if (!created.ok) throw new Error("setup failed");
    const result = closeDebugSessionVoluntary(created.session.sessionId, OPENER);
    expect(result.ok).toBe(true);
    expect(getDebugSession(created.session.sessionId)?.status).toBe("CLOSED");
  });

  it("voluntary close: a non-opener (e.g. another project user) is denied", () => {
    const created = createDebugSession({
      projectId: PROJECT,
      openerId: OPENER,
      targetId: "debug.node-script",
      workspaceRoot: workspace(),
      relativePath: "script.js",
    });
    if (!created.ok) throw new Error("setup failed");
    const result = closeDebugSessionVoluntary(created.session.sessionId, OTHER);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.denial).toBe("NOT_OPENER");
    expect(getDebugSession(created.session.sessionId)?.status).toBe("ACTIVE");
  });

  it("force-close: denied for a non-admin role", () => {
    const created = createDebugSession({
      projectId: PROJECT,
      openerId: OPENER,
      targetId: "debug.node-script",
      workspaceRoot: workspace(),
      relativePath: "script.js",
    });
    if (!created.ok) throw new Error("setup failed");
    const result = forceCloseDebugSession({
      sessionId: created.session.sessionId,
      actorId: OTHER,
      actorRole: "user",
      reason: "incident response",
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.denial).toBe("NOT_ADMIN");
  });

  it("force-close: denied without a reason, even for an admin", () => {
    const created = createDebugSession({
      projectId: PROJECT,
      openerId: OPENER,
      targetId: "debug.node-script",
      workspaceRoot: workspace(),
      relativePath: "script.js",
    });
    if (!created.ok) throw new Error("setup failed");
    const result = forceCloseDebugSession({
      sessionId: created.session.sessionId,
      actorId: OTHER,
      actorRole: "admin",
      reason: "   ",
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.denial).toBe("REASON_REQUIRED");
  });

  it("force-close: succeeds for an admin with a reason", () => {
    const created = createDebugSession({
      projectId: PROJECT,
      openerId: OPENER,
      targetId: "debug.node-script",
      workspaceRoot: workspace(),
      relativePath: "script.js",
    });
    if (!created.ok) throw new Error("setup failed");
    const result = forceCloseDebugSession({
      sessionId: created.session.sessionId,
      actorId: OTHER,
      actorRole: "admin",
      reason: "incident response",
    });
    expect(result.ok).toBe(true);
    expect(getDebugSession(created.session.sessionId)?.status).toBe("CLOSED");
  });

  it("authorization revocation: immediate fail-safe, blocks further actions", () => {
    const created = createDebugSession({
      projectId: PROJECT,
      openerId: OPENER,
      targetId: "debug.node-script",
      workspaceRoot: workspace(),
      relativePath: "script.js",
    });
    if (!created.ok) throw new Error("setup failed");
    revokeDebugSessionAuthorization(created.session.sessionId, "project write-access revoked");
    expect(getDebugSession(created.session.sessionId)?.status).toBe("AUTHORIZATION_REVOKED");
    const action = performDebugAction({ sessionId: created.session.sessionId, actorId: OPENER, action: "continue" });
    expect(action.ok).toBe(false);
    expect(!action.ok && action.denial).toBe("SESSION_NOT_ACTIVE");
  });

  it("system close (timeout cause) marks SESSION_EXPIRED", () => {
    const created = createDebugSession({
      projectId: PROJECT,
      openerId: OPENER,
      targetId: "debug.node-script",
      workspaceRoot: workspace(),
      relativePath: "script.js",
    });
    if (!created.ok) throw new Error("setup failed");
    systemCloseDebugSession(created.session.sessionId, "timeout");
    expect(getDebugSession(created.session.sessionId)?.status).toBe("SESSION_EXPIRED");
  });

  it("duplicate target: a second session for the same target is rejected by the gate layer (session module itself just reports hasActiveDebugSessionForTarget; enforcement is the route's job)", () => {
    createDebugSession({
      projectId: PROJECT,
      openerId: OPENER,
      targetId: "debug.node-script",
      workspaceRoot: workspace(),
      relativePath: "script.js",
    });
    expect(hasActiveDebugSessionForTarget(PROJECT, "debug.node-script")).toBe(true);
  });
});

describe("ownership-only watchdog (15 s; never grants, never extends, never bypasses revocation)", () => {
  function openFor(projectId: string, opener: string) {
    bindProjectOwner(projectId, opener, "bound_on_create");
    const created = createDebugSession({
      projectId,
      openerId: opener,
      targetId: "debug.node-script",
      workspaceRoot: workspace(),
      relativePath: "script.js",
    });
    if (!created.ok) throw new Error("setup failed");
    return created.session;
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

  it("the interval is exactly 15 seconds", () => {
    expect(DEBUG_WATCHDOG_INTERVAL_MS).toBe(15_000);
  });

  it("leaves a session whose opener still owns the project untouched", () => {
    const project = crypto.randomUUID();
    const session = openFor(project, OPENER);
    expect(runDebugOwnershipWatchdogOnce()).toBe(0);
    expect(getDebugSession(session.sessionId)?.status).toBe("ACTIVE");
  });

  it("revokes through the SAME safe path (status, kill, audit) when ownership changed", async () => {
    const project = crypto.randomUUID();
    const session = openFor(project, OPENER);
    bindProjectOwner(project, OTHER, "claimed");
    expect(runDebugOwnershipWatchdogOnce()).toBe(1);
    expect(getDebugSession(session.sessionId)?.status).toBe("AUTHORIZATION_REVOKED");
    expect(await waitUntilDead(session.pid)).toBe(true);
    const audited = osStore
      .listAudit()
      .filter((e) => e.type === "debugger.authorization.revoked" && e.sessionId === session.sessionId);
    expect(audited.length).toBe(1);
  });

  it("fails closed when the ownership record is gone (null owner is not 'still the owner')", () => {
    const project = crypto.randomUUID();
    const session = createDebugSession({
      projectId: project,
      openerId: OPENER,
      targetId: "debug.node-script",
      workspaceRoot: workspace(),
      relativePath: "script.js",
    });
    if (!session.ok) throw new Error("setup failed");
    expect(runDebugOwnershipWatchdogOnce()).toBe(1);
    expect(getDebugSession(session.session.sessionId)?.status).toBe("AUTHORIZATION_REVOKED");
  });

  it("does not extend a session: lastActivityAt is unchanged by a sweep", () => {
    const project = crypto.randomUUID();
    const session = openFor(project, OPENER);
    const before = getDebugSession(session.sessionId)?.lastActivityAt;
    runDebugOwnershipWatchdogOnce();
    expect(getDebugSession(session.sessionId)?.lastActivityAt).toBe(before);
  });

  it("does not resurrect or re-audit a session that is already revoked", () => {
    const project = crypto.randomUUID();
    const session = openFor(project, OPENER);
    bindProjectOwner(project, OTHER, "claimed");
    expect(runDebugOwnershipWatchdogOnce()).toBe(1);
    expect(runDebugOwnershipWatchdogOnce()).toBe(0);
    const audited = osStore
      .listAudit()
      .filter((e) => e.type === "debugger.authorization.revoked" && e.sessionId === session.sessionId);
    expect(audited.length).toBe(1);
    expect(getDebugSession(session.sessionId)?.status).toBe("AUTHORIZATION_REVOKED");
  });

  it("the timer is started by a session, fires at 15 s, and stops once nothing is active", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    expect(isDebugWatchdogRunning()).toBe(false);
    const project = crypto.randomUUID();
    const session = openFor(project, OPENER);
    expect(isDebugWatchdogRunning()).toBe(true);

    bindProjectOwner(project, OTHER, "claimed");
    vi.advanceTimersByTime(DEBUG_WATCHDOG_INTERVAL_MS - 1);
    expect(getDebugSession(session.sessionId)?.status).toBe("ACTIVE");
    vi.advanceTimersByTime(1);
    expect(getDebugSession(session.sessionId)?.status).toBe("AUTHORIZATION_REVOKED");

    vi.advanceTimersByTime(DEBUG_WATCHDOG_INTERVAL_MS);
    expect(isDebugWatchdogRunning()).toBe(false);
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

describe("hard creation-time lifetime ceiling (activity renews idle only; the absolute deadline never moves)", () => {
  const MINUTE = 60 * 1000;
  const FOUR_HOURS = 4 * 60 * MINUTE;

  function open() {
    const created = createDebugSession({
      projectId: crypto.randomUUID(),
      openerId: OPENER,
      targetId: "debug.node-script",
      workspaceRoot: workspace(),
      relativePath: "script.js",
    });
    if (!created.ok) throw new Error("setup failed");
    return created.session;
  }

  const act = (sessionId: string) => performDebugAction({ sessionId, actorId: OPENER, action: "pause" });
  const expiredAudits = (sessionId: string) =>
    osStore.listAudit().filter((e) => e.type === "debugger.session.expired" && e.sessionId === sessionId);

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

  it("continuous activity cannot extend the session past creation + 4 h", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const session = open();
    for (let i = 0; i < 11; i += 1) {
      vi.advanceTimersByTime(20 * MINUTE);
      expect(act(session.sessionId).ok).toBe(true);
    }
    expect(getDebugSession(session.sessionId)?.status).toBe("ACTIVE");

    vi.advanceTimersByTime(20 * MINUTE);
    expect(getDebugSession(session.sessionId)?.status).toBe("SESSION_EXPIRED");
    const denied = act(session.sessionId);
    expect(denied.ok).toBe(false);
    expect(!denied.ok && denied.denial).toBe("SESSION_NOT_ACTIVE");
    expect(expiredAudits(session.sessionId)).toHaveLength(1);

    vi.useRealTimers();
    expect(await waitUntilDead(session.pid)).toBe(true);
  });

  it("idle expiry is preserved: renewable by activity, expiring after 30 minutes without it", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const session = open();
    vi.advanceTimersByTime(29 * MINUTE);
    expect(act(session.sessionId).ok).toBe(true);
    vi.advanceTimersByTime(29 * MINUTE);
    expect(getDebugSession(session.sessionId)?.status).toBe("ACTIVE");
    vi.advanceTimersByTime(MINUTE);
    expect(getDebugSession(session.sessionId)?.status).toBe("SESSION_EXPIRED");
    expect(expiredAudits(session.sessionId)).toHaveLength(1);
  });

  it("the deadline is exactly creation + 4 h: allowed 1 ms before, denied at it, even if no timer fired", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const session = open();
    const created = Date.now();

    vi.setSystemTime(created + FOUR_HOURS - 1);
    expect(act(session.sessionId).ok).toBe(true);
    expect(getDebugSession(session.sessionId)?.status).toBe("ACTIVE");

    vi.setSystemTime(created + FOUR_HOURS);
    const denied = act(session.sessionId);
    expect(denied.ok).toBe(false);
    expect(!denied.ok && denied.denial).toBe("SESSION_NOT_ACTIVE");
    expect(getDebugSession(session.sessionId)?.status).toBe("SESSION_EXPIRED");
    expect(expiredAudits(session.sessionId)).toHaveLength(1);

    vi.useRealTimers();
    expect(await waitUntilDead(session.pid)).toBe(true);
  });

  it("activity shortly before the deadline does not move it", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const session = open();
    const created = Date.now();
    vi.setSystemTime(created + FOUR_HOURS - 10 * MINUTE);
    expect(act(session.sessionId).ok).toBe(true);
    vi.setSystemTime(created + FOUR_HOURS + 1);
    expect(act(session.sessionId).ok).toBe(false);
    expect(getDebugSession(session.sessionId)?.status).toBe("SESSION_EXPIRED");
  });

  it("an expired session is not resurrected, extended or re-audited by a late callback, close or sweep", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const session = open();
    const created = Date.now();
    vi.setSystemTime(created + FOUR_HOURS + 1);
    expect(act(session.sessionId).ok).toBe(false);
    const lastActivity = getDebugSession(session.sessionId)?.lastActivityAt;

    systemCloseDebugSession(session.sessionId, "timeout");
    runDebugOwnershipWatchdogOnce();
    expect(act(session.sessionId).ok).toBe(false);

    expect(getDebugSession(session.sessionId)?.status).toBe("SESSION_EXPIRED");
    expect(getDebugSession(session.sessionId)?.lastActivityAt).toBe(lastActivity);
    expect(expiredAudits(session.sessionId)).toHaveLength(1);
  });

  it("voluntary close still works on a session that has a deadline", () => {
    const closed = open();
    expect(closeDebugSessionVoluntary(closed.sessionId, OPENER).ok).toBe(true);
    expect(getDebugSession(closed.sessionId)?.status).toBe("CLOSED");
  });
});

describe("watchdog: ownership that is not authorization-grade fails closed (attributed to the registry)", () => {
  const storePath = process.env.ATLAS_STORE_PATH as string;
  const bakPath = `${storePath}.bak`;

  function openOwned(projectId: string) {
    bindProjectOwner(projectId, OPENER, "bound_on_create");
    const created = createDebugSession({
      projectId,
      openerId: OPENER,
      targetId: "debug.node-script",
      workspaceRoot: workspace(),
      relativePath: "script.js",
    });
    if (!created.ok) throw new Error("setup failed");
    return created.session;
  }

  const revokedReason = (sessionId: string) =>
    osStore
      .listAudit()
      .filter((e) => e.type === "debugger.authorization.revoked" && e.sessionId === sessionId)
      .map((e) => String(e.reason));

  afterEach(() => {
    rmSync(storePath, { recursive: true, force: true });
    rmSync(bakPath, { recursive: true, force: true });
    osStore.unloadForTests();
  });

  it("revokes when ownership was recovered from a backup, even though the backup names the opener", () => {
    const project = crypto.randomUUID();
    const session = openOwned(project);
    expect(runDebugOwnershipWatchdogOnce()).toBe(0);

    writeFileSync(
      bakPath,
      JSON.stringify({ projects: [], meta: { "g5.projectOwners.v1": JSON.stringify({ [project]: OPENER }) } }),
    );
    writeFileSync(storePath, "{not-json");
    osStore.unloadForTests();

    expect(runDebugOwnershipWatchdogOnce()).toBe(1);
    expect(getDebugSession(session.sessionId)?.status).toBe("AUTHORIZATION_REVOKED");
    expect(revokedReason(session.sessionId).join()).toContain("RECOVERED_FROM_BACKUP");
  });

  it("revokes when persisted state is unusable (MALFORMED)", () => {
    const project = crypto.randomUUID();
    const session = openOwned(project);
    writeFileSync(storePath, "{not-json");
    osStore.unloadForTests();
    expect(runDebugOwnershipWatchdogOnce()).toBe(1);
    expect(getDebugSession(session.sessionId)?.status).toBe("AUTHORIZATION_REVOKED");
    expect(revokedReason(session.sessionId).join()).toContain("MALFORMED");
  });

  it("revokes when persisted state cannot be read (UNAVAILABLE)", () => {
    const project = crypto.randomUUID();
    const session = openOwned(project);
    mkdirSync(storePath);
    osStore.unloadForTests();
    expect(runDebugOwnershipWatchdogOnce()).toBe(1);
    expect(getDebugSession(session.sessionId)?.status).toBe("AUTHORIZATION_REVOKED");
    expect(revokedReason(session.sessionId).join()).toContain("UNAVAILABLE");
  });

  it("a failure while checking one session revokes only that session and the sweep continues", () => {
    const first = openOwned(crypto.randomUUID());
    const second = openOwned(crypto.randomUUID());
    vi.spyOn(osStore, "getMeta").mockImplementationOnce(() => {
      throw new Error("ownership read failed");
    });
    try {
      expect(runDebugOwnershipWatchdogOnce()).toBe(1);
    } finally {
      vi.restoreAllMocks();
    }
    expect(getDebugSession(first.sessionId)?.status).toBe("AUTHORIZATION_REVOKED");
    expect(getDebugSession(second.sessionId)?.status).toBe("ACTIVE");
    expect(revokedReason(first.sessionId).join()).toContain("ownership=ERROR");
  });

  it("a session whose opener is the authorization-grade owner is untouched", () => {
    const session = openOwned(crypto.randomUUID());
    expect(runDebugOwnershipWatchdogOnce()).toBe(0);
    expect(getDebugSession(session.sessionId)?.status).toBe("ACTIVE");
  });
});

describe("failed launch: no process means no session (C5)", () => {
  it("a spawn that fails asynchronously is SPAWN_FAILED and leaves no session, watchdog or audit behind", () => {
    const dir = workspace();
    const notADirectory = join(dir, "regular-file.txt");
    writeFileSync(notADirectory, "not a directory");
    const projectId = crypto.randomUUID();

    const result = createDebugSession({
      projectId,
      openerId: OPENER,
      targetId: "debug.node-script",
      workspaceRoot: notADirectory,
      relativePath: ".",
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.denial).toBe("SPAWN_FAILED");
    expect(hasActiveDebugSessionForTarget(projectId, "debug.node-script")).toBe(false);
    expect(isDebugWatchdogRunning()).toBe(false);
    expect(osStore.listAudit().filter((e) => e.projectId === projectId)).toEqual([]);
  });

  it("a normal launch still produces an ACTIVE session with a real pid", () => {
    const result = createDebugSession({
      projectId: crypto.randomUUID(),
      openerId: OPENER,
      targetId: "debug.node-script",
      workspaceRoot: workspace(),
      relativePath: "script.js",
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.session.pid).toBeGreaterThan(0);
  });
});
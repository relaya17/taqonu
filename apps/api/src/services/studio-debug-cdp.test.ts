import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectInspector, InspectorError, parseInspectorAnnouncement } from "./studio-debug-cdp.js";

process.env.ATLAS_STORE_PATH = join(mkdtempSync(join(tmpdir(), "atlas-debug-cdp-store-")), "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";

const {
  createDebugSession,
  dispatchDebugAction,
  getDebugSession,
  getDebugSessionInternal,
  resetDebugSessionsForTests,
  revokeDebugSessionAuthorization,
  systemCloseDebugSession,
} = await import("./studio-debug-session.js");
const { bindProjectOwner } = await import("./project-access.js");
const { osStore } = await import("../store/os-store.js");

const OPENER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

const dirs: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  resetDebugSessionsForTests();
  await new Promise((r) => setTimeout(r, 300));
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

interface Workspace {
  readonly dir: string;
  readonly started: string;
  readonly ticks: string;
}

/** The script reports its own progress to files, so "paused" and "running" are observed, not assumed. */
function workspace(): Workspace {
  const dir = mkdtempSync(join(tmpdir(), "atlas-debug-cdp-"));
  dirs.push(dir);
  const started = join(dir, "started.txt");
  const ticks = join(dir, "ticks.txt");
  writeFileSync(
    join(dir, "script.js"),
    [
      'const fs = require("node:fs");',
      `fs.writeFileSync(${JSON.stringify(started)}, "1");`,
      "let n = 0;",
      `setInterval(() => { n += 1; fs.writeFileSync(${JSON.stringify(ticks)}, String(n)); }, 50);`,
      "",
    ].join("\n"),
  );
  return { dir, started, ticks };
}

function open(ws: Workspace, projectId: string = crypto.randomUUID()) {
  bindProjectOwner(projectId, OPENER, "bound_on_create");
  const created = createDebugSession({
    projectId,
    openerId: OPENER,
    targetId: "debug.node-script",
    workspaceRoot: ws.dir,
    relativePath: "script.js",
  });
  if (!created.ok) throw new Error(`setup failed: ${created.reason}`);
  return created.session;
}

const act = (sessionId: string, action: Parameters<typeof dispatchDebugAction>[0]["action"], expression?: string) =>
  dispatchDebugAction({ sessionId, actorId: OPENER, action, ...(expression !== undefined ? { expression } : {}) });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/**
 * The target rewrites this file every 50 ms (truncate, then write), so a read can land between the
 * two and see it empty. An empty read is not a tick count: re-read instead of reporting 0.
 */
const readTicks = (ws: Workspace): number => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!existsSync(ws.ticks)) return 0;
    const text = readFileSync(ws.ticks, "utf8");
    if (text.length > 0) return Number(text);
  }
  return Number.NaN;
};

async function waitUntilDead(pid: number, ms = 4000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await sleep(50);
  }
  return false;
}

const auditTypes = (sessionId: string) =>
  osStore
    .listAudit()
    .filter((e) => e.sessionId === sessionId)
    .map((e) => String(e.type));

describe("Inspector announcement parsing (loopback only)", () => {
  it("accepts the loopback announcement the target prints", () => {
    expect(
      parseInspectorAnnouncement(
        "Debugger listening on ws://127.0.0.1:54995/743a6555-e4eb-49fc-8026-71e4780cd31c\nFor help, see: https://nodejs.org/en/docs/inspector\n",
      ),
    ).toBe("ws://127.0.0.1:54995/743a6555-e4eb-49fc-8026-71e4780cd31c");
  });

  it.each([
    "Debugger listening on ws://0.0.0.0:9229/743a6555-e4eb-49fc-8026-71e4780cd31c",
    "Debugger listening on ws://192.168.1.5:9229/743a6555-e4eb-49fc-8026-71e4780cd31c",
    "Debugger listening on ws://evil.example:9229/743a6555-e4eb-49fc-8026-71e4780cd31c",
    "Debugger listening on ws://127.0.0.1.evil.example:9229/743a6555-e4eb-49fc-8026-71e4780cd31c",
    "Debugger listening on ws://127.0.0.1:9229/",
    "no announcement here",
    "",
  ])("rejects %j", (text) => {
    expect(parseInspectorAnnouncement(text)).toBeNull();
  });
});

describe("connectInspector failure never leaks the endpoint", () => {
  it("a refused connection is CONNECT_FAILED with a fixed message", async () => {
    const url = "ws://127.0.0.1:1/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const error = await connectInspector({
      readStderr: () => `Debugger listening on ${url}`,
      onClosed: () => undefined,
      onTargetFinished: () => undefined,
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(InspectorError);
    expect((error as InspectorError).category).toBe("CONNECT_FAILED");
    expect((error as InspectorError).message).not.toContain("aaaaaaaa");
    expect((error as InspectorError).message).not.toContain("127.0.0.1");
  });
});

describe("CDP vertical slice: a real Node target under --inspect-brk", () => {
  it("reaches the Inspector, releases the initial wait, observes the pause, and resumes and pauses for real", async () => {
    const ws = workspace();
    const session = open(ws);

    // Paused at entry: the script has not run a single statement yet.
    await sleep(300);
    expect(existsSync(ws.started)).toBe(false);

    // First action: the controller connects, Debugger.enable, Runtime.runIfWaitingForDebugger, Debugger.paused observed.
    const first = await act(session.sessionId, "pause");
    expect(first).toMatchObject({ ok: true, state: "paused" });
    expect(existsSync(ws.started)).toBe(false);
    expect(auditTypes(session.sessionId)).toContain("debugger.inspector.connected");

    // Debugger.resume: the script really runs.
    const resumed = await act(session.sessionId, "continue");
    expect(resumed).toMatchObject({ ok: true, state: "running" });
    await sleep(500);
    expect(existsSync(ws.started)).toBe(true);
    const whileRunning = readTicks(ws);
    expect(whileRunning).toBeGreaterThan(0);

    // Debugger.pause: the script really stops making progress.
    const paused = await act(session.sessionId, "pause");
    expect(paused).toMatchObject({ ok: true, state: "paused" });
    await sleep(200);
    const atPause = readTicks(ws);
    await sleep(500);
    expect(readTicks(ws)).toBe(atPause);

    // Resume again: progress continues.
    expect(await act(session.sessionId, "continue")).toMatchObject({ ok: true, state: "running" });
    await sleep(500);
    expect(readTicks(ws)).toBeGreaterThan(atPause);
  }, 30_000);

  it("Runtime.evaluate runs inside the approved target and returns bounded summaries", async () => {
    const ws = workspace();
    const session = open(ws);

    const pid = await act(session.sessionId, "evaluate", "process.pid");
    expect(pid.ok && pid.evaluation).toMatchObject({ type: "number", value: session.pid });

    const sum = await act(session.sessionId, "evaluate", "40 + 2");
    expect(sum.ok && sum.evaluation).toMatchObject({ type: "number", value: 42 });

    const text = await act(session.sessionId, "evaluate", '"hello"');
    expect(text.ok && text.evaluation).toMatchObject({ type: "string", value: "hello" });

    const object = await act(session.sessionId, "evaluate", "({ secret: 'not-returned-by-value' })");
    expect(object.ok && object.evaluation?.type).toBe("object");
    expect(object.ok && object.evaluation?.value).toBeUndefined();

    const thrown = await act(session.sessionId, "evaluate", 'throw new Error("boom")');
    expect(thrown.ok && thrown.evaluation?.type).toBe("exception");
    expect(thrown.ok && thrown.evaluation?.exception).toContain("boom");

    const long = await act(session.sessionId, "evaluate", '"x".repeat(5000)');
    expect(long.ok && typeof long.evaluation?.value === "string" && long.evaluation.value.length).toBeLessThan(2100);

    // Evaluating does not release the initial wait differently: state stays coherent.
    expect(getDebugSession(session.sessionId)?.status).toBe("ACTIVE");
  }, 30_000);

  it("audit/evidence records the lifecycle but never the expression, the result, or the Inspector endpoint", async () => {
    const ws = workspace();
    const session = open(ws);
    await act(session.sessionId, "evaluate", "'distinctive-secret-expression-' + (40 + 2)");
    await act(session.sessionId, "continue");
    systemCloseDebugSession(session.sessionId, "timeout");

    const entries = osStore.listAudit().filter((e) => e.sessionId === session.sessionId);
    const types = entries.map((e) => String(e.type));
    expect(types).toEqual(
      expect.arrayContaining([
        "debugger.session.opened",
        "debugger.inspector.connected",
        "debugger.action.performed",
        "debugger.inspector.command",
        "debugger.session.expired",
      ]),
    );
    const evaluateCommand = entries.find((e) => e.type === "debugger.inspector.command" && e.action === "evaluate");
    expect(evaluateCommand).toMatchObject({ ok: true, method: "Runtime.evaluate" });
    expect(evaluateCommand?.expressionChars).toBe("'distinctive-secret-expression-' + (40 + 2)".length);

    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain("distinctive-secret-expression");
    expect(serialized).not.toContain("distinctive-secret-expression-42");
    expect(serialized).not.toMatch(/ws:\/\//);
    expect(serialized).not.toMatch(/127\.0\.0\.1/);
  }, 30_000);

  it("is governed by session authorization first: a non-opener never reaches the Inspector", async () => {
    const ws = workspace();
    const session = open(ws);
    const result = await dispatchDebugAction({ sessionId: session.sessionId, actorId: OTHER, action: "evaluate", expression: "1" });
    expect(result).toMatchObject({ ok: false, denial: "NOT_OPENER" });
    expect(auditTypes(session.sessionId)).not.toContain("debugger.inspector.connected");
    expect(getDebugSessionInternal(session.sessionId)?.inspectorConn).toBeUndefined();
  }, 30_000);

  it("actions that are not wired yet are refused honestly: no authorization record, no Inspector contact", async () => {
    const ws = workspace();
    const session = open(ws);
    for (const action of ["step", "breakpoint.add", "breakpoint.remove", "inspect"] as const) {
      expect(await act(session.sessionId, action)).toMatchObject({ ok: false, denial: "ACTION_NOT_SUPPORTED" });
    }
    const types = auditTypes(session.sessionId);
    expect(types).not.toContain("debugger.action.performed");
    expect(types).not.toContain("debugger.inspector.connected");
  }, 30_000);

  it("validates the evaluate expression before any Inspector contact", async () => {
    const ws = workspace();
    const session = open(ws);
    expect(await act(session.sessionId, "evaluate")).toMatchObject({ ok: false, denial: "EXPRESSION_INVALID" });
    expect(await act(session.sessionId, "evaluate", "   ")).toMatchObject({ ok: false, denial: "EXPRESSION_INVALID" });
    expect(await act(session.sessionId, "evaluate", "x".repeat(4097))).toMatchObject({ ok: false, denial: "EXPRESSION_INVALID" });
    expect(await act(session.sessionId, "pause", "1+1")).toMatchObject({ ok: false, denial: "EXPRESSION_INVALID" });
    expect(auditTypes(session.sessionId)).not.toContain("debugger.inspector.connected");
  }, 30_000);

  it("concurrent actions are serialized and all succeed", async () => {
    const ws = workspace();
    const session = open(ws);
    const results = await Promise.all([
      act(session.sessionId, "pause"),
      act(session.sessionId, "evaluate", "1 + 1"),
      act(session.sessionId, "evaluate", "2 + 2"),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(auditTypes(session.sessionId).filter((t) => t === "debugger.inspector.connected")).toHaveLength(1);
  }, 30_000);
});

describe("CDP lifecycle: disconnect, authorization loss, expiry, deterministic cleanup", () => {
  it("authorization loss closes the Inspector connection, kills the child and blocks further actions", async () => {
    const ws = workspace();
    const session = open(ws);
    await act(session.sessionId, "continue");
    expect(getDebugSessionInternal(session.sessionId)?.inspectorConn).toBeDefined();

    revokeDebugSessionAuthorization(session.sessionId, "project access lost (403)");
    expect(getDebugSession(session.sessionId)?.status).toBe("AUTHORIZATION_REVOKED");
    expect(getDebugSessionInternal(session.sessionId)?.inspectorConn).toBeUndefined();
    expect(await waitUntilDead(session.pid)).toBe(true);
    expect(await act(session.sessionId, "evaluate", "1")).toMatchObject({ ok: false, denial: "SESSION_NOT_ACTIVE" });
    expect(auditTypes(session.sessionId).filter((t) => t === "debugger.authorization.revoked")).toHaveLength(1);
  }, 30_000);

  it("idle/system expiry closes the Inspector connection and kills the child", async () => {
    const ws = workspace();
    const session = open(ws);
    await act(session.sessionId, "continue");
    systemCloseDebugSession(session.sessionId, "timeout");
    expect(getDebugSession(session.sessionId)?.status).toBe("SESSION_EXPIRED");
    expect(getDebugSessionInternal(session.sessionId)?.inspectorConn).toBeUndefined();
    expect(await waitUntilDead(session.pid)).toBe(true);
  }, 30_000);

  it("the hard lifetime deadline stops an action before it reaches the Inspector", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const ws = workspace();
    const session = open(ws);
    vi.setSystemTime(Date.now() + 4 * 60 * 60 * 1000 + 1);
    const result = await act(session.sessionId, "evaluate", "1");
    expect(result).toMatchObject({ ok: false, denial: "SESSION_NOT_ACTIVE" });
    expect(getDebugSession(session.sessionId)?.status).toBe("SESSION_EXPIRED");
    expect(auditTypes(session.sessionId)).not.toContain("debugger.inspector.connected");
    vi.useRealTimers();
    expect(await waitUntilDead(session.pid)).toBe(true);
  }, 30_000);

  it("a target that exits while the Inspector is connected ends the session deterministically", async () => {
    const ws = workspace();
    const session = open(ws);
    await act(session.sessionId, "continue");

    const result = await act(session.sessionId, "evaluate", "process.exit(0)");
    expect(result.ok).toBe(false);
    expect(await waitUntilDead(session.pid)).toBe(true);
    await sleep(300);

    expect(getDebugSession(session.sessionId)?.status).toBe("TARGET_TERMINATED");
    expect(getDebugSessionInternal(session.sessionId)?.inspectorConn).toBeUndefined();
    expect(auditTypes(session.sessionId).filter((t) => t === "debugger.target.terminated")).toHaveLength(1);
    expect(await act(session.sessionId, "continue")).toMatchObject({ ok: false, denial: "SESSION_NOT_ACTIVE" });
  }, 30_000);

  it("an Inspector disconnect while the process is still alive is audited and ends the session and the child", async () => {
    const ws = workspace();
    const session = open(ws);
    await act(session.sessionId, "continue");

    // Deactivates the target's own Inspector: the socket drops, the process stays alive.
    await act(session.sessionId, "evaluate", 'process.getBuiltinModule("node:inspector").close()');
    await sleep(500);

    const types = auditTypes(session.sessionId);
    expect(types).toContain("debugger.inspector.disconnected");
    expect(getDebugSession(session.sessionId)?.status).toBe("TARGET_TERMINATED");
    expect(await waitUntilDead(session.pid)).toBe(true);
    expect(getDebugSessionInternal(session.sessionId)?.inspectorConn).toBeUndefined();
    expect(types.filter((t) => t === "debugger.target.terminated")).toHaveLength(1);
  }, 30_000);

  it("voluntary close and reset leave no Inspector connection behind", async () => {
    const ws = workspace();
    const session = open(ws);
    await act(session.sessionId, "pause");
    expect(getDebugSessionInternal(session.sessionId)?.inspectorConn).toBeDefined();
    resetDebugSessionsForTests();
    expect(await waitUntilDead(session.pid)).toBe(true);
  }, 30_000);
});

describe("CDP lifecycle: a target that finishes on its own", () => {
  it("Node's wait-for-disconnect is handled: the session ends and the process does not hang", async () => {
    const dir = mkdtempSync(join(tmpdir(), "atlas-debug-cdp-finish-"));
    dirs.push(dir);
    const marker = join(dir, "done.txt");
    writeFileSync(join(dir, "script.js"), `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "done");\n`);
    const projectId = crypto.randomUUID();
    bindProjectOwner(projectId, OPENER, "bound_on_create");
    const created = createDebugSession({
      projectId,
      openerId: OPENER,
      targetId: "debug.node-script",
      workspaceRoot: dir,
      relativePath: "script.js",
    });
    if (!created.ok) throw new Error("setup failed");
    const session = created.session;

    expect(await act(session.sessionId, "pause")).toMatchObject({ ok: true, state: "paused" });
    expect(existsSync(marker)).toBe(false);

    await act(session.sessionId, "continue");
    expect(await waitUntilDead(session.pid, 8000)).toBe(true);
    await sleep(300);

    expect(existsSync(marker)).toBe(true);
    expect(getDebugSession(session.sessionId)?.status).toBe("TARGET_TERMINATED");
    expect(getDebugSessionInternal(session.sessionId)?.inspectorConn).toBeUndefined();
    const types = auditTypes(session.sessionId);
    expect(types).toContain("debugger.inspector.target_finished");
    expect(types.filter((t) => t === "debugger.target.terminated")).toHaveLength(1);
  }, 30_000);
});
describe("session snapshot reports the real target state", () => {
  it("NOT_ATTACHED -> PAUSED -> RUNNING -> PAUSED -> ENDED follows what the controller observed", async () => {
    const ws = workspace();
    const session = open(ws);
    const state = () => getDebugSession(session.sessionId)?.targetState;

    expect(state()).toBe("NOT_ATTACHED");
    expect(await act(session.sessionId, "pause")).toMatchObject({ ok: true, state: "paused" });
    expect(state()).toBe("PAUSED");
    expect(await act(session.sessionId, "continue")).toMatchObject({ ok: true, state: "running" });
    expect(state()).toBe("RUNNING");
    expect(await act(session.sessionId, "pause")).toMatchObject({ ok: true, state: "paused" });
    expect(state()).toBe("PAUSED");

    systemCloseDebugSession(session.sessionId, "timeout");
    expect(state()).toBe("ENDED");
  }, 30_000);

  it("is ENDED for every terminal status and never exposes Inspector details", async () => {
    const ws = workspace();
    const session = open(ws);
    await act(session.sessionId, "continue");
    revokeDebugSessionAuthorization(session.sessionId, "project access lost (403)");
    const snapshot = getDebugSession(session.sessionId);
    expect(snapshot?.targetState).toBe("ENDED");
    expect(Object.keys(snapshot ?? {}).sort()).toEqual(
      ["createdAt", "lastActivityAt", "openerId", "pid", "projectId", "sessionId", "status", "targetId", "targetState"].sort(),
    );
    expect(JSON.stringify(snapshot)).not.toMatch(/ws:\/\/|127\.0\.0\.1/);
  }, 30_000);
});
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildStudioPtyEnv,
  closeStudioPty,
  createStudioPtySession,
  eofStudioPty,
  isAgentPtyRequest,
  listStudioPtySessions,
  reconnectStudioPty,
  resetStudioPtyForTests,
  resizeStudioPty,
  setStudioPtySpawnerForTests,
  setStudioPtyTimeoutsForTests,
  STUDIO_PTY_DISCONNECT_POLICY,
  subscribeStudioPty,
  writeStudioPty,
  type StudioPtySpawner,
} from "./studio-pty.js";

const dirs: string[] = [];

afterEach(() => {
  resetStudioPtyForTests();
  setStudioPtySpawnerForTests(null);
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tmpWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "atlas-pty-"));
  dirs.push(dir);
  writeFileSync(join(dir, "README.md"), "# pty fixture\n", "utf8");
  return dir;
}

function echoSpawner(written?: string[]): StudioPtySpawner {
  return () => {
    let onData: ((data: string) => void) | undefined;
    let onExit: ((event: { exitCode: number; signal?: number }) => void) | undefined;
    return {
      pid: 4242,
      write(data: string) {
        written?.push(data);
        onData?.(`OUT:${data}`);
        if (data.includes("err")) onData?.("ERR:boom\n");
      },
      resize() {
        /* no-op */
      },
      kill() {
        onExit?.({ exitCode: 0 });
      },
      onData(listener) {
        onData = listener;
      },
      onExit(listener) {
        onExit = listener;
      },
    };
  };
}

function floodSpawner(chunk: string): StudioPtySpawner {
  return () => {
    let onData: ((data: string) => void) | undefined;
    let onExit: ((event: { exitCode: number; signal?: number }) => void) | undefined;
    return {
      pid: 7,
      write() {
        onData?.(chunk);
      },
      resize() {
        /* no-op */
      },
      kill() {
        onExit?.({ exitCode: 0 });
      },
      onData(listener) {
        onData = listener;
      },
      onExit(listener) {
        onExit = listener;
      },
    };
  };
}

describe("Studio PTY security helpers", () => {
  it("treats agent actor headers as PTY-ineligible", () => {
    expect(isAgentPtyRequest({ "x-atlas-actor-kind": "AGENT" })).toBe(true);
    expect(isAgentPtyRequest({ "x-atlas-agent-id": "CODE_ENGINEER" })).toBe(true);
    expect(isAgentPtyRequest({ authorization: "Bearer human" })).toBe(false);
  });

  it("does not copy secrets into the PTY environment", () => {
    const previous = process.env.ATLAS_FAKE_PTY_SECRET;
    process.env.ATLAS_FAKE_PTY_SECRET = "leak-me";
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "not-for-pty";
    try {
      const env = buildStudioPtyEnv();
      expect(env.ATLAS_FAKE_PTY_SECRET).toBeUndefined();
      expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
      expect(env.TERM).toBe("xterm-256color");
    } finally {
      if (previous === undefined) delete process.env.ATLAS_FAKE_PTY_SECRET;
      else process.env.ATLAS_FAKE_PTY_SECRET = previous;
    }
  });
});

describe("Studio PTY session manager", () => {
  it("creates a session, delivers stdin/stdout, resizes, and closes", () => {
    setStudioPtySpawnerForTests(echoSpawner());
    const workspace = tmpWorkspace();
    const created = createStudioPtySession({
      projectId: "00000000-0000-4000-8000-000000000001",
      ownerId: "11111111-1111-4111-8111-111111111111",
      workspaceRoot: workspace,
      shell: "powershell",
    });
    expect(created.snapshot.status).toBe("running");
    expect(created.snapshot.cwd).toContain("atlas-pty-");
    expect(created.ticket.length).toBeGreaterThan(8);

    const chunks: string[] = [];
    const sub = subscribeStudioPty(
      created.snapshot.sessionId,
      created.snapshot.ownerId,
      created.ticket,
      {
        onData: (data) => chunks.push(data),
        onExit: () => undefined,
      },
    );
    writeStudioPty(created.snapshot.sessionId, created.snapshot.ownerId, "hello\r");
    expect(chunks.some((chunk) => chunk.includes("OUT:hello"))).toBe(true);
    writeStudioPty(created.snapshot.sessionId, created.snapshot.ownerId, "err\r");
    expect(chunks.some((chunk) => chunk.includes("ERR:boom"))).toBe(true);

    const resized = resizeStudioPty(
      created.snapshot.sessionId,
      created.snapshot.ownerId,
      80,
      24,
    );
    expect(resized.cols).toBe(80);
    expect(resized.rows).toBe(24);

    closeStudioPty(created.snapshot.sessionId, created.snapshot.ownerId);
    expect(
      listStudioPtySessions(created.snapshot.projectId, created.snapshot.ownerId),
    ).toEqual([]);
    sub.unsubscribe();
  });

  it("isolates sessions by owner and caps concurrent sessions", () => {
    setStudioPtySpawnerForTests(echoSpawner());
    const workspace = tmpWorkspace();
    const projectId = "00000000-0000-4000-8000-000000000002";
    const ownerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const ownerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const first = createStudioPtySession({
      projectId,
      ownerId: ownerA,
      workspaceRoot: workspace,
    });
    expect(
      listStudioPtySessions(projectId, ownerB),
    ).toEqual([]);
    expect(() =>
      writeStudioPty(first.snapshot.sessionId, ownerB, "stolen"),
    ).toThrow(/another user/i);

    for (let i = 0; i < 3; i += 1) {
      createStudioPtySession({ projectId, ownerId: ownerA, workspaceRoot: workspace });
    }
    expect(() =>
      createStudioPtySession({ projectId, ownerId: ownerA, workspaceRoot: workspace }),
    ).toThrow(/4 open terminals/i);
  });

  it("refuses a missing workspace", () => {
    setStudioPtySpawnerForTests(echoSpawner());
    expect(() =>
      createStudioPtySession({
        projectId: "00000000-0000-4000-8000-000000000003",
        ownerId: "11111111-1111-4111-8111-111111111111",
        workspaceRoot: join(tmpdir(), "atlas-pty-missing-xyz"),
      }),
    ).toThrow(/workspaceRoot/i);
  });
});

describe("Studio PTY live node-pty", () => {
  it("spawns a real Windows shell, captures output, interrupts, and cleans up", async () => {
    if (process.platform !== "win32") return;
    const workspace = tmpWorkspace();
    mkdirSync(join(workspace, "nested"), { recursive: true });
    const created = createStudioPtySession({
      projectId: "00000000-0000-4000-8000-000000000099",
      ownerId: "11111111-1111-4111-8111-111111111111",
      workspaceRoot: workspace,
      shell: "powershell",
    });
    const output: string[] = [];
    const sub = subscribeStudioPty(
      created.snapshot.sessionId,
      created.snapshot.ownerId,
      created.ticket,
      {
        onData: (data) => output.push(data),
        onExit: () => undefined,
      },
    );

    const waitFor = async (needle: string, ms = 12_000) => {
      const start = Date.now();
      while (Date.now() - start < ms) {
        if (output.join("").includes(needle)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`PTY output did not include ${JSON.stringify(needle)}\n${output.join("")}`);
    };

    await waitFor("PS ", 12_000);
    writeStudioPty(
      created.snapshot.sessionId,
      created.snapshot.ownerId,
      `Write-Output 'PTY_STDOUT_OK'\r`,
    );
    await waitFor("PTY_STDOUT_OK");
    writeStudioPty(
      created.snapshot.sessionId,
      created.snapshot.ownerId,
      `[Console]::Error.WriteLine('PTY_STDERR_OK')\r`,
    );
    await waitFor("PTY_STDERR_OK");
    writeStudioPty(
      created.snapshot.sessionId,
      created.snapshot.ownerId,
      `Get-Location | Select-Object -ExpandProperty Path\r`,
    );
    await waitFor("atlas-pty-");
    writeStudioPty(
      created.snapshot.sessionId,
      created.snapshot.ownerId,
      `ping -n 25 127.0.0.1\r`,
    );
    await waitFor("Pinging", 8_000);
    writeStudioPty(created.snapshot.sessionId, created.snapshot.ownerId, "\x03");
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(created.snapshot.pid).toBeGreaterThan(0);
    closeStudioPty(created.snapshot.sessionId, created.snapshot.ownerId);
    expect(
      listStudioPtySessions(created.snapshot.projectId, created.snapshot.ownerId),
    ).toEqual([]);
    sub.unsubscribe();
  }, 30_000);

  it("spawns cmd.exe on Windows and captures echo output", async () => {
    if (process.platform !== "win32") return;
    const workspace = tmpWorkspace();
    const created = createStudioPtySession({
      projectId: "00000000-0000-4000-8000-000000000098",
      ownerId: "11111111-1111-4111-8111-111111111111",
      workspaceRoot: workspace,
      shell: "cmd",
    });
    const output: string[] = [];
    subscribeStudioPty(
      created.snapshot.sessionId,
      created.snapshot.ownerId,
      created.ticket,
      {
        onData: (data) => output.push(data),
        onExit: () => undefined,
      },
    );
    const waitFor = async (needle: string, ms = 12_000) => {
      const start = Date.now();
      while (Date.now() - start < ms) {
        if (output.join("").includes(needle)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`cmd PTY output did not include ${JSON.stringify(needle)}\n${output.join("")}`);
    };
    writeStudioPty(
      created.snapshot.sessionId,
      created.snapshot.ownerId,
      "echo PTY_CMD_OK\r\n",
    );
    await waitFor("PTY_CMD_OK");
    expect(created.snapshot.shell).toBe("cmd");
    eofStudioPty(created.snapshot.sessionId, created.snapshot.ownerId);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(
      listStudioPtySessions(created.snapshot.projectId, created.snapshot.ownerId),
    ).toHaveLength(1);
    closeStudioPty(created.snapshot.sessionId, created.snapshot.ownerId);
  }, 20_000);

  it("keeps a live PowerShell session after EOF (EOT is not Close)", async () => {
    if (process.platform !== "win32") return;
    const workspace = tmpWorkspace();
    const created = createStudioPtySession({
      projectId: "00000000-0000-4000-8000-000000000097",
      ownerId: "11111111-1111-4111-8111-111111111111",
      workspaceRoot: workspace,
      shell: "powershell",
    });
    eofStudioPty(created.snapshot.sessionId, created.snapshot.ownerId);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(
      listStudioPtySessions(created.snapshot.projectId, created.snapshot.ownerId),
    ).toHaveLength(1);
    closeStudioPty(created.snapshot.sessionId, created.snapshot.ownerId);
  }, 20_000);
});

describe("Studio PTY reconnect and lifecycle", () => {
  it("rotates the stream ticket without spawning a second process", () => {
    setStudioPtySpawnerForTests(echoSpawner());
    const workspace = tmpWorkspace();
    const projectId = "00000000-0000-4000-8000-000000000010";
    const ownerId = "11111111-1111-4111-8111-111111111111";
    const created = createStudioPtySession({
      projectId,
      ownerId,
      workspaceRoot: workspace,
    });
    const pid = created.snapshot.pid;
    const firstTicket = created.ticket;
    const reconnected = reconnectStudioPty({
      sessionId: created.snapshot.sessionId,
      ownerId,
      projectId,
    });
    expect(reconnected.snapshot.pid).toBe(pid);
    expect(reconnected.ticket).not.toBe(firstTicket);
    expect(listStudioPtySessions(projectId, ownerId)).toHaveLength(1);

    expect(() =>
      subscribeStudioPty(created.snapshot.sessionId, ownerId, firstTicket, {
        onData: () => undefined,
        onExit: () => undefined,
      }),
    ).toThrow(/ticket/i);

    const chunks: string[] = [];
    subscribeStudioPty(created.snapshot.sessionId, ownerId, reconnected.ticket, {
      onData: (data) => chunks.push(data),
      onExit: () => undefined,
    });
    writeStudioPty(created.snapshot.sessionId, ownerId, "after-reconnect\r");
    expect(chunks.some((chunk) => chunk.includes("after-reconnect"))).toBe(true);
  });

  it("denies cross-user and cross-project reconnect", () => {
    setStudioPtySpawnerForTests(echoSpawner());
    const workspace = tmpWorkspace();
    const created = createStudioPtySession({
      projectId: "00000000-0000-4000-8000-000000000011",
      ownerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      workspaceRoot: workspace,
    });
    expect(() =>
      reconnectStudioPty({
        sessionId: created.snapshot.sessionId,
        ownerId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        projectId: created.snapshot.projectId,
      }),
    ).toThrow(/another user/i);
    expect(() =>
      reconnectStudioPty({
        sessionId: created.snapshot.sessionId,
        ownerId: created.snapshot.ownerId,
        projectId: "00000000-0000-4000-8000-000000000099",
      }),
    ).toThrow(/another project/i);
  });

  it("treats closed and missing sessions as stale, not reconnectable", () => {
    setStudioPtySpawnerForTests(echoSpawner());
    const workspace = tmpWorkspace();
    const created = createStudioPtySession({
      projectId: "00000000-0000-4000-8000-000000000012",
      ownerId: "11111111-1111-4111-8111-111111111111",
      workspaceRoot: workspace,
    });
    closeStudioPty(created.snapshot.sessionId, created.snapshot.ownerId);
    expect(() =>
      reconnectStudioPty({
        sessionId: created.snapshot.sessionId,
        ownerId: created.snapshot.ownerId,
        projectId: created.snapshot.projectId,
      }),
    ).toThrow(/not running/i);
  });

  it("keeps the process when a stream unsubscribes (SSE / reload / unmount)", () => {
    expect(STUDIO_PTY_DISCONNECT_POLICY.sseDisconnect).toBe("unsubscribe-only");
    expect(STUDIO_PTY_DISCONNECT_POLICY.pageReload).toBe("keep-process");
    expect(STUDIO_PTY_DISCONNECT_POLICY.explicitClose).toBe("kill-process");
    setStudioPtySpawnerForTests(echoSpawner());
    const workspace = tmpWorkspace();
    const created = createStudioPtySession({
      projectId: "00000000-0000-4000-8000-000000000013",
      ownerId: "11111111-1111-4111-8111-111111111111",
      workspaceRoot: workspace,
    });
    const sub = subscribeStudioPty(
      created.snapshot.sessionId,
      created.snapshot.ownerId,
      created.ticket,
      { onData: () => undefined, onExit: () => undefined },
    );
    sub.unsubscribe();
    expect(listStudioPtySessions(created.snapshot.projectId, created.snapshot.ownerId)).toHaveLength(
      1,
    );
    closeStudioPty(created.snapshot.sessionId, created.snapshot.ownerId);
    expect(listStudioPtySessions(created.snapshot.projectId, created.snapshot.ownerId)).toEqual([]);
  });

  it("kills an idle session and a lifetime session", async () => {
    setStudioPtySpawnerForTests(echoSpawner());
    setStudioPtyTimeoutsForTests({ idleMs: 40, lifetimeMs: 10_000 });
    const workspace = tmpWorkspace();
    const idle = createStudioPtySession({
      projectId: "00000000-0000-4000-8000-000000000014",
      ownerId: "11111111-1111-4111-8111-111111111111",
      workspaceRoot: workspace,
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(listStudioPtySessions(idle.snapshot.projectId, idle.snapshot.ownerId)).toEqual([]);

    setStudioPtyTimeoutsForTests({ idleMs: 10_000, lifetimeMs: 40 });
    const lifetime = createStudioPtySession({
      projectId: "00000000-0000-4000-8000-000000000015",
      ownerId: "11111111-1111-4111-8111-111111111111",
      workspaceRoot: workspace,
    });
    writeStudioPty(lifetime.snapshot.sessionId, lifetime.snapshot.ownerId, "keep-idle-reset\r");
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(
      listStudioPtySessions(lifetime.snapshot.projectId, lifetime.snapshot.ownerId),
    ).toEqual([]);
  });

  it("rejects oversized input, truncates scrollback, and caps global sessions", () => {
    const written: string[] = [];
    setStudioPtySpawnerForTests(echoSpawner(written));
    const workspace = tmpWorkspace();
    const ownerId = "11111111-1111-4111-8111-111111111111";
    const created = createStudioPtySession({
      projectId: "00000000-0000-4000-8000-000000000016",
      ownerId,
      workspaceRoot: workspace,
    });
    expect(() =>
      writeStudioPty(created.snapshot.sessionId, ownerId, "x".repeat(32_769)),
    ).toThrow(/per-message limit/i);
    eofStudioPty(created.snapshot.sessionId, ownerId);
    expect(written.some((row) => row.includes("\x04"))).toBe(true);

    setStudioPtySpawnerForTests(floodSpawner("n".repeat(8_000)));
    const flooded = createStudioPtySession({
      projectId: "00000000-0000-4000-8000-000000000017",
      ownerId,
      workspaceRoot: workspace,
    });
    for (let i = 0; i < 12; i += 1) {
      writeStudioPty(flooded.snapshot.sessionId, ownerId, "x");
    }
    const sub = subscribeStudioPty(
      flooded.snapshot.sessionId,
      ownerId,
      flooded.ticket,
      { onData: () => undefined, onExit: () => undefined },
    );
    expect(sub.scrollback.length).toBeLessThanOrEqual(64 * 1024);
    expect(sub.scrollback.length).toBeGreaterThan(40_000);
    sub.unsubscribe();

    setStudioPtySpawnerForTests(echoSpawner());
    const extraWorkspace = tmpWorkspace();
    const owners = [
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    ];
    for (let i = 0; i < 14; i += 1) {
      createStudioPtySession({
        projectId: `00000000-0000-4000-8000-0000000000${20 + i}`,
        ownerId: owners[i % owners.length]!,
        workspaceRoot: extraWorkspace,
      });
    }
    expect(() =>
      createStudioPtySession({
        projectId: "00000000-0000-4000-8000-000000000099",
        ownerId,
        workspaceRoot: extraWorkspace,
      }),
    ).toThrow(/session limit/i);
  });
});

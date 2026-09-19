import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildStudioPtyEnv,
  closeStudioPty,
  createStudioPtySession,
  isAgentPtyRequest,
  listStudioPtySessions,
  resetStudioPtyForTests,
  resizeStudioPty,
  setStudioPtySpawnerForTests,
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

function echoSpawner(): StudioPtySpawner {
  return () => {
    let onData: ((data: string) => void) | undefined;
    let onExit: ((event: { exitCode: number; signal?: number }) => void) | undefined;
    return {
      pid: 4242,
      write(data: string) {
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
    closeStudioPty(created.snapshot.sessionId, created.snapshot.ownerId);
  }, 20_000);
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isGovernedExecutionRunning,
  killGovernedExecution,
  resetGovernedCommandRuntimeForTests,
  runGovernedCommand,
  setGovernedCommandTestLifecycleObserver,
  type GovernedCommandResult,
  type GovernedCommandTestEvent,
} from "./governed-command.js";

const dirs: string[] = [];

function classifyKillMiss(
  events: readonly GovernedCommandTestEvent[],
  stillRegistered: boolean,
): string {
  if (!events.some((event) => event.kind === "registered")) {
    return "child never became registered in running";
  }
  const reset = events.find((event) => event.kind === "reset");
  if (reset) {
    return `test cleanup/reset cleared running (ids=${reset.executionIds.join(",") || "none"})`;
  }
  const error = events.find((event) => event.kind === "error");
  if (error) return `child emitted error: ${error.message}`;
  const close = events.find((event) => event.kind === "close");
  if (close) {
    return `child emitted close before kill (code=${String(close.code)} signal=${String(close.signal)} killRequested=${String(close.killRequested)})`;
  }
  if (stillRegistered) {
    return "not_running while the execution is still registered";
  }
  return "not_running after registration with no error, close, or reset";
}

async function settledCommandSummary(pending: Promise<GovernedCommandResult>): Promise<string> {
  const settled = await Promise.race([
    pending.then((result) => ({ done: true as const, result })),
    new Promise<{ done: false }>((resolve) => {
      setTimeout(() => resolve({ done: false }), 0);
    }),
  ]);
  if (!settled.done) return "command promise still unsettled";
  if (!settled.result.ok) {
    return `command settled denial=${settled.result.denial} reason=${settled.result.reason}`;
  }
  const result = settled.result;
  return `command settled exit=${String(result.exitCode)} signal=${String(result.signal)} killed=${String(result.killed)} timedOut=${String(result.timedOut)} durationMs=${String(result.durationMs)}`;
}

afterEach(() => {
  resetGovernedCommandRuntimeForTests();
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("runGovernedCommand", () => {
  it("denies unknown command ids without spawning", async () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-gov-cmd-"));
    dirs.push(root);
    const result = await runGovernedCommand({
      commandId: "rm.rf",
      workspaceRoot: root,
      projectId: "00000000-0000-4000-8000-000000000001",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.denial).toBe("UNKNOWN_COMMAND");
    }
  });

  it("runs node.version with shell:false from process.execPath", async () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-gov-node-"));
    dirs.push(root);
    const result = await runGovernedCommand({
      commandId: "node.version",
      workspaceRoot: root,
      projectId: "00000000-0000-4000-8000-000000000001",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/^v\d+/);
      expect(result.cwd).toBe(root);
      expect(result.argv[0]).toBe(process.execPath);
    }
  });

  it("marks vitest UNAVAILABLE when the workspace has no local binary — never PASS", async () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-gov-vitest-missing-"));
    dirs.push(root);
    const result = await runGovernedCommand({
      commandId: "vitest.run",
      workspaceRoot: root,
      projectId: "00000000-0000-4000-8000-000000000001",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.denial).toBe("UNAVAILABLE");
    }
  });

  it("spawns workspace-local vitest.mjs and captures exit/output", async () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-gov-vitest-"));
    dirs.push(root);
    mkdirSync(join(root, "node_modules", "vitest"), { recursive: true });
    writeFileSync(
      join(root, "node_modules", "vitest", "vitest.mjs"),
      "console.log('VITEST_FIXTURE_OK'); process.exit(0);\n",
      "utf8",
    );
    const result = await runGovernedCommand({
      commandId: "vitest.run",
      workspaceRoot: root,
      projectId: "00000000-0000-4000-8000-000000000001",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("VITEST_FIXTURE_OK");
    }
  });

  it("marks git.status UNAVAILABLE when .git is missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-gov-git-"));
    dirs.push(root);
    const result = await runGovernedCommand({
      commandId: "git.status",
      workspaceRoot: root,
      projectId: "00000000-0000-4000-8000-000000000001",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.denial).toBe("UNAVAILABLE");
    }
  });

  it("marks git.diff UNAVAILABLE when .git is missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-gov-diff-"));
    dirs.push(root);
    const result = await runGovernedCommand({
      commandId: "git.diff",
      workspaceRoot: root,
      projectId: "00000000-0000-4000-8000-000000000001",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.denial).toBe("UNAVAILABLE");
    }
  });

  it("marks workspace.build UNAVAILABLE without a package.json build script", async () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-gov-build-"));
    dirs.push(root);
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "x" }), "utf8");
    const result = await runGovernedCommand({
      commandId: "workspace.build",
      workspaceRoot: root,
      projectId: "00000000-0000-4000-8000-000000000001",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.denial).toBe("UNAVAILABLE");
    }
  });

  it("requires a workspace-relative path for git.blame", async () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-gov-blame-"));
    dirs.push(root);
    mkdirSync(join(root, ".git"));
    const result = await runGovernedCommand({
      commandId: "git.blame",
      workspaceRoot: root,
      projectId: "00000000-0000-4000-8000-000000000001",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.denial).toBe("UNAVAILABLE");
    }
  });

  it("kill of an unknown execution id is fail-closed not_running", () => {
    expect(killGovernedExecution("00000000-0000-4000-8000-000000000099")).toBe(
      "not_running",
    );
  });

  it("kills an in-flight workspace-local command", async () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-gov-kill-"));
    dirs.push(root);
    mkdirSync(join(root, "node_modules", "vitest"), { recursive: true });
    writeFileSync(
      join(root, "node_modules", "vitest", "vitest.mjs"),
      [
        "const keepAlive = setInterval(() => {}, 60_000);",
        "process.on('SIGTERM', () => {",
        "  clearInterval(keepAlive);",
        "  process.exit(0);",
        "});",
        "",
      ].join("\n"),
      "utf8",
    );
    const executionId = "00000000-0000-4000-8000-000000000042";
    const events: GovernedCommandTestEvent[] = [];
    setGovernedCommandTestLifecycleObserver((event) => {
      events.push(event);
    });
    try {
      const pending = runGovernedCommand({
        commandId: "vitest.run",
        workspaceRoot: root,
        projectId: "00000000-0000-4000-8000-000000000001",
        executionId,
      });
      let outcome: "killed" | "not_running" = "not_running";
      for (let i = 0; i < 40; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        outcome = killGovernedExecution(executionId);
        if (outcome === "killed") break;
      }
      if (outcome !== "killed") {
        const stillRegistered = isGovernedExecutionRunning(executionId);
        const summary = await settledCommandSummary(pending);
        const trace = events.map((event) => JSON.stringify(event)).join(" | ");
        expect(
          outcome,
          `${classifyKillMiss(events, stillRegistered)}; stillRegistered=${String(stillRegistered)}; ${summary}; events=${trace}`,
        ).toBe("killed");
      }
      expect(outcome).toBe("killed");
      const result = await pending;
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.killed).toBe(true);
      }
    } finally {
      setGovernedCommandTestLifecycleObserver(null);
    }
  }, 15_000);
});

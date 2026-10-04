import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  attachOutputDrain,
  DEBUG_OUTPUT_CAP_BYTES,
  getDebugTarget,
  listDebugTargets,
  spawnDebugTarget,
} from "./studio-debug-spawn.js";

const dirs: string[] = [];
const children: { kill: () => void }[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    try {
      child.kill();
    } catch {
      /* already dead */
    }
  }
  await new Promise((r) => setTimeout(r, 300));
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  }
});

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "atlas-debug-spawn-"));
  dirs.push(dir);
  writeFileSync(join(dir, "script.js"), "setInterval(() => {}, 1000);\n");
  return dir;
}

describe("Debugger target catalog", () => {
  it("is independent — debug.node-script exists and is resolvable", () => {
    expect(listDebugTargets().length).toBeGreaterThan(0);
    expect(getDebugTarget("debug.node-script")).not.toBeNull();
  });

  it("returns null for an unknown target id", () => {
    expect(getDebugTarget("not-a-real-target")).toBeNull();
  });
});

describe("spawnDebugTarget", () => {
  it("denies an unknown target", () => {
    const result = spawnDebugTarget({ targetId: "nope", workspaceRoot: workspace(), relativePath: "script.js" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.denial).toBe("UNKNOWN_TARGET");
  });

  it("denies a missing workspaceRoot", () => {
    const result = spawnDebugTarget({
      targetId: "debug.node-script",
      workspaceRoot: join(tmpdir(), "atlas-debug-does-not-exist"),
      relativePath: "script.js",
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.denial).toBe("WORKSPACE_MISSING");
  });

  it("requires a relativePath for this target", () => {
    const result = spawnDebugTarget({ targetId: "debug.node-script", workspaceRoot: workspace() });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.denial).toBe("PATH_REQUIRED");
  });

  it("denies a relativePath that escapes the workspace", () => {
    const root = workspace();
    const result = spawnDebugTarget({ targetId: "debug.node-script", workspaceRoot: root, relativePath: "../outside.js" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.denial).toBe("WORKSPACE_ESCAPE");
  });

  it("denies a script that does not exist inside the workspace", () => {
    const root = workspace();
    const result = spawnDebugTarget({ targetId: "debug.node-script", workspaceRoot: root, relativePath: "missing.js" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.denial).toBe("SCRIPT_NOT_FOUND");
  });

  it("spawns a real, paused Node process for a valid target", () => {
    const root = workspace();
    const result = spawnDebugTarget({ targetId: "debug.node-script", workspaceRoot: root, relativePath: "script.js" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      children.push(result.child);
      expect(result.pid).toBeGreaterThan(0);
    }
  });

  it("exposes the real inspector banner from the drained stderr (127.0.0.1 only)", async () => {
    const root = workspace();
    const result = spawnDebugTarget({ targetId: "debug.node-script", workspaceRoot: root, relativePath: "script.js" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    children.push(result.child);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !/ws:\/\/127\.0\.0\.1:\d+\/[\w-]+/.test(result.output.stderr.text())) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(result.output.stderr.text()).toMatch(/Debugger listening on ws:\/\/127\.0\.0\.1:\d+\/[0-9a-f-]{36}/);
  });
});

describe("attachOutputDrain (an unread pipe blocks the child — reproduced on Windows)", () => {
  const FLOOD = `
    const fs = require("node:fs");
    const chunk = Buffer.alloc(64 * 1024, 120);
    const [mode, marker] = process.argv.slice(1);
    for (let i = 0; i < 160; i++) {
      if (mode === "sync") { fs.writeSync(1, chunk); fs.writeSync(2, chunk); }
      else { process.stdout.write(chunk); process.stderr.write(chunk); }
    }
    process.stdout.write("TAIL_MARKER_OUT\\n");
    fs.writeFileSync(marker, "REACHED_END");
  `;

  async function runFlood(mode: "sync" | "async") {
    const root = workspace();
    const marker = join(root, `reached-${mode}.txt`);
    const child = spawn(process.execPath, ["-e", FLOOD, mode, marker], { shell: false, windowsHide: true });
    children.push(child);
    const output = attachOutputDrain(child);
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && !existsSync(marker)) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return { reached: existsSync(marker), output };
  }

  it.each(["sync", "async"] as const)("a %s-writing child that floods ~20 MB reaches the end", async (mode) => {
    const { reached } = await runFlood(mode);
    expect(reached).toBe(true);
  }, 25_000);

  it("keeps only a bounded tail while counting every byte", async () => {
    const { output } = await runFlood("async");
    await new Promise((r) => setTimeout(r, 300));
    expect(output.stdout.totalBytes()).toBeGreaterThan(DEBUG_OUTPUT_CAP_BYTES * 10);
    expect(output.stdout.text().length).toBeLessThanOrEqual(DEBUG_OUTPUT_CAP_BYTES);
    expect(output.stdout.truncated()).toBe(true);
    expect(output.stdout.text()).toContain("TAIL_MARKER_OUT");
    expect(output.stderr.text().length).toBeLessThanOrEqual(DEBUG_OUTPUT_CAP_BYTES);
  }, 25_000);

  it("a spawn failure is captured instead of becoming an unhandled 'error' event", async () => {
    const child = spawn(join(tmpdir(), "atlas-no-such-binary-xyz.exe"), [], { shell: false, windowsHide: true });
    const output = attachOutputDrain(child);
    await new Promise((r) => setTimeout(r, 500));
    expect(output.stderr.text()).toMatch(/\[spawn error\]/);
  });
});

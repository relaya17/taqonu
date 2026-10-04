/**
 * Debugger target spawn — Studio Evolution design (2026-10-04 Design Plan,
 * approved for implementation).
 *
 * ISOLATION BOUNDARY (approved, locked): this module is fully independent
 * from the existing single-shot allowlisted-command execution service. It
 * copies only the safety PATTERNS (shell:false, env allowlist, path
 * containment, controlled argv) into its own, Debugger-only catalog. See
 * studio-debug-isolation.test.ts for the source assertion that this
 * boundary holds.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

export interface DebugTargetSpec {
  readonly id: string;
  readonly program: "node";
  readonly args: readonly string[];
  readonly timeoutMs: number;
  readonly description: string;
  readonly pathArg: "required";
}

/**
 * Debugger-only catalog. MVP: a single Node.js script target, launched
 * paused at entry (`--inspect-brk`) so it is a real, inspectable target —
 * not a mock process. Debugger targets are created ONLY through this
 * catalog; there is no other way to reach `spawnDebugTarget`.
 */
export const DEBUG_TARGETS: readonly DebugTargetSpec[] = [
  {
    id: "debug.node-script",
    program: "node",
    args: ["--inspect-brk=127.0.0.1:0"],
    timeoutMs: 4 * 60 * 60 * 1000,
    description:
      "Launch a workspace-relative Node.js script, paused at entry for debugging (V8 Inspector Protocol).",
    pathArg: "required",
  },
] as const;

const DEBUG_TARGET_BY_ID = new Map(DEBUG_TARGETS.map((t) => [t.id, t]));

export function getDebugTarget(id: string): DebugTargetSpec | null {
  return DEBUG_TARGET_BY_ID.get(id) ?? null;
}

export function listDebugTargets(): readonly DebugTargetSpec[] {
  return DEBUG_TARGETS;
}

/** Independent allowlist — intentionally duplicated from the pattern used
 * elsewhere in Studio, not imported, so this module has zero dependency on
 * governed-command.ts. */
const ENV_ALLOW = [
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "TEMP",
  "TMP",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "USERNAME",
  "LANG",
  "LC_ALL",
  "COMSPEC",
] as const;

function spawnEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ENV_ALLOW) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return env;
}

function assertInsideWorkspace(workspaceRoot: string, candidate: string): boolean {
  const root = resolve(workspaceRoot);
  const full = resolve(candidate);
  const rootReal = existsSync(root) ? realpathSync(root) : root;
  let candidateReal = full;
  try {
    candidateReal = existsSync(full) ? realpathSync(full) : full;
  } catch {
    return false;
  }
  const prefix =
    rootReal.endsWith("\\") || rootReal.endsWith("/")
      ? rootReal
      : rootReal + (process.platform === "win32" ? "\\" : "/");
  return candidateReal === rootReal || candidateReal.startsWith(prefix);
}

export type DebugSpawnDenial =
  | "UNKNOWN_TARGET"
  | "WORKSPACE_MISSING"
  | "PATH_REQUIRED"
  | "WORKSPACE_ESCAPE"
  | "SCRIPT_NOT_FOUND";

/** Per-stream tail kept in memory. Output is runtime data: never audited, never sent to a client by this module. */
export const DEBUG_OUTPUT_CAP_BYTES = 64 * 1024;

export interface BoundedOutput {
  /** Last `DEBUG_OUTPUT_CAP_BYTES` bytes, utf8-decoded. */
  text(): string;
  /** Every byte ever received, including those dropped from the tail. */
  totalBytes(): number;
  truncated(): boolean;
}

export interface DebugTargetOutput {
  readonly stdout: BoundedOutput;
  readonly stderr: BoundedOutput;
}

function createBoundedOutput(maxBytes: number): BoundedOutput & { push(chunk: Buffer): void } {
  let tail: Buffer = Buffer.alloc(0);
  let total = 0;
  return {
    push(chunk) {
      total += chunk.length;
      tail = Buffer.concat([tail, chunk]);
      if (tail.length > maxBytes) tail = tail.subarray(tail.length - maxBytes);
    },
    text: () => tail.toString("utf8"),
    totalBytes: () => total,
    truncated: () => total > tail.length,
  };
}

/**
 * A piped child that nobody reads blocks once the OS pipe fills (reproduced
 * on Windows: a child writing ~20 MB never finished while unread, finished
 * when drained). Attaching `data` listeners keeps both streams flowing; only
 * a bounded tail is retained. The `error` listener keeps an async spawn
 * failure from becoming an unhandled 'error' event on the API process.
 */
export function attachOutputDrain(
  child: ChildProcess,
  maxBytes: number = DEBUG_OUTPUT_CAP_BYTES,
): DebugTargetOutput {
  const stdout = createBoundedOutput(maxBytes);
  const stderr = createBoundedOutput(maxBytes);
  child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
  child.on("error", (error: Error) => stderr.push(Buffer.from(`[spawn error] ${error.message}\n`, "utf8")));
  return { stdout, stderr };
}

export type DebugSpawnResult =
  | {
      readonly ok: true;
      readonly child: ChildProcess;
      readonly pid: number;
      readonly scriptPath: string;
      readonly output: DebugTargetOutput;
    }
  | { readonly ok: false; readonly denial: DebugSpawnDenial; readonly reason: string };

export function spawnDebugTarget(input: {
  readonly targetId: string;
  readonly workspaceRoot: string;
  readonly relativePath?: string;
}): DebugSpawnResult {
  const spec = getDebugTarget(input.targetId);
  if (!spec) {
    return { ok: false, denial: "UNKNOWN_TARGET", reason: `Debug target "${input.targetId}" is not on the Debugger's allowlist.` };
  }
  const root = resolve(input.workspaceRoot);
  if (!existsSync(root)) {
    return { ok: false, denial: "WORKSPACE_MISSING", reason: "Linked workspaceRoot was not found on the API host." };
  }
  if (!input.relativePath) {
    return { ok: false, denial: "PATH_REQUIRED", reason: "A workspace-relative script path is required for this target." };
  }
  const scriptPath = resolve(root, input.relativePath);
  if (!assertInsideWorkspace(root, scriptPath)) {
    return { ok: false, denial: "WORKSPACE_ESCAPE", reason: "relativePath resolves outside the linked workspace." };
  }
  if (!existsSync(scriptPath)) {
    return { ok: false, denial: "SCRIPT_NOT_FOUND", reason: `Script not found: ${input.relativePath}` };
  }
  const child = spawn(process.execPath, [...spec.args, scriptPath], {
    cwd: root,
    shell: false,
    windowsHide: true,
    env: spawnEnv(),
  });
  const output = attachOutputDrain(child);
  return { ok: true, child, pid: child.pid ?? -1, scriptPath, output };
}

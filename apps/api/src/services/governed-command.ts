import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { resolveUnderWorkspace } from "@atlas/code-intelligence";

/**
 * Governed Studio command catalog. Callers send a commandId — never argv.
 * Spawn uses shell:false. Unknown ids and extra args are denied.
 */
export type GovernedCommandKind = "terminal" | "test" | "build";

export interface GovernedCommandSpec {
  readonly id: string;
  readonly kind: GovernedCommandKind;
  readonly program: "node" | "git";
  readonly args: readonly string[];
  readonly timeoutMs: number;
  readonly description: string;
  readonly mutatesWorkspace: boolean;
  readonly pathArg?: "required" | "optional";
}

export const GOVERNED_COMMANDS: readonly GovernedCommandSpec[] = [
  {
    id: "node.version",
    kind: "terminal",
    program: "node",
    args: ["--version"],
    timeoutMs: 8_000,
    description: "Print Node.js version. No workspace mutation.",
    mutatesWorkspace: false,
  },
  {
    id: "git.status",
    kind: "terminal",
    program: "git",
    args: ["status", "--porcelain=v1"],
    timeoutMs: 15_000,
    description: "Read-only git status in the linked project workspace.",
    mutatesWorkspace: false,
  },
  {
    id: "git.branch",
    kind: "terminal",
    program: "git",
    args: ["rev-parse", "--abbrev-ref", "HEAD"],
    timeoutMs: 8_000,
    description: "Read-only current branch name. Never checks out or commits.",
    mutatesWorkspace: false,
  },
  {
    id: "git.diff",
    kind: "terminal",
    program: "git",
    args: ["diff", "HEAD", "--no-color", "--no-ext-diff", "--find-renames"],
    timeoutMs: 20_000,
    description: "Read-only diff vs HEAD (staged and unstaged). Never mutates.",
    mutatesWorkspace: false,
  },
  {
    id: "git.log",
    kind: "terminal",
    program: "git",
    args: ["log", "-n", "30", "--oneline", "--decorate", "--no-color"],
    timeoutMs: 15_000,
    description: "Read-only recent history. Never checks out, commits, or pushes.",
    mutatesWorkspace: false,
  },
  {
    id: "git.blame",
    kind: "terminal",
    program: "git",
    args: ["blame", "--line-porcelain", "--"],
    timeoutMs: 20_000,
    description: "Read-only blame for one workspace-relative file. Never mutates.",
    mutatesWorkspace: false,
    pathArg: "required",
  },
  {
    id: "git.add",
    kind: "terminal",
    program: "git",
    args: ["add", "--"],
    timeoutMs: 15_000,
    description: "Stage one workspace-relative file. RECORD.EXECUTE + SoD. Never commits.",
    mutatesWorkspace: true,
    pathArg: "required",
  },
  {
    id: "git.unstage",
    kind: "terminal",
    program: "git",
    args: ["restore", "--staged", "--"],
    timeoutMs: 15_000,
    description: "Unstage one workspace-relative file. RECORD.EXECUTE + SoD. Never commits.",
    mutatesWorkspace: true,
    pathArg: "required",
  },
  {
    id: "git.restore",
    kind: "terminal",
    program: "git",
    args: ["restore", "--"],
    timeoutMs: 15_000,
    description: "Restore one workspace-relative file from HEAD. RECORD.EXECUTE + SoD.",
    mutatesWorkspace: true,
    pathArg: "required",
  },
  {
    id: "workspace.build",
    kind: "build",
    program: "node",
    args: ["run", "build"],
    timeoutMs: 120_000,
    description: "Run the workspace package.json build script via npm/pnpm. No arbitrary shell.",
    mutatesWorkspace: false,
  },
  {
    id: "vitest.run",
    kind: "test",
    program: "node",
    args: ["run"],
    timeoutMs: 120_000,
    description:
      "Run the workspace-local Vitest binary if it exists under node_modules. UNAVAILABLE otherwise — never PASS. Optional relativePath runs one file.",
    mutatesWorkspace: false,
    pathArg: "optional",
  },
] as const;

const COMMAND_BY_ID = new Map(GOVERNED_COMMANDS.map((c) => [c.id, c]));

const UNSAFE_TOKEN = /[;&|`$<>]/;

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

export type GovernedCommandDenial =
  | "UNKNOWN_COMMAND"
  | "WORKSPACE_MISSING"
  | "WORKSPACE_ESCAPE"
  | "PROGRAM_UNAVAILABLE"
  | "UNAVAILABLE";

export type GovernedCommandSuccess = {
  readonly ok: true;
  readonly executionId: string;
  readonly commandId: string;
  readonly kind: GovernedCommandKind;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly exitCode: number;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly truncated: boolean;
  readonly timedOut: boolean;
  readonly killed: boolean;
};

export type GovernedCommandFailure = {
  readonly ok: false;
  readonly executionId: string;
  readonly commandId: string;
  readonly kind: GovernedCommandKind | null;
  readonly denial: GovernedCommandDenial;
  readonly reason: string;
};

export type GovernedCommandResult = GovernedCommandSuccess | GovernedCommandFailure;

const MAX_OUTPUT_BYTES = 64_000;
const KILL_ESCALATE_MS = 1_500;

type RunningExecution = {
  readonly executionId: string;
  readonly projectId: string;
  readonly commandId: string;
  readonly child: ChildProcess;
  killRequested: boolean;
};

const running = new Map<string, RunningExecution>();

/** Test-only lifecycle notes. Unset in production paths; never changes kill or map behavior. */
export type GovernedCommandTestEvent =
  | { readonly kind: "registered"; readonly executionId: string; readonly commandId: string }
  | { readonly kind: "error"; readonly executionId: string; readonly message: string }
  | {
      readonly kind: "close";
      readonly executionId: string;
      readonly code: number | null;
      readonly signal: NodeJS.Signals | null;
      readonly killRequested: boolean;
    }
  | { readonly kind: "deleted"; readonly executionId: string }
  | { readonly kind: "reset"; readonly executionIds: readonly string[] };

let testLifecycleObserver: ((event: GovernedCommandTestEvent) => void) | null = null;

export function setGovernedCommandTestLifecycleObserver(
  observer: ((event: GovernedCommandTestEvent) => void) | null,
): void {
  testLifecycleObserver = observer;
}

function emitGovernedCommandTestEvent(event: GovernedCommandTestEvent): void {
  testLifecycleObserver?.(event);
}

export function resetGovernedCommandRuntimeForTests(): void {
  emitGovernedCommandTestEvent({
    kind: "reset",
    executionIds: [...running.keys()],
  });
  for (const entry of running.values()) {
    try {
      entry.child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
  running.clear();
}

export function getGovernedCommand(id: string): GovernedCommandSpec | null {
  return COMMAND_BY_ID.get(id) ?? null;
}

export function listGovernedCommands(): readonly GovernedCommandSpec[] {
  return GOVERNED_COMMANDS;
}

function spawnEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ENV_ALLOW) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return env;
}

function resolveNodeProgram(): string {
  return process.execPath;
}

function resolveGitProgram(): string | null {
  const pathEnv = process.env.PATH ?? "";
  const names =
    process.platform === "win32" ? ["git.exe", "git.cmd", "git"] : ["git"];
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function resolveVitestEntry(workspaceRoot: string): string | null {
  const candidates = [
    join(workspaceRoot, "node_modules", "vitest", "vitest.mjs"),
    join(workspaceRoot, "node_modules", "vitest", "dist", "cli.js"),
    join(workspaceRoot, "node_modules", "vitest", "vitest.js"),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
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

function resolveNpmProgram(): string | null {
  const pathEnv = process.env.PATH ?? "";
  const names =
    process.platform === "win32"
      ? ["npm.cmd", "npm.exe", "pnpm.cmd", "pnpm.exe", "npm", "pnpm"]
      : ["pnpm", "npm"];
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function resolvePathArg(
  workspaceRoot: string,
  relativePath: string | undefined,
  spec: GovernedCommandSpec,
): { path: string } | { denial: GovernedCommandDenial; reason: string } | { path: null } {
  if (!spec.pathArg) return { path: null };
  if (!relativePath?.trim()) {
    if (spec.pathArg === "optional") return { path: null };
    return { denial: "UNAVAILABLE", reason: "This command requires a workspace-relative path." };
  }
  const rel = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!rel || rel.includes("\0") || rel.split("/").includes("..")) {
    return { denial: "WORKSPACE_ESCAPE", reason: "Path argument escaped the project workspace." };
  }
  try {
    resolveUnderWorkspace(workspaceRoot, rel);
  } catch {
    return { denial: "WORKSPACE_ESCAPE", reason: "Path argument escaped the project workspace." };
  }
  if (UNSAFE_TOKEN.test(rel)) {
    return { denial: "UNKNOWN_COMMAND", reason: "Path argument failed safety scan." };
  }
  return { path: rel };
}

function resolveGitArgv(
  spec: GovernedCommandSpec,
  workspaceRoot: string,
  relativePath: string | null,
): { program: string; args: string[] } | { denial: GovernedCommandDenial; reason: string } {
  const gitDir = join(workspaceRoot, ".git");
  if (!existsSync(gitDir)) {
    return {
      denial: "UNAVAILABLE",
      reason: "Linked workspace is not a git repository (.git missing).",
    };
  }
  const git = resolveGitProgram();
  if (!git) {
    return {
      denial: "PROGRAM_UNAVAILABLE",
      reason: "git is not available on the API host PATH.",
    };
  }
  const args = [...spec.args];
  if (spec.pathArg) {
    if (!relativePath) {
      return { denial: "UNAVAILABLE", reason: "This git command requires a workspace-relative path." };
    }
    args.push(relativePath);
  }
  return { program: git, args };
}

function resolveBuildArgv(
  workspaceRoot: string,
): { program: string; args: string[] } | { denial: GovernedCommandDenial; reason: string } {
  const pkgPath = join(workspaceRoot, "package.json");
  if (!existsSync(pkgPath)) {
    return { denial: "UNAVAILABLE", reason: "Linked workspace has no package.json." };
  }
  let scripts: { build?: unknown } = {};
  try {
    const parsed = JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: { build?: unknown } };
    scripts = parsed.scripts ?? {};
  } catch {
    return { denial: "UNAVAILABLE", reason: "package.json is not readable JSON." };
  }
  if (typeof scripts.build !== "string" || !scripts.build.trim()) {
    return {
      denial: "UNAVAILABLE",
      reason: "package.json has no build script. Status is UNAVAILABLE, not PASS.",
    };
  }
  const npm = resolveNpmProgram();
  if (!npm) {
    return {
      denial: "PROGRAM_UNAVAILABLE",
      reason: "npm/pnpm is not available on the API host PATH.",
    };
  }
  return { program: npm, args: ["run", "build"] };
}

function buildArgv(
  spec: GovernedCommandSpec,
  workspaceRoot: string,
  relativePath: string | null,
): { program: string; args: string[] } | { denial: GovernedCommandDenial; reason: string } {
  if (spec.args.some((a) => UNSAFE_TOKEN.test(a))) {
    return { denial: "UNKNOWN_COMMAND", reason: "Catalog args failed safety scan." };
  }
  if (spec.program === "node" && spec.id === "node.version") {
    return { program: resolveNodeProgram(), args: ["--version"] };
  }
  if (spec.program === "git") {
    return resolveGitArgv(spec, workspaceRoot, relativePath);
  }
  if (spec.id === "workspace.build") {
    return resolveBuildArgv(workspaceRoot);
  }
  if (spec.id === "vitest.run") {
    const entry = resolveVitestEntry(workspaceRoot);
    if (!entry) {
      return {
        denial: "UNAVAILABLE",
        reason:
          "No workspace-local Vitest binary under node_modules. Status is UNAVAILABLE, not PASS.",
      };
    }
    if (!assertInsideWorkspace(workspaceRoot, entry)) {
      return {
        denial: "WORKSPACE_ESCAPE",
        reason: "Vitest binary escaped the project workspace.",
      };
    }
    const args = [entry, "run"];
    if (relativePath) args.push(relativePath);
    return { program: resolveNodeProgram(), args };
  }
  return { denial: "UNKNOWN_COMMAND", reason: `Command "${spec.id}" is not executable.` };
}

export function killGovernedExecution(executionId: string): "killed" | "not_running" {
  const entry = running.get(executionId);
  if (!entry) return "not_running";
  entry.killRequested = true;
  try {
    entry.child.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  setTimeout(() => {
    try {
      entry.child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }, KILL_ESCALATE_MS);
  return "killed";
}

export function isGovernedExecutionRunning(executionId: string): boolean {
  return running.has(executionId);
}

export async function runGovernedCommand(input: {
  readonly commandId: string;
  readonly workspaceRoot: string;
  readonly projectId: string;
  readonly executionId?: string;
  readonly relativePath?: string;
}): Promise<GovernedCommandResult> {
  const executionId = input.executionId ?? randomUUID();
  const spec = getGovernedCommand(input.commandId);
  if (!spec) {
    return {
      ok: false,
      executionId,
      commandId: input.commandId,
      kind: null,
      denial: "UNKNOWN_COMMAND",
      reason: `Command "${input.commandId}" is not on the Studio allowlist.`,
    };
  }
  const root = resolve(input.workspaceRoot);
  if (!existsSync(root)) {
    return {
      ok: false,
      executionId,
      commandId: spec.id,
      kind: spec.kind,
      denial: "WORKSPACE_MISSING",
      reason: "Linked workspaceRoot was not found on the API host.",
    };
  }
  const pathArg = resolvePathArg(root, input.relativePath, spec);
  if ("denial" in pathArg) {
    return {
      ok: false,
      executionId,
      commandId: spec.id,
      kind: spec.kind,
      denial: pathArg.denial,
      reason: pathArg.reason,
    };
  }
  const argv = buildArgv(spec, root, pathArg.path);
  if ("denial" in argv) {
    return {
      ok: false,
      executionId,
      commandId: spec.id,
      kind: spec.kind,
      denial: argv.denial,
      reason: argv.reason,
    };
  }

  return await new Promise((resolvePromise) => {
    let settled = false;
    let timedOut = false;
    let killed = false;
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let escalate: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();

    const finish = (result: GovernedCommandResult) => {
      if (settled) return;
      settled = true;
      running.delete(executionId);
      emitGovernedCommandTestEvent({ kind: "deleted", executionId });
      if (timer) clearTimeout(timer);
      if (escalate) clearTimeout(escalate);
      resolvePromise(result);
    };

    const child = spawn(argv.program, argv.args, {
      cwd: root,
      shell: false,
      windowsHide: true,
      env: spawnEnv(),
    });
    running.set(executionId, {
      executionId,
      projectId: input.projectId,
      commandId: spec.id,
      child,
      killRequested: false,
    });
    emitGovernedCommandTestEvent({
      kind: "registered",
      executionId,
      commandId: spec.id,
    });

    timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      escalate = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }, KILL_ESCALATE_MS);
    }, spec.timeoutMs);

    const take = (chunk: Buffer, current: string): string => {
      const next = current + chunk.toString("utf8");
      if (next.length <= MAX_OUTPUT_BYTES) return next;
      truncated = true;
      return next.slice(0, MAX_OUTPUT_BYTES);
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = take(chunk, stdout);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = take(chunk, stderr);
    });
    child.on("error", (error) => {
      const message = error instanceof Error ? error.message : "Failed to spawn command";
      emitGovernedCommandTestEvent({ kind: "error", executionId, message });
      finish({
        ok: false,
        executionId,
        commandId: spec.id,
        kind: spec.kind,
        denial: "PROGRAM_UNAVAILABLE",
        reason: message,
      });
    });
    child.on("close", (code, signal) => {
      const entry = running.get(executionId);
      emitGovernedCommandTestEvent({
        kind: "close",
        executionId,
        code,
        signal,
        killRequested: entry?.killRequested === true,
      });
      if (
        entry?.killRequested ||
        signal === "SIGTERM" ||
        signal === "SIGKILL"
      ) {
        killed = true;
      }
      const durationMs = Date.now() - started;
      finish({
        ok: true,
        executionId,
        commandId: spec.id,
        kind: spec.kind,
        argv: [argv.program, ...argv.args],
        cwd: root,
        exitCode: code ?? 1,
        signal: signal ?? null,
        stdout,
        stderr,
        durationMs,
        truncated,
        timedOut,
        killed,
      });
    });
  });
}

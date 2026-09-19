import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Governed Studio command catalog. Callers send a commandId — never argv.
 * Spawn uses shell:false. Unknown ids and extra args are denied.
 */
export type GovernedCommandKind = "terminal" | "test";

export interface GovernedCommandSpec {
  readonly id: string;
  readonly kind: GovernedCommandKind;
  readonly program: "node" | "git";
  readonly args: readonly string[];
  readonly timeoutMs: number;
  readonly description: string;
  readonly mutatesWorkspace: false;
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
    id: "vitest.run",
    kind: "test",
    program: "node",
    args: ["run"],
    timeoutMs: 120_000,
    description:
      "Run the workspace-local Vitest binary if it exists under node_modules. UNAVAILABLE otherwise — never PASS.",
    mutatesWorkspace: false,
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

export function resetGovernedCommandRuntimeForTests(): void {
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

function buildArgv(
  spec: GovernedCommandSpec,
  workspaceRoot: string,
): { program: string; args: string[] } | { denial: GovernedCommandDenial; reason: string } {
  if (spec.args.some((a) => UNSAFE_TOKEN.test(a))) {
    return { denial: "UNKNOWN_COMMAND", reason: "Catalog args failed safety scan." };
  }
  if (spec.program === "node" && spec.id === "node.version") {
    return { program: resolveNodeProgram(), args: ["--version"] };
  }
  if (spec.program === "git" && spec.id === "git.status") {
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
    return { program: git, args: ["status", "--porcelain=v1"] };
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
    return { program: resolveNodeProgram(), args: [entry, "run"] };
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
  const argv = buildArgv(spec, root);
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
      finish({
        ok: false,
        executionId,
        commandId: spec.id,
        kind: spec.kind,
        denial: "PROGRAM_UNAVAILABLE",
        reason: error instanceof Error ? error.message : "Failed to spawn command",
      });
    });
    child.on("close", (code, signal) => {
      const entry = running.get(executionId);
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

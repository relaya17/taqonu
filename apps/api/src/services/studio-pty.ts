/**
 * Human-only Studio PTY sessions.
 *
 * USER TERMINAL ≠ AGENT EXECUTION.
 * This module is never imported by ask-agent / CODE_ENGINEER / governed
 * commandId execution. Callers send no argv. The Agent cannot inherit a
 * session ticket. Transcripts are not persisted and are not sent to Atlas.
 *
 * Lifecycle (explicit, tested):
 * - SSE/WS disconnect, component unmount, page reload → unsubscribe only.
 *   The process stays running so a cookie-authenticated reconnect can attach
 *   without spawning a duplicate shell.
 * - Reconnect rotates the stream ticket. List never returns tickets.
 *   Ownership is user + project. Foreign user / other project is denied.
 * - Explicit Close, idle timeout, and lifetime timeout kill the process.
 * - start-cwd is the linked workspaceRoot, not a filesystem jail.
 */
import { spawn as nodePtySpawn, type IPty } from "node-pty";
import { existsSync, realpathSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { AtlasError } from "@atlas/shared";

export const STUDIO_PTY_SHELLS = ["powershell", "cmd"] as const;
export type StudioPtyShell = (typeof STUDIO_PTY_SHELLS)[number];

export const PTY_INTERRUPT = "\x03";
export const PTY_EOF = "\x04";

const MAX_SESSIONS_PER_PROJECT = 4;
const MAX_SESSIONS_GLOBAL = 16;
const MAX_INPUT_BYTES = 32_768;
const SCROLLBACK_BYTES = 64 * 1024;
const IDLE_MS = 30 * 60 * 1000;
const MAX_LIFETIME_MS = 4 * 60 * 60 * 1000;

/** Keep-vs-kill policy. SSE/reload must not silently destroy a reconnectable session. */
export const STUDIO_PTY_DISCONNECT_POLICY = {
  browserDisconnect: "keep-process",
  sseDisconnect: "unsubscribe-only",
  componentUnmount: "unsubscribe-only",
  pageReload: "keep-process",
  explicitClose: "kill-process",
  idleTimeout: "kill-process",
  lifetimeTimeout: "kill-process",
  persistTranscript: false,
} as const;

let idleMs = IDLE_MS;
let lifetimeMs = MAX_LIFETIME_MS;
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 32;

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
  "SystemRoot",
  "ComSpec",
  "PSModulePath",
] as const;

const SECRET_ENV = /secret|token|password|credential|apikey|api_key|private_key|access_key/i;

export type StudioPtyStatus = "running" | "exited" | "killed";

export interface StudioPtySnapshot {
  readonly sessionId: string;
  readonly projectId: string;
  readonly ownerId: string;
  readonly shell: StudioPtyShell;
  readonly cwd: string;
  readonly pid: number;
  readonly cols: number;
  readonly rows: number;
  readonly status: StudioPtyStatus;
  readonly exitCode: number | null;
  readonly signal: number | null;
  readonly createdAt: string;
  readonly lastActivityAt: string;
}

export interface StudioPtyProcess {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(listener: (data: string) => void): void;
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): void;
}

export type StudioPtySpawner = (input: {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly cols: number;
  readonly rows: number;
  readonly env: Record<string, string>;
}) => StudioPtyProcess;

export interface CreateStudioPtyInput {
  readonly projectId: string;
  readonly ownerId: string;
  readonly workspaceRoot: string;
  readonly shell?: StudioPtyShell;
  readonly cols?: number;
  readonly rows?: number;
}

interface InternalSession {
  readonly snapshot: {
    sessionId: string;
    projectId: string;
    ownerId: string;
    shell: StudioPtyShell;
    cwd: string;
    pid: number;
    cols: number;
    rows: number;
    status: StudioPtyStatus;
    exitCode: number | null;
    signal: number | null;
    createdAt: string;
    lastActivityAt: string;
  };
  ticket: string;
  readonly proc: StudioPtyProcess;
  scrollback: string;
  idleTimer: ReturnType<typeof setTimeout> | undefined;
  lifetimeTimer: ReturnType<typeof setTimeout> | undefined;
  dataListeners: Set<(data: string) => void>;
  exitListeners: Set<(event: { exitCode: number; signal?: number }) => void>;
}

const sessions = new Map<string, InternalSession>();
let spawner: StudioPtySpawner = spawnNodePty;

export function resetStudioPtyForTests(): void {
  for (const session of [...sessions.values()]) {
    destroySession(session, "killed");
  }
  sessions.clear();
  spawner = spawnNodePty;
  idleMs = IDLE_MS;
  lifetimeMs = MAX_LIFETIME_MS;
}

export function setStudioPtySpawnerForTests(next: StudioPtySpawner | null): void {
  spawner = next ?? spawnNodePty;
}

export function setStudioPtyTimeoutsForTests(next: {
  readonly idleMs?: number;
  readonly lifetimeMs?: number;
} | null): void {
  idleMs = next?.idleMs ?? IDLE_MS;
  lifetimeMs = next?.lifetimeMs ?? MAX_LIFETIME_MS;
}

export function isAgentPtyRequest(headers: Record<string, unknown>): boolean {
  const actor = String(headers["x-atlas-actor-kind"] ?? "").trim().toUpperCase();
  const agentId = String(headers["x-atlas-agent-id"] ?? "").trim();
  return actor === "AGENT" || agentId.length > 0;
}

export function denyAgentPty(): never {
  throw new AtlasError(
    "FORBIDDEN",
    "User Terminal is human-only. The Agent cannot open or inherit a PTY.",
    { statusCode: 403 },
  );
}

export function resolveStudioPtyWorkspace(workspaceRoot: string): string {
  const root = resolve(workspaceRoot);
  if (!existsSync(root)) {
    throw new AtlasError(
      "VALIDATION_ERROR",
      "Link a local workspaceRoot on the project before opening a terminal.",
      { statusCode: 400 },
    );
  }
  try {
    return realpathSync(root);
  } catch {
    return root;
  }
}

export function buildStudioPtyEnv(): Record<string, string> {
  const env: Record<string, string> = {
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
  };
  for (const key of ENV_ALLOW) {
    const value = process.env[key];
    if (value && !SECRET_ENV.test(key)) env[key] = value;
  }
  return env;
}

export function resolveStudioPtyShell(kind: StudioPtyShell): {
  file: string;
  args: string[];
} {
  if (process.platform === "win32") {
    if (kind === "cmd") {
      const file =
        process.env.ComSpec ||
        join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe");
      if (!existsSync(file)) {
        throw new AtlasError("CONFIG_ERROR", "cmd.exe was not found on this host.", {
          statusCode: 503,
        });
      }
      return { file, args: [] };
    }
    const file =
      whichOnPath(["pwsh.exe", "pwsh", "powershell.exe", "powershell"]) ??
      join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      );
    if (!existsSync(file)) {
      throw new AtlasError("CONFIG_ERROR", "PowerShell was not found on this host.", {
        statusCode: 503,
      });
    }
    return { file, args: ["-NoLogo"] };
  }
  if (kind === "cmd") {
    throw new AtlasError(
      "VALIDATION_ERROR",
      "cmd is Windows-only. Use powershell on this host.",
      { statusCode: 400 },
    );
  }
  const file = process.env.SHELL || "/bin/bash";
  if (!existsSync(file)) {
    throw new AtlasError("CONFIG_ERROR", "No interactive shell was found on this host.", {
      statusCode: 503,
    });
  }
  return { file, args: ["-l"] };
}

function whichOnPath(names: string[]): string | null {
  const pathEnv = process.env.PATH ?? "";
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean)
      : [""];
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const base = join(dir, name);
      if (existsSync(base)) return base;
      for (const ext of exts) {
        if (!ext) continue;
        if (name.toLowerCase().endsWith(ext.toLowerCase())) continue;
        const candidate = base + ext;
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

function clampSize(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function spawnNodePty(input: {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly cols: number;
  readonly rows: number;
  readonly env: Record<string, string>;
}): StudioPtyProcess {
  const proc: IPty = nodePtySpawn(input.file, [...input.args], {
    name: "xterm-256color",
    cols: input.cols,
    rows: input.rows,
    cwd: input.cwd,
    env: input.env,
    useConpty: process.platform === "win32",
    useConptyDll: process.platform === "win32",
  });
  return {
    get pid() {
      return proc.pid;
    },
    write(data: string) {
      proc.write(data);
    },
    resize(cols: number, rows: number) {
      proc.resize(cols, rows);
    },
    kill() {
      try {
        proc.kill();
      } catch {
        /* already dead */
      }
      killProcessTree(proc.pid);
    },
    onData(listener) {
      proc.onData(listener);
    },
    onExit(listener) {
      proc.onExit((event) => {
        listener({
          exitCode: event.exitCode,
          ...(typeof event.signal === "number" ? { signal: event.signal } : {}),
        });
      });
    },
  };
}

function killProcessTree(pid: number): void {
  if (!pid || pid <= 0) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    /* gone */
  }
}

function touch(session: InternalSession): void {
  session.snapshot.lastActivityAt = new Date().toISOString();
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => {
    destroySession(session, "killed");
  }, idleMs);
}

function appendScrollback(session: InternalSession, chunk: string): void {
  session.scrollback += chunk;
  if (session.scrollback.length > SCROLLBACK_BYTES) {
    session.scrollback = session.scrollback.slice(session.scrollback.length - SCROLLBACK_BYTES);
  }
}

function destroySession(session: InternalSession, status: StudioPtyStatus, exitCode?: number, signal?: number): void {
  if (session.idleTimer) clearTimeout(session.idleTimer);
  if (session.lifetimeTimer) clearTimeout(session.lifetimeTimer);
  session.idleTimer = undefined;
  session.lifetimeTimer = undefined;
  if (session.snapshot.status === "running") {
    session.snapshot.status = status;
    session.snapshot.exitCode = exitCode ?? session.snapshot.exitCode;
    session.snapshot.signal = signal ?? session.snapshot.signal;
    try {
      session.proc.kill();
    } catch {
      /* already dead */
    }
  }
  sessions.delete(session.snapshot.sessionId);
}

export function createStudioPtySession(input: CreateStudioPtyInput): {
  snapshot: StudioPtySnapshot;
  ticket: string;
} {
  const cwd = resolveStudioPtyWorkspace(input.workspaceRoot);
  const shell = input.shell ?? (process.platform === "win32" ? "powershell" : "powershell");
  if (!STUDIO_PTY_SHELLS.includes(shell)) {
    throw new AtlasError("VALIDATION_ERROR", `Unsupported shell "${String(shell)}".`, {
      statusCode: 400,
    });
  }
  const projectCount = [...sessions.values()].filter((row) => row.snapshot.projectId === input.projectId).length;
  if (projectCount >= MAX_SESSIONS_PER_PROJECT) {
    throw new AtlasError(
      "CONFLICT",
      `This project already has ${MAX_SESSIONS_PER_PROJECT} open terminals.`,
      { statusCode: 409 },
    );
  }
  if (sessions.size >= MAX_SESSIONS_GLOBAL) {
    throw new AtlasError("CONFLICT", "Studio terminal session limit reached.", {
      statusCode: 409,
    });
  }

  const cols = clampSize(input.cols, DEFAULT_COLS, 20, 400);
  const rows = clampSize(input.rows, DEFAULT_ROWS, 8, 120);
  const resolved = resolveStudioPtyShell(shell);
  const env = buildStudioPtyEnv();
  const proc = spawner({
    file: resolved.file,
    args: resolved.args,
    cwd,
    cols,
    rows,
    env,
  });
  const now = new Date().toISOString();
  const sessionId = randomUUID();
  const ticket = randomBytes(24).toString("base64url");
  const session: InternalSession = {
    snapshot: {
      sessionId,
      projectId: input.projectId,
      ownerId: input.ownerId,
      shell,
      cwd,
      pid: proc.pid,
      cols,
      rows,
      status: "running",
      exitCode: null,
      signal: null,
      createdAt: now,
      lastActivityAt: now,
    },
    ticket,
    proc,
    scrollback: "",
    idleTimer: undefined,
    lifetimeTimer: undefined,
    dataListeners: new Set(),
    exitListeners: new Set(),
  };
  proc.onData((data) => {
    appendScrollback(session, data);
    touch(session);
    for (const listener of session.dataListeners) listener(data);
  });
  proc.onExit((event) => {
    if (session.snapshot.status === "running") {
      session.snapshot.status = "exited";
      session.snapshot.exitCode = event.exitCode;
      session.snapshot.signal = event.signal ?? null;
    }
    for (const listener of [...session.exitListeners]) listener(event);
    destroySession(session, session.snapshot.status, event.exitCode, event.signal);
  });
  session.lifetimeTimer = setTimeout(() => {
    destroySession(session, "killed");
  }, lifetimeMs);
  touch(session);
  sessions.set(sessionId, session);
  return { snapshot: { ...session.snapshot }, ticket };
}

export function listStudioPtySessions(projectId: string, ownerId: string): StudioPtySnapshot[] {
  return [...sessions.values()]
    .filter((row) => row.snapshot.projectId === projectId && row.snapshot.ownerId === ownerId)
    .map((row) => ({ ...row.snapshot }));
}

export function getStudioPtySession(sessionId: string): InternalSession | undefined {
  return sessions.get(sessionId);
}

export function assertPtyTicket(session: InternalSession, ticket: string): void {
  if (!ticket || ticket !== session.ticket) {
    throw new AtlasError("FORBIDDEN", "Invalid terminal stream ticket.", { statusCode: 403 });
  }
}

export function reconnectStudioPty(input: {
  readonly sessionId: string;
  readonly ownerId: string;
  readonly projectId: string;
}): { snapshot: StudioPtySnapshot; ticket: string } {
  const session = requireOwnedRunning(input.sessionId, input.ownerId);
  if (session.snapshot.projectId !== input.projectId) {
    throw new AtlasError("FORBIDDEN", "Terminal session belongs to another project.", {
      statusCode: 403,
    });
  }
  session.ticket = randomBytes(24).toString("base64url");
  touch(session);
  return { snapshot: { ...session.snapshot }, ticket: session.ticket };
}

export function writeStudioPty(sessionId: string, ownerId: string, data: string): void {
  const session = requireOwnedRunning(sessionId, ownerId);
  if (Buffer.byteLength(data, "utf8") > MAX_INPUT_BYTES) {
    throw new AtlasError("VALIDATION_ERROR", "Terminal input exceeds the per-message limit.", {
      statusCode: 400,
    });
  }
  session.proc.write(data);
  touch(session);
}

export function interruptStudioPty(sessionId: string, ownerId: string): void {
  writeStudioPty(sessionId, ownerId, PTY_INTERRUPT);
}

export function eofStudioPty(sessionId: string, ownerId: string): void {
  writeStudioPty(sessionId, ownerId, PTY_EOF);
}

export function resizeStudioPty(
  sessionId: string,
  ownerId: string,
  cols: number,
  rows: number,
): StudioPtySnapshot {
  const session = requireOwnedRunning(sessionId, ownerId);
  const nextCols = clampSize(cols, session.snapshot.cols, 20, 400);
  const nextRows = clampSize(rows, session.snapshot.rows, 8, 120);
  session.proc.resize(nextCols, nextRows);
  session.snapshot.cols = nextCols;
  session.snapshot.rows = nextRows;
  touch(session);
  return { ...session.snapshot };
}

export function closeStudioPty(sessionId: string, ownerId: string): StudioPtySnapshot {
  const session = requireOwned(sessionId, ownerId);
  const snap = { ...session.snapshot, status: "killed" as const };
  destroySession(session, "killed");
  return snap;
}

export function subscribeStudioPtyByTicket(
  sessionId: string,
  ticket: string,
  handlers: {
    onData: (data: string) => void;
    onExit: (event: { exitCode: number; signal?: number }) => void;
  },
): {
  snapshot: StudioPtySnapshot;
  scrollback: string;
  ownerId: string;
  unsubscribe: () => void;
} {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new AtlasError("NOT_FOUND", "Terminal session is not running.", { statusCode: 404 });
  }
  assertPtyTicket(session, ticket);
  session.dataListeners.add(handlers.onData);
  session.exitListeners.add(handlers.onExit);
  touch(session);
  return {
    snapshot: { ...session.snapshot },
    scrollback: session.scrollback,
    ownerId: session.snapshot.ownerId,
    unsubscribe: () => {
      session.dataListeners.delete(handlers.onData);
      session.exitListeners.delete(handlers.onExit);
    },
  };
}

export function subscribeStudioPty(
  sessionId: string,
  ownerId: string,
  ticket: string,
  handlers: {
    onData: (data: string) => void;
    onExit: (event: { exitCode: number; signal?: number }) => void;
  },
): { snapshot: StudioPtySnapshot; scrollback: string; unsubscribe: () => void } {
  requireOwned(sessionId, ownerId);
  const sub = subscribeStudioPtyByTicket(sessionId, ticket, handlers);
  return { snapshot: sub.snapshot, scrollback: sub.scrollback, unsubscribe: sub.unsubscribe };
}

function requireOwned(sessionId: string, ownerId: string): InternalSession {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new AtlasError("NOT_FOUND", "Terminal session is not running.", { statusCode: 404 });
  }
  if (session.snapshot.ownerId !== ownerId) {
    throw new AtlasError("FORBIDDEN", "Terminal session belongs to another user.", {
      statusCode: 403,
    });
  }
  return session;
}

function requireOwnedRunning(sessionId: string, ownerId: string): InternalSession {
  const session = requireOwned(sessionId, ownerId);
  if (session.snapshot.status !== "running") {
    throw new AtlasError("CONFLICT", "Terminal session is no longer running.", { statusCode: 409 });
  }
  return session;
}

export function studioPtyLimits(): {
  readonly maxSessionsPerProject: number;
  readonly maxSessionsGlobal: number;
  readonly idleMs: number;
  readonly maxLifetimeMs: number;
  readonly maxInputBytes: number;
  readonly maxScrollbackBytes: number;
  readonly persistTranscript: false;
  readonly agentAccess: false;
} {
  return {
    maxSessionsPerProject: MAX_SESSIONS_PER_PROJECT,
    maxSessionsGlobal: MAX_SESSIONS_GLOBAL,
    idleMs: idleMs,
    maxLifetimeMs: lifetimeMs,
    maxInputBytes: MAX_INPUT_BYTES,
    maxScrollbackBytes: SCROLLBACK_BYTES,
    persistTranscript: false,
    agentAccess: false,
  };
}

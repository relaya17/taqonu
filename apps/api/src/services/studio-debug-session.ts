/**
 * Debug Session module — Studio Evolution design (2026-10-04 Design Plan,
 * approved for implementation).
 *
 * Owns: session lifecycle, registry, ticket, state, cleanup, and audit
 * events. Uses `studio-pty.ts`'s lifecycle as an INSPIRATION PATTERN only —
 * no import from it, and the PTY itself is never a Debugger target source
 * (locked decision).
 */
import { randomUUID, randomBytes } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { osStore } from "../store/os-store.js";
import { getProjectOwnerId } from "./project-access.js";
import { spawnDebugTarget, type DebugSpawnDenial } from "./studio-debug-spawn.js";

export type DebugSessionStatus =
  | "ACTIVE"
  | "SESSION_EXPIRED"
  | "AUTHORIZATION_REVOKED"
  | "TARGET_TERMINATED"
  | "CLOSED";

export type DebugSessionCloseCause =
  | "voluntary"
  | "force_closed"
  | "authorization_revoked"
  | "timeout"
  | "target_terminated"
  | "configuration_error";

export interface DebugSessionSnapshot {
  readonly sessionId: string;
  readonly projectId: string;
  readonly targetId: string;
  readonly openerId: string;
  readonly pid: number;
  readonly status: DebugSessionStatus;
  readonly createdAt: string;
  readonly lastActivityAt: string;
}

interface InternalDebugSession {
  readonly sessionId: string;
  readonly projectId: string;
  readonly targetId: string;
  readonly openerId: string;
  readonly child: ChildProcess;
  readonly pid: number;
  ticket: string;
  status: DebugSessionStatus;
  readonly createdAt: string;
  lastActivityAt: string;
  idleTimer?: ReturnType<typeof setTimeout>;
  lifetimeTimer?: ReturnType<typeof setTimeout>;
}

const IDLE_MS = 30 * 60 * 1000;
const MAX_LIFETIME_MS = 4 * 60 * 60 * 1000;

const sessions = new Map<string, InternalDebugSession>();

/**
 * Ownership-only watchdog. Re-checks, on a timer, that each ACTIVE
 * session's opener still owns the session's project, and routes a failure
 * through the same revocation path as a request-time failure. It only ever
 * REMOVES access: it cannot grant, extend (idle/lifetime timers and
 * lastActivityAt are untouched), or bypass a revocation. It does not
 * re-evaluate role changes (that needs a request context) — request-time
 * checks and the idle timer cover those.
 */
export const DEBUG_WATCHDOG_INTERVAL_MS = 15_000;
let watchdogTimer: ReturnType<typeof setInterval> | undefined;

function hasActiveSession(): boolean {
  for (const session of sessions.values()) if (session.status === "ACTIVE") return true;
  return false;
}

export function isDebugWatchdogRunning(): boolean {
  return watchdogTimer !== undefined;
}

function stopWatchdogIfIdle(): void {
  if (watchdogTimer && !hasActiveSession()) {
    clearInterval(watchdogTimer);
    watchdogTimer = undefined;
  }
}

function ensureWatchdog(): void {
  if (watchdogTimer) return;
  watchdogTimer = setInterval(() => {
    runDebugOwnershipWatchdogOnce();
  }, DEBUG_WATCHDOG_INTERVAL_MS);
  watchdogTimer.unref?.();
}

/** One sweep. Returns how many sessions it revoked. Strict equality: a missing owner record is NOT "still the owner". */
export function runDebugOwnershipWatchdogOnce(): number {
  let revoked = 0;
  for (const session of [...sessions.values()]) {
    if (session.status !== "ACTIVE") continue;
    if (getProjectOwnerId(session.projectId) !== session.openerId) {
      revokeDebugSessionAuthorization(session.sessionId, "project ownership no longer valid (watchdog)");
      revoked += 1;
    }
  }
  stopWatchdogIfIdle();
  return revoked;
}

function mintTicket(): string {
  return randomBytes(24).toString("hex");
}

function toSnapshot(session: InternalDebugSession): DebugSessionSnapshot {
  return {
    sessionId: session.sessionId,
    projectId: session.projectId,
    targetId: session.targetId,
    openerId: session.openerId,
    pid: session.pid,
    status: session.status,
    createdAt: session.createdAt,
    lastActivityAt: session.lastActivityAt,
  };
}

function audit(type: string, session: Pick<InternalDebugSession, "sessionId" | "projectId">, actorId: string, extra: Record<string, unknown> = {}): void {
  osStore.appendAudit({
    type,
    projectId: session.projectId,
    sessionId: session.sessionId,
    actorId,
    at: new Date().toISOString(),
    ...extra,
  });
}

function clearTimers(session: InternalDebugSession): void {
  if (session.idleTimer) clearTimeout(session.idleTimer);
  if (session.lifetimeTimer) clearTimeout(session.lifetimeTimer);
}

function armTimers(session: InternalDebugSession): void {
  clearTimers(session);
  session.idleTimer = setTimeout(() => {
    systemCloseDebugSession(session.sessionId, "timeout");
  }, IDLE_MS);
  session.lifetimeTimer = setTimeout(() => {
    systemCloseDebugSession(session.sessionId, "timeout");
  }, MAX_LIFETIME_MS);
}

function killChild(session: InternalDebugSession): void {
  try {
    session.child.kill("SIGTERM");
  } catch {
    /* already dead */
  }
}

export function hasActiveDebugSessionForTarget(projectId: string, targetId: string): boolean {
  for (const session of sessions.values()) {
    if (session.projectId === projectId && session.targetId === targetId && session.status === "ACTIVE") {
      return true;
    }
  }
  return false;
}

export function getDebugSession(sessionId: string): DebugSessionSnapshot | null {
  const session = sessions.get(sessionId);
  return session ? toSnapshot(session) : null;
}

export function getDebugSessionInternal(sessionId: string): InternalDebugSession | undefined {
  return sessions.get(sessionId);
}

export type CreateDebugSessionResult =
  | { readonly ok: true; readonly session: DebugSessionSnapshot; readonly ticket: string }
  | { readonly ok: false; readonly denial: DebugSpawnDenial; readonly reason: string };

export function createDebugSession(input: {
  readonly projectId: string;
  readonly openerId: string;
  readonly targetId: string;
  readonly workspaceRoot: string;
  readonly relativePath?: string;
}): CreateDebugSessionResult {
  const spawned = spawnDebugTarget({
    targetId: input.targetId,
    workspaceRoot: input.workspaceRoot,
    ...(input.relativePath ? { relativePath: input.relativePath } : {}),
  });
  if (!spawned.ok) {
    return { ok: false, denial: spawned.denial, reason: spawned.reason };
  }
  const sessionId = randomUUID();
  const now = new Date().toISOString();
  const session: InternalDebugSession = {
    sessionId,
    projectId: input.projectId,
    targetId: input.targetId,
    openerId: input.openerId,
    child: spawned.child,
    pid: spawned.pid,
    ticket: mintTicket(),
    status: "ACTIVE",
    createdAt: now,
    lastActivityAt: now,
  };
  sessions.set(sessionId, session);
  armTimers(session);
  ensureWatchdog();

  spawned.child.once("exit", () => {
    const current = sessions.get(sessionId);
    if (!current || current.status !== "ACTIVE") return;
    current.status = "TARGET_TERMINATED";
    clearTimers(current);
    audit("debugger.target.terminated", current, current.openerId);
  });

  audit("debugger.session.opened", session, input.openerId, {
    targetId: input.targetId,
    pid: session.pid,
  });

  return { ok: true, session: toSnapshot(session), ticket: session.ticket };
}

export type DebugActionDenial = "NOT_FOUND" | "NOT_OPENER" | "SESSION_NOT_ACTIVE";

export function performDebugAction(input: {
  readonly sessionId: string;
  readonly actorId: string;
  readonly action: "continue" | "pause" | "step" | "breakpoint.add" | "breakpoint.remove" | "inspect";
}): { readonly ok: true } | { readonly ok: false; readonly denial: DebugActionDenial; readonly reason: string } {
  const session = sessions.get(input.sessionId);
  if (!session) return { ok: false, denial: "NOT_FOUND", reason: "Debug session not found." };
  if (session.openerId !== input.actorId) {
    return { ok: false, denial: "NOT_OPENER", reason: "Only the identity that opened this session may act within it." };
  }
  if (session.status !== "ACTIVE") {
    return { ok: false, denial: "SESSION_NOT_ACTIVE", reason: `Session is ${session.status}, not ACTIVE.` };
  }
  session.lastActivityAt = new Date().toISOString();
  armTimers(session);
  audit("debugger.action.performed", session, input.actorId, { action: input.action });
  // NOTE (honest scope boundary, not claimed as complete): this records a
  // re-authorized, audited action request. Wiring the action to the V8
  // Inspector Protocol (CDP) of the paused target is a follow-on
  // implementation step requiring a WebSocket client — no new dependency
  // was added in this pass, per the authorization's dependency clause.
  return { ok: true };
}

/** Immediate fail-safe: authorization loss during an active session. */
export function revokeDebugSessionAuthorization(sessionId: string, reason: string): void {
  const session = sessions.get(sessionId);
  if (!session || session.status !== "ACTIVE") return;
  session.status = "AUTHORIZATION_REVOKED";
  clearTimers(session);
  killChild(session);
  audit("debugger.authorization.revoked", session, session.openerId, { reason });
}

export type DebugCloseDenial = "NOT_FOUND" | "NOT_OPENER" | "NOT_ADMIN" | "REASON_REQUIRED";

/** Voluntary close: opener only. */
export function closeDebugSessionVoluntary(
  sessionId: string,
  actorId: string,
): { readonly ok: true } | { readonly ok: false; readonly denial: DebugCloseDenial; readonly reason: string } {
  const session = sessions.get(sessionId);
  if (!session) return { ok: false, denial: "NOT_FOUND", reason: "Debug session not found." };
  if (session.openerId !== actorId) {
    return { ok: false, denial: "NOT_OPENER", reason: "Only the session opener may voluntarily close it." };
  }
  session.status = "CLOSED";
  clearTimers(session);
  killChild(session);
  audit("debugger.session.closed", session, actorId);
  return { ok: true };
}

/** Admin force-close: requires a non-empty reason, always audited distinctly. */
export function forceCloseDebugSession(input: {
  readonly sessionId: string;
  readonly actorId: string;
  readonly actorRole: string;
  readonly reason: string;
}): { readonly ok: true } | { readonly ok: false; readonly denial: DebugCloseDenial; readonly reason: string } {
  const session = sessions.get(input.sessionId);
  if (!session) return { ok: false, denial: "NOT_FOUND", reason: "Debug session not found." };
  if (input.actorRole !== "admin") {
    return { ok: false, denial: "NOT_ADMIN", reason: "Only an admin may force-close another identity's session." };
  }
  if (!input.reason.trim()) {
    return { ok: false, denial: "REASON_REQUIRED", reason: "A reason is required to force-close a debug session." };
  }
  session.status = "CLOSED";
  clearTimers(session);
  killChild(session);
  audit("debugger.session.force_closed", session, input.actorId, { reason: input.reason });
  return { ok: true };
}

/** System-triggered forced closure: always allowed, no permission check — housekeeping, not a privilege grant. */
export function systemCloseDebugSession(
  sessionId: string,
  cause: Extract<DebugSessionCloseCause, "timeout" | "target_terminated" | "configuration_error">,
): void {
  const session = sessions.get(sessionId);
  if (!session || session.status !== "ACTIVE") return;
  session.status = cause === "timeout" ? "SESSION_EXPIRED" : "TARGET_TERMINATED";
  clearTimers(session);
  killChild(session);
  const type =
    cause === "timeout"
      ? "debugger.session.expired"
      : cause === "target_terminated"
        ? "debugger.target.terminated"
        : "debugger.configuration_error";
  audit(type, session, session.openerId, { cause });
}

/** Test-only reset. */
export function resetDebugSessionsForTests(): void {
  for (const session of sessions.values()) {
    clearTimers(session);
    killChild(session);
  }
  sessions.clear();
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = undefined;
  }
}

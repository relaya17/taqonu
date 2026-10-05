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
import { lookupProjectOwner } from "./project-access.js";
import {
  CDP_MAX_EXPRESSION_CHARS,
  connectInspector,
  evaluateInTarget,
  initializeInspector,
  InspectorError,
  pauseTarget,
  resumeTarget,
  type EvaluationSummary,
  type InspectorConnection,
} from "./studio-debug-cdp.js";
import { spawnDebugTarget, type DebugSpawnDenial, type DebugTargetOutput } from "./studio-debug-spawn.js";

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

/**
 * What the target is actually doing, as the controller last observed it.
 * NOT_ATTACHED: ACTIVE, waiting at --inspect-brk for the first Inspector attach.
 * ENDED: the session is no longer ACTIVE.
 */
export type DebugTargetState = "NOT_ATTACHED" | "PAUSED" | "RUNNING" | "ENDED";

export interface DebugSessionSnapshot {
  readonly sessionId: string;
  readonly projectId: string;
  readonly targetId: string;
  readonly openerId: string;
  readonly pid: number;
  readonly status: DebugSessionStatus;
  readonly targetState: DebugTargetState;
  readonly createdAt: string;
  readonly lastActivityAt: string;
}

interface InternalDebugSession {
  readonly sessionId: string;
  readonly projectId: string;
  readonly targetId: string;
  readonly openerId: string;
  readonly child: ChildProcess;
  readonly output: DebugTargetOutput;
  readonly pid: number;
  ticket: string;
  status: DebugSessionStatus;
  readonly createdAt: string;
  /** Immutable creation-bound ceiling (epoch ms). Activity never moves it. */
  readonly absoluteDeadlineMs: number;
  lastActivityAt: string;
  idleTimer?: ReturnType<typeof setTimeout>;
  lifetimeTimer?: ReturnType<typeof setTimeout>;
  /** Controller-side Inspector connection; created lazily by the first dispatched action. */
  inspectorConn?: InspectorConnection | undefined;
  inspectorConnecting?: Promise<InspectorConnection> | undefined;
  /** Serializes Inspector commands for this session. */
  commandQueue: Promise<unknown>;
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

/**
 * One sweep. Returns how many sessions it revoked. Only an authorization-grade
 * (VERIFIED) owner record equal to the opener keeps a session: a missing,
 * malformed, unavailable or backup-recovered record is NOT "still the owner".
 * The session registry attributes each revocation, and a failure while
 * checking one session revokes that session without aborting the sweep.
 */
export function runDebugOwnershipWatchdogOnce(): number {
  let revoked = 0;
  for (const session of [...sessions.values()]) {
    if (session.status !== "ACTIVE") continue;
    try {
      const owner = lookupProjectOwner(session.projectId);
      if (owner.state !== "VERIFIED" || owner.ownerId !== session.openerId) {
        revokeDebugSessionAuthorization(
          session.sessionId,
          `project ownership no longer valid (watchdog; ownership=${owner.state})`,
        );
        revoked += 1;
      }
    } catch {
      revokeDebugSessionAuthorization(
        session.sessionId,
        "project ownership could not be checked (watchdog; ownership=ERROR)",
      );
      revoked += 1;
    }
  }
  stopWatchdogIfIdle();
  return revoked;
}

function mintTicket(): string {
  return randomBytes(24).toString("hex");
}

function targetStateOf(session: InternalDebugSession): DebugTargetState {
  if (session.status !== "ACTIVE") return "ENDED";
  if (!session.inspectorConn) return "NOT_ATTACHED";
  return session.inspectorConn.isPaused() ? "PAUSED" : "RUNNING";
}

function toSnapshot(session: InternalDebugSession): DebugSessionSnapshot {
  return {
    sessionId: session.sessionId,
    projectId: session.projectId,
    targetId: session.targetId,
    openerId: session.openerId,
    pid: session.pid,
    status: session.status,
    targetState: targetStateOf(session),
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

/** Accepted activity renews ONLY the idle timer. */
function armIdleTimer(session: InternalDebugSession): void {
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => {
    systemCloseDebugSession(session.sessionId, "timeout");
  }, IDLE_MS);
}

/** Armed once, at creation, against the immutable absolute deadline. */
function armLifetimeTimer(session: InternalDebugSession): void {
  session.lifetimeTimer = setTimeout(() => {
    systemCloseDebugSession(session.sessionId, "timeout");
  }, Math.max(0, session.absoluteDeadlineMs - Date.now()));
}

function disposeInspector(session: InternalDebugSession): void {
  const connection = session.inspectorConn;
  session.inspectorConn = undefined;
  session.inspectorConnecting = undefined;
  connection?.close();
}

/** Every terminal transition releases the timers AND the Inspector connection. */
function releaseResources(session: InternalDebugSession): void {
  clearTimers(session);
  disposeInspector(session);
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

export type DebugSessionCreateDenial = DebugSpawnDenial | "SPAWN_FAILED";

export type CreateDebugSessionResult =
  | { readonly ok: true; readonly session: DebugSessionSnapshot; readonly ticket: string }
  | { readonly ok: false; readonly denial: DebugSessionCreateDenial; readonly reason: string };

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
  // A launch that failed has no process: spawn() reports it with no pid. It
  // must not become an ACTIVE session that accepts actions against nothing.
  if (spawned.pid < 0) {
    return { ok: false, denial: "SPAWN_FAILED", reason: "The debug target process could not be started." };
  }
  const sessionId = randomUUID();
  const createdAtMs = Date.now();
  const now = new Date(createdAtMs).toISOString();
  const session: InternalDebugSession = {
    sessionId,
    projectId: input.projectId,
    targetId: input.targetId,
    openerId: input.openerId,
    child: spawned.child,
    output: spawned.output,
    pid: spawned.pid,
    ticket: mintTicket(),
    status: "ACTIVE",
    createdAt: now,
    absoluteDeadlineMs: createdAtMs + MAX_LIFETIME_MS,
    lastActivityAt: now,
    commandQueue: Promise.resolve(),
  };
  sessions.set(sessionId, session);
  armIdleTimer(session);
  armLifetimeTimer(session);
  ensureWatchdog();

  spawned.child.once("exit", () => {
    const current = sessions.get(sessionId);
    if (!current || current.status !== "ACTIVE") return;
    current.status = "TARGET_TERMINATED";
    releaseResources(current);
    audit("debugger.target.terminated", current, current.openerId);
  });

  audit("debugger.session.opened", session, input.openerId, {
    targetId: input.targetId,
    pid: session.pid,
  });

  return { ok: true, session: toSnapshot(session), ticket: session.ticket };
}

export type DebugActionDenial = "NOT_FOUND" | "NOT_OPENER" | "SESSION_NOT_ACTIVE";

export type DebugActionName =
  | "continue"
  | "pause"
  | "step"
  | "breakpoint.add"
  | "breakpoint.remove"
  | "inspect"
  | "evaluate";

/**
 * Authorization for acting within a session: it must exist, the actor must be
 * its opener, and it must still be ACTIVE and inside its absolute deadline.
 * No side effects other than expiring a session that is past its deadline.
 */
function authorizeDebugAction(
  sessionId: string,
  actorId: string,
): { readonly ok: true; readonly session: InternalDebugSession } | { readonly ok: false; readonly denial: DebugActionDenial; readonly reason: string } {
  const session = sessions.get(sessionId);
  if (!session) return { ok: false, denial: "NOT_FOUND", reason: "Debug session not found." };
  if (session.openerId !== actorId) {
    return { ok: false, denial: "NOT_OPENER", reason: "Only the identity that opened this session may act within it." };
  }
  // Enforced here as well as by the lifetime timer, so a delayed timer or a
  // late authorization result can never admit activity past the deadline.
  if (session.status === "ACTIVE" && Date.now() >= session.absoluteDeadlineMs) {
    systemCloseDebugSession(session.sessionId, "timeout");
  }
  if (session.status !== "ACTIVE") {
    return { ok: false, denial: "SESSION_NOT_ACTIVE", reason: `Session is ${session.status}, not ACTIVE.` };
  }
  return { ok: true, session };
}

/**
 * Records a re-authorized, audited action request and renews ONLY the idle
 * timer. This is authorization evidence, not proof that anything executed on
 * the target; execution is `dispatchDebugAction` and is audited separately.
 */
export function performDebugAction(input: {
  readonly sessionId: string;
  readonly actorId: string;
  readonly action: DebugActionName;
}): { readonly ok: true } | { readonly ok: false; readonly denial: DebugActionDenial; readonly reason: string } {
  const authorized = authorizeDebugAction(input.sessionId, input.actorId);
  if (!authorized.ok) return authorized;
  const { session } = authorized;
  session.lastActivityAt = new Date().toISOString();
  armIdleTimer(session);
  audit("debugger.action.performed", session, input.actorId, { action: input.action });
  return { ok: true };
}

export type DebugDispatchDenial =
  | DebugActionDenial
  | "ACTION_NOT_SUPPORTED"
  | "EXPRESSION_INVALID"
  | "INSPECTOR_UNAVAILABLE"
  | "COMMAND_FAILED";

export type DebugDispatchResult =
  | { readonly ok: true; readonly state: "paused" | "running"; readonly evaluation?: EvaluationSummary }
  | { readonly ok: false; readonly denial: DebugDispatchDenial; readonly reason: string };

/** The only actions wired to the Inspector in this slice. */
const DISPATCHABLE_ACTIONS: ReadonlySet<DebugActionName> = new Set(["continue", "pause", "evaluate"]);

const INSPECTOR_METHOD: Readonly<Record<string, string>> = {
  continue: "Debugger.resume",
  pause: "Debugger.pause",
  evaluate: "Runtime.evaluate",
};

async function ensureInspector(session: InternalDebugSession): Promise<InspectorConnection> {
  if (session.inspectorConn) return session.inspectorConn;
  if (!session.inspectorConnecting) {
    session.inspectorConnecting = (async () => {
      let connection: InspectorConnection | undefined;
      connection = await connectInspector({
        readStderr: () => session.output.stderr.text(),
        onClosed: () => {
          if (!connection || session.inspectorConn !== connection || session.status !== "ACTIVE") return;
          audit("debugger.inspector.disconnected", session, session.openerId);
          systemCloseDebugSession(session.sessionId, "target_terminated");
        },
        onTargetFinished: () => {
          if (session.status !== "ACTIVE") return;
          audit("debugger.inspector.target_finished", session, session.openerId);
          systemCloseDebugSession(session.sessionId, "target_terminated");
        },
      });
      try {
        await initializeInspector(connection);
      } catch (error) {
        connection.close();
        throw error;
      }
      if (session.status !== "ACTIVE") {
        connection.close();
        throw new InspectorError("CLOSED", "The session ended while connecting.");
      }
      session.inspectorConn = connection;
      audit("debugger.inspector.connected", session, session.openerId);
      return connection;
    })();
  }
  try {
    return await session.inspectorConnecting;
  } catch (error) {
    session.inspectorConnecting = undefined;
    throw error;
  }
}

async function executeInspectorAction(
  session: InternalDebugSession,
  actorId: string,
  action: DebugActionName,
  expression: string | undefined,
): Promise<DebugDispatchResult> {
  const method = INSPECTOR_METHOD[action] ?? action;
  let connection: InspectorConnection;
  try {
    connection = await ensureInspector(session);
  } catch (error) {
    const category = error instanceof InspectorError ? error.category : "COMMAND_ERROR";
    if (session.status === "ACTIVE") {
      audit("debugger.inspector.failed", session, actorId, { action, method, category });
      // A target whose Inspector cannot be reached is not debuggable: end it deterministically.
      systemCloseDebugSession(session.sessionId, "target_terminated");
    }
    return { ok: false, denial: "INSPECTOR_UNAVAILABLE", reason: "The debug target's Inspector is not available." };
  }

  try {
    let evaluation: EvaluationSummary | undefined;
    if (action === "continue") await resumeTarget(connection);
    else if (action === "pause") await pauseTarget(connection);
    else evaluation = await evaluateInTarget(connection, expression ?? "");

    // The session may have ended while the command was in flight: report that, and never renew anything.
    if (session.status !== "ACTIVE") {
      return { ok: false, denial: "SESSION_NOT_ACTIVE", reason: `Session is ${session.status}, not ACTIVE.` };
    }
    // Evaluation input and output are runtime data: only the size of the input is recorded.
    audit("debugger.inspector.command", session, actorId, {
      action,
      method,
      ok: true,
      ...(action === "evaluate" ? { expressionChars: expression?.length ?? 0 } : {}),
    });
    return {
      ok: true,
      state: connection.isPaused() ? "paused" : "running",
      ...(evaluation ? { evaluation } : {}),
    };
  } catch (error) {
    const category = error instanceof InspectorError ? error.category : "COMMAND_ERROR";
    if (session.status === "ACTIVE") {
      audit("debugger.inspector.command", session, actorId, { action, method, ok: false, category });
    }
    return { ok: false, denial: "COMMAND_FAILED", reason: "The Inspector command failed." };
  }
}

/**
 * Authorizes, records, then executes an action against the target's Inspector.
 * Layering: session authorization first, Inspector transport last.
 */
export async function dispatchDebugAction(input: {
  readonly sessionId: string;
  readonly actorId: string;
  readonly action: DebugActionName;
  readonly expression?: string;
}): Promise<DebugDispatchResult> {
  const authorized = authorizeDebugAction(input.sessionId, input.actorId);
  if (!authorized.ok) return authorized;
  const { session } = authorized;

  if (!DISPATCHABLE_ACTIONS.has(input.action)) {
    return {
      ok: false,
      denial: "ACTION_NOT_SUPPORTED",
      reason: `Action "${input.action}" is not wired to the debug target yet.`,
    };
  }
  if (input.action === "evaluate") {
    const expression = input.expression ?? "";
    if (expression.trim().length === 0 || expression.length > CDP_MAX_EXPRESSION_CHARS) {
      return {
        ok: false,
        denial: "EXPRESSION_INVALID",
        reason: `An expression of 1 to ${CDP_MAX_EXPRESSION_CHARS} characters is required.`,
      };
    }
  } else if (input.expression !== undefined) {
    return { ok: false, denial: "EXPRESSION_INVALID", reason: "An expression is only accepted by the evaluate action." };
  }

  const recorded = performDebugAction({ sessionId: input.sessionId, actorId: input.actorId, action: input.action });
  if (!recorded.ok) return recorded;

  const run = session.commandQueue.then(
    () => executeInspectorAction(session, input.actorId, input.action, input.expression),
    () => executeInspectorAction(session, input.actorId, input.action, input.expression),
  );
  session.commandQueue = run.catch(() => undefined);
  return run;
}

/** Immediate fail-safe: authorization loss during an active session. */
export function revokeDebugSessionAuthorization(sessionId: string, reason: string): void {
  const session = sessions.get(sessionId);
  if (!session || session.status !== "ACTIVE") return;
  session.status = "AUTHORIZATION_REVOKED";
  releaseResources(session);
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
  releaseResources(session);
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
  releaseResources(session);
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
  releaseResources(session);
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
    releaseResources(session);
    killChild(session);
  }
  sessions.clear();
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = undefined;
  }
}

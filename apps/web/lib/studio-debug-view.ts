/**
 * Studio Debugger view model — pure helpers for StudioDebugPanel.
 *
 * The UI is NOT a security boundary. Everything here only decides what to
 * show or disable; every action still goes through the authorized
 * Debug Session API, which rejects it independently. A visible button is never
 * an authorization.
 */

/** Mirrors the API snapshot. `targetState` is what the controller last observed. */
export type DebugTargetState = "NOT_ATTACHED" | "PAUSED" | "RUNNING" | "ENDED";

export interface DebugSessionView {
  readonly sessionId: string;
  readonly status: string;
  readonly targetState?: string;
}

export type DebugStateKey =
  | "none"
  | "notAttached"
  | "paused"
  | "running"
  | "expired"
  | "revoked"
  | "terminated"
  | "closed"
  | "unavailable";

export interface DebugUiActions {
  readonly resume: boolean;
  readonly pause: boolean;
  readonly evaluate: boolean;
  readonly close: boolean;
}

const NO_ACTIONS: DebugUiActions = { resume: false, pause: false, evaluate: false, close: false };

export const DEBUG_EVALUATE_MAX_CHARS = 4096;
const RESULT_TEXT_MAX_CHARS = 2000;

/** HTTP statuses that mean "this session can no longer be acted on" rather than "try again". */
export function isSessionLostStatus(status: number | undefined): boolean {
  return status === 401 || status === 403 || status === 404;
}

export function debugStateKey(
  session: DebugSessionView | null | undefined,
  lookupFailedWithStatus?: number,
): DebugStateKey {
  if (isSessionLostStatus(lookupFailedWithStatus)) return "unavailable";
  if (!session) return "none";
  switch (session.status) {
    case "ACTIVE":
      switch (session.targetState) {
        case "NOT_ATTACHED":
          return "notAttached";
        case "PAUSED":
          return "paused";
        case "RUNNING":
          return "running";
        default:
          // An unknown or missing target state is never interpreted as actionable.
          return "unavailable";
      }
    case "SESSION_EXPIRED":
      return "expired";
    case "AUTHORIZATION_REVOKED":
      return "revoked";
    case "TARGET_TERMINATED":
      return "terminated";
    case "CLOSED":
      return "closed";
    default:
      return "unavailable";
  }
}

/**
 * Which controls may be offered. Resume is offered while the target is waiting
 * at entry or paused; Pause only while it runs; Evaluate while the session is
 * active. Nothing is offered once the session is not ACTIVE.
 */
export function debugUiActions(stateKey: DebugStateKey): DebugUiActions {
  switch (stateKey) {
    case "notAttached":
    case "paused":
      return { resume: true, pause: false, evaluate: true, close: true };
    case "running":
      return { resume: false, pause: true, evaluate: true, close: true };
    default:
      return NO_ACTIONS;
  }
}

export function isTerminalStateKey(stateKey: DebugStateKey): boolean {
  return stateKey === "expired" || stateKey === "revoked" || stateKey === "terminated" || stateKey === "closed";
}

export type ExpressionCheck = "ok" | "empty" | "tooLong";

export function checkExpression(expression: string): ExpressionCheck {
  if (expression.trim().length === 0) return "empty";
  if (expression.length > DEBUG_EVALUATE_MAX_CHARS) return "tooLong";
  return "ok";
}

/**
 * Defense in depth: no Inspector endpoint should ever reach the browser, but if
 * one appears in any text we are about to render, it is replaced.
 */
export function stripInspectorEndpoints(text: string): string {
  return text.replace(/wss?:\/\/[^\s"'<>]+/gi, "[endpoint hidden]");
}

const bounded = (text: string): string =>
  stripInspectorEndpoints(text.length > RESULT_TEXT_MAX_CHARS ? `${text.slice(0, RESULT_TEXT_MAX_CHARS)}…` : text);

export interface EvaluationView {
  readonly type?: string;
  readonly subtype?: string;
  readonly value?: string | number | boolean | null;
  readonly description?: string;
  readonly exception?: string;
}

export type FormattedEvaluation =
  | { readonly kind: "value"; readonly text: string; readonly type: string }
  | { readonly kind: "description"; readonly text: string; readonly type: string }
  | { readonly kind: "undefined"; readonly text: string; readonly type: string }
  | { readonly kind: "exception"; readonly text: string; readonly type: string };

/** A bounded, text-only rendering of an evaluation summary. Objects are shown by description only. */
export function formatEvaluation(evaluation: EvaluationView): FormattedEvaluation {
  const type = evaluation.type ?? "unknown";
  if (evaluation.exception !== undefined) {
    return { kind: "exception", type: "exception", text: bounded(evaluation.exception) };
  }
  if (evaluation.value !== undefined) {
    const text = typeof evaluation.value === "string" ? evaluation.value : String(evaluation.value);
    return { kind: "value", type, text: bounded(text) };
  }
  if (evaluation.description !== undefined) {
    return { kind: "description", type, text: bounded(evaluation.description) };
  }
  return { kind: "undefined", type, text: type === "undefined" ? "undefined" : "" };
}

/** A short, bounded, endpoint-free message for a failed action request. */
export function actionErrorText(error: unknown, fallback: string): string {
  const message = error instanceof Error && error.message ? error.message : fallback;
  return bounded(message.length > 300 ? `${message.slice(0, 300)}…` : message);
}

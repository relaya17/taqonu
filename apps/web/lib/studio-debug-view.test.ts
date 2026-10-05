import { describe, expect, it } from "vitest";
import {
  actionErrorText,
  checkExpression,
  DEBUG_EVALUATE_MAX_CHARS,
  debugStateKey,
  debugUiActions,
  formatEvaluation,
  isSessionLostStatus,
  isTerminalStateKey,
  stripInspectorEndpoints,
} from "./studio-debug-view";

const active = (targetState?: string) => ({ sessionId: "s", status: "ACTIVE", ...(targetState ? { targetState } : {}) });

describe("debugStateKey (reflects the real session, not a UI-side state)", () => {
  it("no session", () => {
    expect(debugStateKey(null)).toBe("none");
    expect(debugStateKey(undefined)).toBe("none");
  });

  it.each([
    ["NOT_ATTACHED", "notAttached"],
    ["PAUSED", "paused"],
    ["RUNNING", "running"],
  ] as const)("an ACTIVE session with target state %s is %s", (targetState, key) => {
    expect(debugStateKey(active(targetState))).toBe(key);
  });

  it("an ACTIVE session with an unknown or missing target state is never actionable", () => {
    expect(debugStateKey(active("SOMETHING_NEW"))).toBe("unavailable");
    expect(debugStateKey(active())).toBe("unavailable");
  });

  it.each([
    ["SESSION_EXPIRED", "expired"],
    ["AUTHORIZATION_REVOKED", "revoked"],
    ["TARGET_TERMINATED", "terminated"],
    ["CLOSED", "closed"],
    ["SOMETHING_ELSE", "unavailable"],
  ] as const)("status %s is %s regardless of the target state", (status, key) => {
    expect(debugStateKey({ sessionId: "s", status, targetState: "RUNNING" })).toBe(key);
  });

  it("a lost-access poll result overrides the last known state", () => {
    for (const status of [401, 403, 404]) {
      expect(debugStateKey(active("RUNNING"), status)).toBe("unavailable");
      expect(isSessionLostStatus(status)).toBe(true);
    }
    expect(isSessionLostStatus(500)).toBe(false);
    expect(isSessionLostStatus(undefined)).toBe(false);
    expect(debugStateKey(active("RUNNING"), 500)).toBe("running");
  });
});

describe("debugUiActions (usability only; the service re-authorizes every action)", () => {
  it("offers Resume (not Pause) while waiting at entry or paused", () => {
    for (const key of ["notAttached", "paused"] as const) {
      expect(debugUiActions(key)).toEqual({ resume: true, pause: false, evaluate: true, close: true });
    }
  });

  it("offers Pause (not Resume) while running", () => {
    expect(debugUiActions("running")).toEqual({ resume: false, pause: true, evaluate: true, close: true });
  });

  it.each(["none", "expired", "revoked", "terminated", "closed", "unavailable"] as const)(
    "offers nothing in state %s",
    (key) => {
      expect(debugUiActions(key)).toEqual({ resume: false, pause: false, evaluate: false, close: false });
    },
  );

  it("never offers Resume and Pause together", () => {
    for (const key of ["none", "notAttached", "paused", "running", "expired", "revoked", "terminated", "closed", "unavailable"] as const) {
      const actions = debugUiActions(key);
      expect(actions.resume && actions.pause).toBe(false);
    }
  });

  it("terminal states are identified", () => {
    for (const key of ["expired", "revoked", "terminated", "closed"] as const) expect(isTerminalStateKey(key)).toBe(true);
    for (const key of ["none", "notAttached", "paused", "running", "unavailable"] as const) expect(isTerminalStateKey(key)).toBe(false);
  });
});

describe("expression limits mirror the API's 4,096 characters", () => {
  it("classifies empty, whitespace, ok and too long", () => {
    expect(checkExpression("")).toBe("empty");
    expect(checkExpression("   ")).toBe("empty");
    expect(checkExpression("1 + 1")).toBe("ok");
    expect(checkExpression("x".repeat(DEBUG_EVALUATE_MAX_CHARS))).toBe("ok");
    expect(checkExpression("x".repeat(DEBUG_EVALUATE_MAX_CHARS + 1))).toBe("tooLong");
    expect(DEBUG_EVALUATE_MAX_CHARS).toBe(4096);
  });
});

describe("evaluation rendering is bounded, text-only and endpoint-free", () => {
  it("renders primitives by value", () => {
    expect(formatEvaluation({ type: "number", value: 42 })).toEqual({ kind: "value", type: "number", text: "42" });
    expect(formatEvaluation({ type: "string", value: "hi" })).toEqual({ kind: "value", type: "string", text: "hi" });
    expect(formatEvaluation({ type: "boolean", value: false })).toEqual({ kind: "value", type: "boolean", text: "false" });
    expect(formatEvaluation({ type: "object", subtype: "null", value: null }).text).toBe("null");
  });

  it("renders objects by description only", () => {
    expect(formatEvaluation({ type: "object", description: "Object" })).toEqual({
      kind: "description",
      type: "object",
      text: "Object",
    });
  });

  it("renders undefined", () => {
    expect(formatEvaluation({ type: "undefined" })).toEqual({ kind: "undefined", type: "undefined", text: "undefined" });
  });

  it("renders a bounded exception", () => {
    const result = formatEvaluation({ exception: "Error: boom\n    at <anonymous>:1:7" });
    expect(result.kind).toBe("exception");
    expect(result.text).toContain("boom");
  });

  it("bounds long text", () => {
    const result = formatEvaluation({ type: "string", value: "x".repeat(10_000) });
    expect(result.text.length).toBeLessThanOrEqual(2001);
    expect(result.text.endsWith("…")).toBe(true);
  });

  it("never renders an Inspector endpoint, even if one leaked into a value", () => {
    const leak = "ws://127.0.0.1:54995/743a6555-e4eb-49fc-8026-71e4780cd31c";
    for (const evaluation of [
      { type: "string", value: `see ${leak}` },
      { type: "object", description: leak },
      { exception: `Error at ${leak}` },
    ]) {
      expect(formatEvaluation(evaluation).text).not.toContain("743a6555");
      expect(formatEvaluation(evaluation).text).not.toMatch(/ws:\/\//);
    }
    expect(stripInspectorEndpoints("a wss://host/x b")).toBe("a [endpoint hidden] b");
  });

  it("action errors are bounded and endpoint-free, with a fallback", () => {
    expect(actionErrorText(new Error("The Inspector command failed."), "fallback")).toBe("The Inspector command failed.");
    expect(actionErrorText("not an error", "fallback")).toBe("fallback");
    expect(actionErrorText(new Error(""), "fallback")).toBe("fallback");
    expect(actionErrorText(new Error("x".repeat(1000)), "f").length).toBeLessThanOrEqual(2001);
    expect(actionErrorText(new Error("bad ws://127.0.0.1:1/abc-def-123"), "f")).not.toMatch(/ws:\/\//);
  });
});

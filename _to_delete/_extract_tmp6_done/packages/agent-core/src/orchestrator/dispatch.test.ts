import { describe, expect, it } from "vitest";
import { dispatchAgentPlan } from "./dispatch.js";

describe("dispatchAgentPlan", () => {
  it("runs every non-JUDGE step and produces a final judge decision", () => {
    const result = dispatchAgentPlan({ request: "fix the login bug" });
    expect(result.runs.length).toBeGreaterThan(0);
    expect(result.runs.every((r) => r.agentId !== "JUDGE")).toBe(true);
    expect(result.judge).not.toBeNull();
  });

  it("reports real (not synthetic) zero cost for the stub — it never calls an LLM provider", () => {
    const result = dispatchAgentPlan({ request: "fix the login bug" });
    expect(result.runs.every((r) => r.costUsd === 0)).toBe(true);
  });

  it("runJudge=false skips the judge entirely", () => {
    const result = dispatchAgentPlan({ request: "fix the login bug", runJudge: false });
    expect(result.judge).toBeNull();
  });

  it("uses a specialistOverride when provided instead of the stub", () => {
    const overrideResult = {
      agentId: "SECURITY" as const,
      status: "COMPLETED" as const,
      summary: "overridden",
      claims: ["overridden claim"],
      evidenceRefs: ["ref"],
      epistemicState: "OBSERVED" as const,
      costUsd: 0.01,
      durationMs: 1,
    };
    const result = dispatchAgentPlan({
      request: "auth security review",
      agentIds: ["SECURITY"],
      specialistOverride: (agentId) =>
        agentId === "SECURITY" ? overrideResult : null,
    });
    const security = result.runs.find((r) => r.agentId === "SECURITY");
    expect(security?.summary).toBe("overridden");
  });

  it("falls back to the stub when specialistOverride returns null/undefined", () => {
    const result = dispatchAgentPlan({
      request: "fix the login bug",
      agentIds: ["DEBUGGER"],
      specialistOverride: () => null,
    });
    const debugger_ = result.runs.find((r) => r.agentId === "DEBUGGER");
    expect(debugger_).toBeDefined();
    expect(debugger_?.summary).not.toBe("overridden");
  });

  it("assigns a unique id + traceId to every dispatch", () => {
    const a = dispatchAgentPlan({ request: "check accessibility" });
    const b = dispatchAgentPlan({ request: "check accessibility" });
    expect(a.id).not.toBe(b.id);
    expect(a.traceId).not.toBe(b.traceId);
  });
});

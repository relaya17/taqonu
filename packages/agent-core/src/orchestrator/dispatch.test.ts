import { describe, expect, it } from "vitest";
import { dispatchAgentPlan } from "./dispatch.js";

describe("dispatchAgentPlan", () => {
  it("runs every non-JUDGE step and produces a final judge decision", async () => {
    const result = await dispatchAgentPlan({ request: "fix the login bug" });
    expect(result.runs.length).toBeGreaterThan(0);
    expect(result.runs.every((r) => r.agentId !== "JUDGE")).toBe(true);
    expect(result.judge).not.toBeNull();
  });

  it("reports real (not synthetic) zero cost for the stub — it never calls an LLM provider", async () => {
    const result = await dispatchAgentPlan({ request: "fix the login bug" });
    expect(result.runs.every((r) => r.costUsd === 0)).toBe(true);
  });

  it("runJudge=false skips the judge entirely", async () => {
    const result = await dispatchAgentPlan({ request: "fix the login bug", runJudge: false });
    expect(result.judge).toBeNull();
  });

  it("uses a specialistOverride when provided instead of the stub", async () => {
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
    const result = await dispatchAgentPlan({
      request: "auth security review",
      agentIds: ["SECURITY"],
      specialistOverride: (agentId) =>
        agentId === "SECURITY" ? overrideResult : null,
    });
    const security = result.runs.find((r) => r.agentId === "SECURITY");
    expect(security?.summary).toBe("overridden");
  });

  it("falls back to the stub when specialistOverride returns null/undefined", async () => {
    const result = await dispatchAgentPlan({
      request: "fix the login bug",
      agentIds: ["DEBUGGER"],
      specialistOverride: () => null,
    });
    const debugger_ = result.runs.find((r) => r.agentId === "DEBUGGER");
    expect(debugger_).toBeDefined();
    expect(debugger_?.summary).not.toBe("overridden");
  });

  it("awaits an ASYNC specialistOverride and keeps run order stable — the contract LLM-backed specialists need", async () => {
    const result = await dispatchAgentPlan({
      request: "refactor the auth module",
      agentIds: ["CODE_ENGINEER"],
      runJudge: false,
      specialistOverride: async (agentId) =>
        agentId === "CODE_ENGINEER"
          ? {
              agentId: "CODE_ENGINEER",
              status: "COMPLETED",
              summary: "async override",
              claims: ["proposed RECORD.CREATE"],
              evidenceRefs: ["ref"],
              epistemicState: "PROPOSED",
              costUsd: 0.0042,
              durationMs: 3,
            }
          : null,
    });
    const engineer = result.runs.find((r) => r.agentId === "CODE_ENGINEER");
    // Resolved, not left as a pending Promise masquerading as a run.
    expect(engineer?.summary).toBe("async override");
    expect(engineer?.costUsd).toBe(0.0042);
    // Every other step still fell through to the stub, in plan order.
    expect(result.runs[0]?.agentId).toBe("ORCHESTRATOR");
    expect(result.runs.every((r) => r.agentId !== "JUDGE")).toBe(true);
  });

  it("assigns a unique id + traceId to every dispatch", async () => {
    const a = await dispatchAgentPlan({ request: "check accessibility" });
    const b = await dispatchAgentPlan({ request: "check accessibility" });
    expect(a.id).not.toBe(b.id);
    expect(a.traceId).not.toBe(b.traceId);
  });

  it("does not expose Civio-scoped knowledge to an unauthorized specialist", async () => {
    const result = await dispatchAgentPlan({
      request: "תעודת זכאות לדיור ציבורי",
      agentIds: ["LEGAL_MEDIA_COMMS", "SECURITY"],
      runJudge: false,
      retrievalScope: {
        ownerId: "11111111-1111-4111-8111-111111111111",
        tenantId: "tenant-test",
        projectId: "22222222-2222-4222-8222-222222222222",
        applicationId: "app-test",
        requestingAgentId: "LEGAL_MEDIA_COMMS",
      },
    });
    const legal = result.runs.find((run) => run.agentId === "LEGAL_MEDIA_COMMS");
    const security = result.runs.find((run) => run.agentId === "SECURITY");

    expect(legal?.claims.some((claim) => claim.includes("תעודת זכאות"))).toBe(true);
    expect(security?.claims.some((claim) => claim.includes("תעודת זכאות"))).toBe(false);
  });
});

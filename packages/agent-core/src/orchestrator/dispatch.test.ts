import { afterEach, describe, expect, it } from "vitest";
import { dispatchAgentPlan } from "./dispatch.js";
import { resetAgentLifecycleForTests, setAgentEnabled } from "../kernel/registry-lifecycle.js";

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

  it("AD-1 (REQ-8-5): a disabled catalog agent is SKIPPED with auditable claims and does not execute", async () => {
    // 1. SECURITY is a valid registered Fabric Agent (member of FABRIC_AGENT_IDS catalog)
    // 2. Explicitly disable it via the lifecycle overlay
    const setResult = setAgentEnabled("SECURITY", false);
    expect(setResult.ok).toBe(true);

    // 3. Invoke dispatchAgentPlan — only SECURITY requested (+ auto-added ORCHESTRATOR)
    const result = await dispatchAgentPlan({
      request: "security review",
      agentIds: ["SECURITY"],
      runJudge: false,
    });

    // 4 + 5. The disabled agent does not execute; its run entry has SKIPPED status
    const securityRun = result.runs.find((r) => r.agentId === "SECURITY");
    expect(securityRun).toBeDefined();
    expect(securityRun?.status).toBe("SKIPPED");

    // 6. Required claims are present
    expect(securityRun?.claims).toContain(
      "registration.enforcement: agentId=SECURITY status=disabled",
    );
    expect(securityRun?.claims).toContain("dispatch.denied: agentId=SECURITY");

    // 7. Required evidenceRefs are present
    expect(securityRun?.evidenceRefs).toContain("denied:registry.disabled:SECURITY");
    expect(securityRun?.evidenceRefs).toContain(
      "audit:dispatch.registration.denied:agentId=SECURITY",
    );

    // 8. No unrelated agent was accidentally affected — all other runs must NOT be SKIPPED
    const otherRuns = result.runs.filter((r) => r.agentId !== "SECURITY");
    for (const run of otherRuns) {
      expect(run.status).not.toBe("SKIPPED");
    }

    // 9. Existing enabled-state behavior is intact: SECURITY is only disabled in this test;
    //    afterEach() calls resetAgentLifecycleForTests() to restore the default enabled state.
    //    The remaining tests in this suite continue to see SECURITY as enabled.
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

  afterEach(() => {
    // Restore default enabled state so no test bleeds lifecycle state into the next
    resetAgentLifecycleForTests();
  });
});

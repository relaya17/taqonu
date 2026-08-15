import { describe, expect, it } from "vitest";
import { planAgentWork } from "./plan.js";
import { dispatchAgentPlan } from "./dispatch.js";

describe("fabric plan/dispatch specialist lanes", () => {
  it("forces selected specialist into the plan with Orchestrator + Judge", () => {
    const plan = planAgentWork({
      request: "Review UI empty states on projects screen",
      agentIds: ["UI_UX"],
      budgetUsd: 2,
    });
    const ids = plan.steps.map((s) => s.agentId);
    expect(ids[0]).toBe("ORCHESTRATOR");
    expect(ids).toContain("UI_UX");
    expect(ids[ids.length - 1]).toBe("JUDGE");
    expect(plan.routerHints.some((h) => h.includes("forcedSpecialists=UI_UX"))).toBe(
      true,
    );
  });

  it("uses specialistOverride for SECURITY instead of the stub", () => {
    const result = dispatchAgentPlan({
      request: "security auth rls secrets",
      agentIds: ["SECURITY"],
      runJudge: false,
      specialistOverride: (id) =>
        id === "SECURITY"
          ? {
              agentId: "SECURITY",
              status: "COMPLETED",
              summary: "Sentinel HIGH: 1 critical",
              claims: ["SECURITY: sentinel_posture=HIGH", "WRITE=forbidden"],
              evidenceRefs: ["sentinel:secret:1"],
              epistemicState: "OBSERVED",
              costUsd: 0,
              durationMs: 2,
            }
          : null,
    });
    const security = result.runs.find((r) => r.agentId === "SECURITY");
    expect(security?.epistemicState).toBe("OBSERVED");
    expect(security?.summary).toContain("Sentinel");
  });

  it("dispatches forced specialist even when router would pick others", () => {
    const result = dispatchAgentPlan({
      request: "security auth rls secrets threat surface",
      agentIds: ["ACCESSIBILITY"],
      runJudge: true,
    });
    const runIds = result.runs.map((r) => r.agentId);
    expect(runIds).toContain("ACCESSIBILITY");
    expect(runIds).toContain("ORCHESTRATOR");
    expect(result.judge).not.toBeNull();
  });
});

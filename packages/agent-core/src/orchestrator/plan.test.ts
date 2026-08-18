import { describe, expect, it } from "vitest";
import { planAgentWork } from "./plan.js";

describe("planAgentWork", () => {
  it("always opens with ORCHESTRATOR and closes with JUDGE", () => {
    const plan = planAgentWork({ request: "fix the login bug" });
    expect(plan.steps[0]?.agentId).toBe("ORCHESTRATOR");
    expect(plan.steps[plan.steps.length - 1]?.agentId).toBe("JUDGE");
  });

  it("respects an explicit agentIds override (forced specialist lane)", () => {
    const plan = planAgentWork({ request: "anything", agentIds: ["DEBUGGER"] });
    expect(plan.steps.some((s) => s.agentId === "DEBUGGER")).toBe(true);
    expect(plan.routerHints.some((h) => h.includes("forcedSpecialists=DEBUGGER"))).toBe(
      true,
    );
  });

  it("scales estimated total cost down to fit budgetUsd", () => {
    const plan = planAgentWork({
      request: "build a new saas app with payments",
      budgetUsd: 0.05,
    });
    expect(plan.estimatedTotalCostUsd).toBeLessThanOrEqual(0.05 + 1e-9);
  });

  it("never produces two JUDGE steps even if routing would naturally add one", () => {
    const plan = planAgentWork({ request: "security review of auth secrets" });
    expect(plan.steps.filter((s) => s.agentId === "JUDGE")).toHaveLength(1);
  });

  it("caps specialists to maxAgents - 1 (ORCHESTRATOR takes one slot)", () => {
    const plan = planAgentWork({
      request: "build a new saas app with payments and booking",
      maxAgents: 3,
    });
    const nonJudgeNonOrchestrator = plan.steps.filter(
      (s) => s.agentId !== "ORCHESTRATOR" && s.agentId !== "JUDGE",
    );
    expect(nonJudgeNonOrchestrator.length).toBeLessThanOrEqual(2);
  });
});

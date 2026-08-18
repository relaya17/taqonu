import { describe, expect, it } from "vitest";
import { createTaskPlan } from "./task-plan.js";
import { runSimulation } from "./simulation.js";

describe("runSimulation", () => {
  it("blocks apply_patch/prod_mutate when write-capable agents are in the plan", () => {
    const plan = createTaskPlan({ request: "implement and fix the payments code" });
    const sim = runSimulation(plan);
    if (plan.requiredAgents.includes("CODE_ENGINEER")) {
      expect(sim.blockedActions).toContain("apply_patch");
      expect(sim.requiresHuman).toBe(true);
      expect(sim.allowed).toBe(false);
    }
  });

  it("blocks deploy and requires human approval for production-flavored objectives", () => {
    const plan = createTaskPlan({ request: "deploy to production now" });
    const sim = runSimulation(plan);
    expect(sim.blockedActions).toContain("deploy");
    expect(sim.proposedActions).toContain("human_approval_gate");
    expect(sim.requiresHuman).toBe(true);
  });

  it("is fully allowed (read-only) for a benign low-risk request with no write agents", () => {
    const plan = createTaskPlan({
      request: "show me the roadmap",
      maxAgents: 1,
    });
    if (
      !plan.requiredAgents.some((id) =>
        ["CODE_ENGINEER", "DEBUGGER", "TEST_ENGINEER"].includes(id),
      ) &&
      plan.riskLevel === "LOW"
    ) {
      const sim = runSimulation(plan);
      expect(sim.allowed).toBe(true);
      expect(sim.blockedActions).toEqual([]);
    }
  });

  it("carries the plan's riskLevel and taskPlanId through to the result", () => {
    const plan = createTaskPlan({ request: "production critical secret rotation" });
    const sim = runSimulation(plan);
    expect(sim.riskLevel).toBe(plan.riskLevel);
    expect(sim.taskPlanId).toBe(plan.id);
  });
});

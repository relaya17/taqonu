import { describe, expect, it } from "vitest";
import { createTaskPlan } from "./task-plan.js";

describe("createTaskPlan", () => {
  it("always includes ORCHESTRATOR and at least one specialist", () => {
    const plan = createTaskPlan({ request: "fix the login bug" });
    expect(plan.requiredAgents[0]).toBe("ORCHESTRATOR");
    expect(plan.requiredAgents.length).toBeGreaterThan(1);
    expect(plan.subtasks[0]?.agentId).toBe("ORCHESTRATOR");
  });

  it("classifies production/secret/auth requests as CRITICAL risk and forces simulation", () => {
    const plan = createTaskPlan({ request: "production secret auth rotation" });
    expect(plan.riskLevel).toBe("CRITICAL");
    expect(plan.simulationRequired).toBe(true);
  });

  it("classifies a plain read request as LOW risk", () => {
    const plan = createTaskPlan({ request: "show me the current roadmap" });
    expect(plan.riskLevel).toBe("LOW");
  });

  it("adds JUDGE automatically for HIGH/CRITICAL risk plans", () => {
    const plan = createTaskPlan({ request: "patch and fix the security bug" });
    expect(["HIGH", "CRITICAL"]).toContain(plan.riskLevel);
    expect(plan.requiredAgents).toContain("JUDGE");
  });

  it("caps specialists to respect maxAgents", () => {
    const plan = createTaskPlan({
      request: "build a new saas app with payments and booking",
      maxAgents: 2,
    });
    // ORCHESTRATOR + at most 1 specialist when maxAgents=2
    expect(plan.requiredAgents.length).toBeLessThanOrEqual(2);
  });

  it("scales estimated costs down to fit the requested budget", () => {
    const plan = createTaskPlan({
      request: "build a new saas app with payments and booking",
      budgetUsd: 0.01,
    });
    const total = plan.subtasks.reduce((n, s) => n + s.estimatedCostUsd, 0);
    expect(total).toBeLessThanOrEqual(0.01 + 1e-9);
  });

  it("never drops below the $0 budget floor", () => {
    const plan = createTaskPlan({ request: "refactor the payments module", budgetUsd: 0 });
    expect(plan.budgetUsd).toBe(0);
  });

  it("dependencies only reference subtask ids that exist in the plan", () => {
    const plan = createTaskPlan({ request: "fix and test the security patch" });
    const ids = new Set(plan.subtasks.map((s) => s.id));
    for (const dep of plan.dependencies) {
      expect(ids.has(dep.from)).toBe(true);
      expect(ids.has(dep.to)).toBe(true);
    }
  });

  // Regression: taskPlanSchema.objective must accept everything the public
  // request schemas (kernelRunRequestSchema / createTaskPlanRequestSchema)
  // allow (request: max 8000). A tighter internal cap here silently rejects
  // otherwise-valid API calls with a confusing 400 VALIDATION_ERROR.
  it("accepts a request up to the 8000-char API limit without throwing", () => {
    const longRequest = "fix bug ".repeat(1000).slice(0, 8000);
    expect(longRequest.length).toBe(8000);
    expect(() => createTaskPlan({ request: longRequest })).not.toThrow();
    const plan = createTaskPlan({ request: longRequest });
    expect(plan.objective.length).toBe(8000);
  });

  it("accepts a mid-range request (>4000 chars) that used to crash with the old 4000-char objective cap", () => {
    const midRequest = "fix bug ".repeat(700); // 5600 chars
    expect(midRequest.length).toBeGreaterThan(4000);
    expect(midRequest.length).toBeLessThan(8000);
    expect(() => createTaskPlan({ request: midRequest })).not.toThrow();
  });
});

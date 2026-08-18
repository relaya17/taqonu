import { describe, expect, it } from "vitest";
import {
  createTaskPlanRequestSchema,
  kernelRunRequestSchema,
  taskPlanSchema,
} from "./kernel.schema.js";

describe("kernelRunRequestSchema / createTaskPlanRequestSchema boundaries", () => {
  it("both accept a request up to 8000 chars and reject 8001", () => {
    for (const schema of [kernelRunRequestSchema, createTaskPlanRequestSchema]) {
      expect(() => schema.parse({ request: "x".repeat(8000) })).not.toThrow();
      expect(() => schema.parse({ request: "x".repeat(8001) })).toThrow();
    }
  });

  it("kernelRunRequestSchema defaults runSimulation/runJudge to true", () => {
    const parsed = kernelRunRequestSchema.parse({ request: "hi there" });
    expect(parsed.runSimulation).toBe(true);
    expect(parsed.runJudge).toBe(true);
  });

  it("rejects maxAgents outside [1, 8] and budgetUsd outside [0, 20]", () => {
    expect(() =>
      kernelRunRequestSchema.parse({ request: "hi there", maxAgents: 9 }),
    ).toThrow();
    expect(() =>
      kernelRunRequestSchema.parse({ request: "hi there", budgetUsd: 21 }),
    ).toThrow();
    expect(() =>
      kernelRunRequestSchema.parse({ request: "hi there", budgetUsd: -1 }),
    ).toThrow();
  });
});

// Regression: taskPlanSchema.objective must stay >= the request-schema max()
// above (8000), since createTaskPlan() feeds the raw request straight into
// `objective` with no truncation. A smaller cap here used to reject
// otherwise API-valid requests (4001-8000 chars) with a confusing 400.
describe("taskPlanSchema.objective boundary matches the public request schemas", () => {
  const validPlanFields = {
    id: "00000000-0000-4000-8000-000000000000",
    projectId: null,
    subtasks: [
      {
        id: "t1",
        title: "t",
        agentId: "ORCHESTRATOR" as const,
        dependsOn: [],
        requiredEvidence: [],
        parallelGroup: 0,
        estimatedCostUsd: 0,
      },
    ],
    dependencies: [],
    requiredAgents: ["ORCHESTRATOR" as const],
    requiredEvidence: [],
    riskLevel: "LOW" as const,
    budgetUsd: 1,
    successCriteria: ["done"],
    simulationRequired: false,
    modelHint: "cheap" as const,
    routerHints: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    epistemicState: "INFERRED" as const,
  };

  it("accepts an objective at the 8000-char API boundary", () => {
    expect(() =>
      taskPlanSchema.parse({ ...validPlanFields, objective: "x".repeat(8000) }),
    ).not.toThrow();
  });

  it("accepts an objective in the 4001-8000 range that a 4000-char cap would have rejected", () => {
    expect(() =>
      taskPlanSchema.parse({ ...validPlanFields, objective: "x".repeat(5000) }),
    ).not.toThrow();
  });

  it("still rejects an empty objective", () => {
    expect(() =>
      taskPlanSchema.parse({ ...validPlanFields, objective: "" }),
    ).toThrow();
  });
});

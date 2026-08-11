import {
  simulationResultSchema,
  type SimulationResult,
  type TaskPlan,
} from "@atlas/shared";

/** Dangerous actions cannot execute — only proposed until policy + human. */
export function runSimulation(plan: TaskPlan): SimulationResult {
  const writeAgents = plan.requiredAgents.filter((id) =>
    ["CODE_ENGINEER", "DEBUGGER", "TEST_ENGINEER"].includes(id),
  );
  const critical =
    plan.riskLevel === "CRITICAL" || plan.riskLevel === "HIGH";
  const productionHint = /production|deploy|secret|migrat|prod\b/i.test(
    plan.objective,
  );

  const blockedActions: string[] = [];
  const proposedActions: string[] = [];

  if (writeAgents.length > 0) {
    blockedActions.push("apply_patch");
    blockedActions.push("prod_mutate");
    proposedActions.push("propose_patch_artifact");
    proposedActions.push("second_agent_review");
  }
  if (productionHint) {
    blockedActions.push("deploy");
    proposedActions.push("human_approval_gate");
  }

  const requiresHuman =
    plan.simulationRequired ||
    critical ||
    productionHint ||
    writeAgents.length > 0;

  return simulationResultSchema.parse({
    id: crypto.randomUUID(),
    taskPlanId: plan.id,
    allowed: blockedActions.length === 0,
    blockedActions,
    proposedActions,
    requiresHuman,
    riskLevel: plan.riskLevel,
    rationale: requiresHuman
      ? "Simulation: mutations blocked. Agents may only propose; Judge + policy + human required for dangerous paths."
      : "Simulation: read-only path — specialists may proceed under Evidence Bus.",
    epistemicState: "INFERRED",
  });
}

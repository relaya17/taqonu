import {
  taskPlanSchema,
  type FabricAgentId,
  type TaskPlan,
} from "@atlas/shared";
import { geniusRoute } from "../router/genius.js";
import { getRegisteredAgent } from "./registry.js";

function riskFromRequest(request: string): TaskPlan["riskLevel"] {
  const q = request.toLowerCase();
  if (/production|critical|secret|deploy|rls|auth/.test(q)) return "CRITICAL";
  if (/security|patch|fix|migrat/.test(q)) return "HIGH";
  if (/test|qa|a11y|docs/.test(q)) return "MEDIUM";
  return "LOW";
}

/** Phase 2 — Orchestrator TaskPlan (parallel groups + dependencies). */
export function createTaskPlan(input: {
  request: string;
  projectId?: string | null;
  maxAgents?: number;
  budgetUsd?: number;
}): TaskPlan {
  const route = geniusRoute(input.request);
  const maxAgents = input.maxAgents ?? 5;
  const budgetUsd = input.budgetUsd ?? 2;
  const riskLevel = riskFromRequest(input.request);

  const specialists = route.agentIds
    .filter((id) => id !== "ORCHESTRATOR")
    .slice(0, Math.max(1, maxAgents - 1));

  if (
    !specialists.includes("JUDGE") &&
    (riskLevel === "HIGH" || riskLevel === "CRITICAL")
  ) {
    specialists.push("JUDGE");
  }

  const requiredAgents: FabricAgentId[] = ["ORCHESTRATOR"];
  for (const id of specialists) {
    if (!requiredAgents.includes(id)) {
      requiredAgents.push(id);
    }
  }

  const orchId = "t1_orchestrator";
  const specialistTasks = requiredAgents
    .filter((id) => id !== "ORCHESTRATOR" && id !== "JUDGE")
    .map((agentId, i) => {
      const agent = getRegisteredAgent(agentId);
      return {
        id: `t${i + 2}_${agentId.toLowerCase()}`,
        title: `Specialize: ${agent.name}`,
        agentId,
        dependsOn: [orchId],
        requiredEvidence: agent.capabilities.slice(0, 3),
        parallelGroup: 1,
        estimatedCostUsd: Math.min(
          agent.costBudgetUsd,
          budgetUsd / Math.max(1, requiredAgents.length),
        ),
      };
    });

  const hasJudge = requiredAgents.includes("JUDGE");
  const judgeTask = hasJudge
    ? {
        id: `t${specialistTasks.length + 2}_judge`,
        title: "Judge evidence and decide belief",
        agentId: "JUDGE" as FabricAgentId,
        dependsOn: specialistTasks.map((s) => s.id),
        requiredEvidence: ["specialist_outputs", "evidence_refs"],
        parallelGroup: 2,
        estimatedCostUsd: Math.min(
          getRegisteredAgent("JUDGE").costBudgetUsd,
          budgetUsd / Math.max(1, requiredAgents.length),
        ),
      }
    : null;

  const subtasks = [
    {
      id: orchId,
      title: "Decompose objective and allocate budgets",
      agentId: "ORCHESTRATOR" as FabricAgentId,
      dependsOn: [] as string[],
      requiredEvidence: ["user_request"],
      parallelGroup: 0,
      estimatedCostUsd: 0.02,
    },
    ...specialistTasks,
    ...(judgeTask ? [judgeTask] : []),
  ];

  const dependencies = subtasks.flatMap((s) =>
    s.dependsOn.map((from) => ({ from, to: s.id })),
  );

  const requiredEvidence = [
    ...new Set(subtasks.flatMap((s) => s.requiredEvidence)),
  ];

  const simulationRequired =
    riskLevel === "HIGH" ||
    riskLevel === "CRITICAL" ||
    requiredAgents.some((id) => getRegisteredAgent(id).canWriteCode);

  let total = subtasks.reduce((n, s) => n + s.estimatedCostUsd, 0);
  if (total > budgetUsd && total > 0) {
    const scale = budgetUsd / total;
    for (const s of subtasks) s.estimatedCostUsd *= scale;
    total = budgetUsd;
  }

  return taskPlanSchema.parse({
    id: crypto.randomUUID(),
    objective: input.request,
    projectId: input.projectId ?? null,
    subtasks,
    dependencies,
    requiredAgents: subtasks.map((s) => s.agentId),
    requiredEvidence,
    riskLevel,
    budgetUsd: Number(total.toFixed(4)),
    successCriteria: [
      "All requiredEvidence addressed OR explicit INSUFFICIENT_EVIDENCE",
      "No confident claims from LLM_INFERENCE alone",
      "Judge decision recorded before any mutation",
      simulationRequired
        ? "Simulation blocked apply/deploy until approval"
        : "Read-only path completed under Evidence Bus",
    ],
    simulationRequired,
    modelHint: route.modelHint,
    routerHints: route.hints,
    createdAt: new Date().toISOString(),
    epistemicState: "INFERRED",
  });
}

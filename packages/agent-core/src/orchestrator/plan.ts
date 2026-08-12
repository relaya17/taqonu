import {
  agentPlanSchema,
  FABRIC_AGENT_CATALOG,
  type AgentPlan,
  type FabricAgentId,
} from "@atlas/shared";
import { geniusRoute } from "../router/genius.js";
import { getFabricAgent } from "../registry/catalog.js";

export function planAgentWork(input: {
  request: string;
  projectId?: string | null;
  maxAgents?: number;
  budgetUsd?: number;
  /** Force selected specialists (still wraps with Orchestrator + Judge). */
  agentIds?: FabricAgentId[];
}): AgentPlan {
  const route = geniusRoute(input.request);
  const maxAgents = input.maxAgents ?? 5;
  const budgetUsd = input.budgetUsd ?? 2;

  const forced = (input.agentIds ?? []).filter(
    (id) => id !== "ORCHESTRATOR" && id !== "JUDGE",
  );

  const specialists = (
    forced.length > 0
      ? forced
      : route.agentIds.filter((id) => id !== "ORCHESTRATOR")
  ).slice(0, Math.max(1, maxAgents - 1));

  const steps = [
    {
      agentId: "ORCHESTRATOR" as FabricAgentId,
      rationale: forced.length
        ? `User-selected specialist lane(s): ${forced.join(", ")}`
        : "Decompose request and enforce budgets / isolation",
      requiredEvidence: ["user request"],
      parallelGroup: 0,
      estimatedCostUsd: 0.02,
    },
    ...specialists.map((id, i) => {
      const def = getFabricAgent(id);
      return {
        agentId: id,
        rationale: forced.length
          ? `${def.specialty} — selected specialist`
          : `${def.specialty} — ${route.hints[i] ?? def.title}`,
        requiredEvidence: [...def.evidenceRequirements],
        parallelGroup: id === "JUDGE" ? 2 : 1,
        estimatedCostUsd: Math.min(
          def.maxCostUsd,
          budgetUsd / Math.max(1, specialists.length),
        ),
      };
    }),
  ];

  // Always finish with Judge for multi-specialist or forced lanes
  if (!steps.some((s) => s.agentId === "JUDGE")) {
    const judge = getFabricAgent("JUDGE");
    steps.push({
      agentId: "JUDGE",
      rationale: "Evidence belief check — contradictions / unsupported / unsafe",
      requiredEvidence: [...judge.evidenceRequirements],
      parallelGroup: 2,
      estimatedCostUsd: Math.min(judge.maxCostUsd, 0.15),
    });
  }

  // Ensure JUDGE last if present
  const judgeIdx = steps.findIndex((s) => s.agentId === "JUDGE");
  if (judgeIdx >= 0 && judgeIdx !== steps.length - 1) {
    const [j] = steps.splice(judgeIdx, 1);
    if (j) steps.push({ ...j, parallelGroup: 2 });
  }

  let total = steps.reduce((s, x) => s + x.estimatedCostUsd, 0);
  if (total > budgetUsd) {
    const scale = budgetUsd / total;
    for (const step of steps) step.estimatedCostUsd *= scale;
    total = budgetUsd;
  }

  return agentPlanSchema.parse({
    id: crypto.randomUUID(),
    request: input.request,
    projectId: input.projectId ?? null,
    steps,
    routerHints: [
      `modelHint=${route.modelHint}`,
      ...(forced.length
        ? [`forcedSpecialists=${forced.join(",")}`]
        : route.hints),
      "No agent-to-agent chat — typed Evidence Bus handoffs only",
      `Catalog size ${Object.keys(FABRIC_AGENT_CATALOG).length}`,
    ],
    estimatedTotalCostUsd: Number(total.toFixed(4)),
    createdAt: new Date().toISOString(),
    epistemicState: "INFERRED",
  });
}

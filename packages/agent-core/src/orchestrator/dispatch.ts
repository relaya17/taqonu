import {
  agentDispatchResultSchema,
  agentRunResultSchema,
  type AgentDispatchResult,
  type AgentPlan,
  type AgentRunResult,
  type FabricAgentId,
} from "@atlas/shared";
import { getFabricAgent } from "../registry/catalog.js";
import { planAgentWork } from "./plan.js";
import { evaluateJudge } from "../judge/evaluate.js";

/** Deterministic specialist stub — contracts + evidence requirements, not chat. */
function runSpecialistStub(agentId: FabricAgentId, request: string) {
  const def = getFabricAgent(agentId);
  const started = Date.now();
  const needs = def.evidenceRequirements;
  const hasHint = needs.some((n) =>
    request.toLowerCase().includes(n.split(" ")[0]!.toLowerCase()),
  );

  return agentRunResultSchema.parse({
    agentId,
    status:
      hasHint || agentId === "ORCHESTRATOR" || agentId === "JUDGE"
        ? "COMPLETED"
        : "NEEDS_EVIDENCE",
    summary:
      agentId === "ORCHESTRATOR"
        ? `Planned specialists with isolated contexts for: ${request.slice(0, 160)}`
        : `${def.title} reviewed request under policy (risk=${def.riskLevel}). Tools allowed: ${def.allowedTools.join(", ")}.`,
    claims: [
      `${def.id}: specialty=${def.specialty}`,
      `WRITE=${def.canWriteCode ? "patch-only-gated" : "forbidden"}`,
      `budgetCapUsd=${def.maxCostUsd}`,
    ],
    evidenceRefs: needs.map((n) => `required:${n}`),
    epistemicState:
      agentId === "ORCHESTRATOR"
        ? "INFERRED"
        : hasHint
          ? "INFERRED"
          : "UNVERIFIED",
    costUsd: Number((def.maxCostUsd * 0.05).toFixed(4)),
    durationMs: Math.max(1, Date.now() - started),
  });
}

export function dispatchAgentPlan(input: {
  request: string;
  projectId?: string | null;
  plan?: AgentPlan;
  agentIds?: FabricAgentId[];
  maxAgents?: number;
  budgetUsd?: number;
  runJudge?: boolean;
  /** When set, replaces the stub for that agent (e.g. SECURITY → Sentinel). */
  specialistOverride?: (
    agentId: FabricAgentId,
    request: string,
  ) => AgentRunResult | null | undefined;
}): AgentDispatchResult {
  const plan =
    input.plan ??
    planAgentWork({
      request: input.request,
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      ...(input.maxAgents !== undefined ? { maxAgents: input.maxAgents } : {}),
      ...(input.budgetUsd !== undefined ? { budgetUsd: input.budgetUsd } : {}),
      ...(input.agentIds !== undefined ? { agentIds: input.agentIds } : {}),
    });

  // Plan already honors forced agentIds — run all non-Judge steps in parallel groups
  const selected = plan.steps;

  const byGroup = new Map<number, typeof selected>();
  for (const step of selected) {
    const g = byGroup.get(step.parallelGroup) ?? [];
    g.push(step);
    byGroup.set(step.parallelGroup, g);
  }

  const runs = [...byGroup.keys()]
    .sort((a, b) => a - b)
    .flatMap((g) =>
      (byGroup.get(g) ?? [])
        .filter((s) => s.agentId !== "JUDGE")
        .map((s) => {
          const override = input.specialistOverride?.(s.agentId, input.request);
          return override ?? runSpecialistStub(s.agentId, input.request);
        }),
    );

  const runJudge = input.runJudge !== false;
  const judge = runJudge
    ? evaluateJudge({ runs, request: input.request })
    : null;

  return agentDispatchResultSchema.parse({
    id: crypto.randomUUID(),
    plan,
    runs,
    judge,
    traceId: `trace_${crypto.randomUUID().slice(0, 8)}`,
    createdAt: new Date().toISOString(),
  });
}

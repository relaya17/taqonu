import {
  agentDispatchResultSchema,
  agentRunResultSchema,
  type AgentDispatchResult,
  type AgentPlan,
  type AgentRunResult,
  type FabricAgentId,
  type KnowledgeSearchResult,
} from "@atlas/shared";
import { buildEvidencePackageForAgent } from "@atlas/knowledge";
import { getFabricAgent } from "../registry/catalog.js";
import { planAgentWork } from "./plan.js";
import { evaluateJudge } from "../judge/evaluate.js";

function loadKnowledge(request: string, agentIds: FabricAgentId[]): KnowledgeSearchResult {
  return buildEvidencePackageForAgent({
    query: request,
    agentSpecialtyHints: agentIds.map((id) => getFabricAgent(id).specialty),
    maxItems: 12,
  });
}

/** Specialist run grounded in allow-listed excerpts — not a chat model. */
function runSpecialistStub(
  agentId: FabricAgentId,
  request: string,
  knowledge: KnowledgeSearchResult,
) {
  const def = getFabricAgent(agentId);
  const started = Date.now();
  const needs = def.evidenceRequirements;
  const hasHint = needs.some((n) =>
    request.toLowerCase().includes(n.split(" ")[0]!.toLowerCase()),
  );
  const cites = knowledge.hits.slice(0, 5);
  const citeLine =
    cites.length > 0
      ? ` Official sources: ${cites.map((h) => h.title).join(" · ")}.`
      : " No allow-listed hit — INSUFFICIENT_EVIDENCE until a verified source matches.";

  return agentRunResultSchema.parse({
    agentId,
    status:
      hasHint || agentId === "ORCHESTRATOR" || agentId === "JUDGE" || cites.length > 0
        ? "COMPLETED"
        : "NEEDS_EVIDENCE",
    summary:
      agentId === "ORCHESTRATOR"
        ? `Planned specialists with isolated contexts for: ${request.slice(0, 160)}.${citeLine}`
        : `${def.title} reviewed request under policy (risk=${def.riskLevel}). Tools allowed: ${def.allowedTools.join(", ")}.${citeLine}`,
    claims: [
      `${def.id}: specialty=${def.specialty}`,
      `WRITE=${def.canWriteCode ? "patch-only-gated" : "forbidden"}`,
      `budgetCapUsd=${def.maxCostUsd}`,
      `knowledgeHits=${knowledge.hits.length}`,
      ...cites.map((h) => `cite:${h.title}${h.url ? ` <${h.url}>` : ""}`),
    ],
    evidenceRefs: [
      ...needs.map((n) => `required:${n}`),
      ...cites.map((h) => h.url ?? h.id),
    ],
    epistemicState:
      agentId === "ORCHESTRATOR"
        ? "INFERRED"
        : cites.length > 0
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

  const selected = plan.steps;
  const knowledge = loadKnowledge(
    input.request,
    selected.map((s) => s.agentId),
  );

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
          return override ?? runSpecialistStub(s.agentId, input.request, knowledge);
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
    knowledgePackage: knowledge,
  });
}

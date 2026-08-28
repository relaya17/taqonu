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
    // Real, not synthetic: this stub is a rule-based reviewer over
    // allow-listed knowledge excerpts (see the function doc comment above —
    // "not a chat model"). It never calls an LLM provider
    // (packages/agent-core/src/providers/llm.ts), so there is no token cost
    // to meter — $0 is the accurate figure, not a placeholder. This
    // previously computed a synthetic `def.maxCostUsd * 0.05` estimate that
    // was unrelated to any real spend. Specialists that ARE backed by a real
    // LLM call should thread that call's real `LlmUsage.costUsd` through
    // here instead of 0.
    costUsd: 0,
    durationMs: Math.max(1, Date.now() - started),
  });
}

export async function dispatchAgentPlan(input: {
  request: string;
  projectId?: string | null;
  plan?: AgentPlan;
  agentIds?: FabricAgentId[];
  maxAgents?: number;
  budgetUsd?: number;
  runJudge?: boolean;
  /** When set, replaces the stub for that agent (e.g. SECURITY → Sentinel). May be async. */
  specialistOverride?: (
    agentId: FabricAgentId,
    request: string,
  ) => AgentRunResult | null | undefined | Promise<AgentRunResult | null | undefined>;
}): Promise<AgentDispatchResult> {
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

  const runs: AgentRunResult[] = [];
  for (const g of [...byGroup.keys()].sort((a, b) => a - b)) {
    for (const s of byGroup.get(g) ?? []) {
      if (s.agentId === "JUDGE") continue;
      const override = await input.specialistOverride?.(s.agentId, input.request);
      runs.push(override ?? runSpecialistStub(s.agentId, input.request, knowledge));
    }
  }

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

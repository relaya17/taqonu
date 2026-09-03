import {
  kernelJudgeResultSchema,
  kernelRunResultSchema,
  type KernelRunResult,
  type TaskPlan,
} from "@atlas/shared";
import { buildEvidencePackageForAgent, type KnowledgeRetrievalScope } from "@atlas/knowledge";
import { EvidenceBus } from "./evidence-bus.js";
import { matchLessonsForRequest } from "./memory.js";
import { runSimulation } from "./simulation.js";
import { runSpecialist } from "./specialists.js";
import { createTaskPlan } from "./task-plan.js";
import { getRegisteredAgent } from "./registry.js";

function kernelJudge(input: {
  plan: TaskPlan;
  bus: EvidenceBus;
  request: string;
}): ReturnType<typeof kernelJudgeResultSchema.parse> {
  const items = input.bus.listItems();
  const missing: string[] = [];
  const unsupported: string[] = [];
  const contradictions: string[] = [];

  for (const need of input.plan.requiredEvidence) {
    const hit = items.some(
      (i) =>
        i.claim.toLowerCase().includes(need.slice(0, 12).toLowerCase()) ||
        i.supports.includes(need) ||
        i.source.toLowerCase().includes(need.toLowerCase()),
    );
    if (!hit) missing.push(need);
  }

  for (const item of items) {
    if (item.epistemicState === "INSUFFICIENT_EVIDENCE") {
      unsupported.push(item.claim);
    }
    if (item.sourceType === "LLM_INFERENCE" && item.confidence > 0.7) {
      contradictions.push(
        `LLM_INFERENCE claim with high confidence refused: ${item.claim.slice(0, 80)}`,
      );
    }
  }

  const insuffSpecialists = items.filter(
    (i) => i.epistemicState === "INSUFFICIENT_EVIDENCE",
  ).length;
  const sufficient = input.bus.hasSufficientEvidence(0.4, 1);

  let decision:
    | "APPROVE"
    | "REJECT"
    | "REQUEST_MORE_EVIDENCE"
    | "INSUFFICIENT_EVIDENCE"
    | "ESCALATE_HUMAN" = "APPROVE";
  let confidence = 0.8;

  if (input.request.trim().length < 12) {
    decision = "INSUFFICIENT_EVIDENCE";
    confidence = 0.3;
  } else if (insuffSpecialists > 0 && !sufficient) {
    decision = "INSUFFICIENT_EVIDENCE";
    confidence = 0.35;
  } else if (!sufficient || missing.length > 0) {
    decision =
      missing.length >= Math.max(2, Math.floor(input.plan.requiredEvidence.length * 0.75))
        ? "INSUFFICIENT_EVIDENCE"
        : "REQUEST_MORE_EVIDENCE";
    confidence = 0.45;
  }
  if (contradictions.length > 0) {
    decision = "REJECT";
    confidence = 0.35;
  }
  if (
    input.plan.simulationRequired ||
    /production|critical|secret/.test(input.request.toLowerCase())
  ) {
    if (decision === "APPROVE") decision = "ESCALATE_HUMAN";
    confidence = Math.min(confidence, 0.55);
  }

  return kernelJudgeResultSchema.parse({
    decision,
    confidence,
    contradictions,
    unsupportedClaims: unsupported,
    missingEvidence: missing,
    rationale: [
      `Kernel Judge on ${items.length} evidence items.`,
      `Decision=${decision}.`,
      decision === "INSUFFICIENT_EVIDENCE"
        ? "Atlas refuses confident hallucination."
        : "Belief decision grounded in Evidence Bus.",
    ].join(" "),
    epistemicState:
      decision === "INSUFFICIENT_EVIDENCE"
        ? "INSUFFICIENT_EVIDENCE"
        : decision === "APPROVE"
          ? "INFERRED"
          : "UNVERIFIED",
  });
}

function engineeringLoopBridge(plan: TaskPlan): KernelRunResult["engineeringLoopBridge"] {
  const needsLoop =
    plan.simulationRequired ||
    plan.requiredAgents.some((id) => getRegisteredAgent(id).canWriteCode);
  if (!needsLoop) {
    return {
      recommended: false,
      stages: [],
      note: "Read-only kernel path — engineering loop not required.",
    };
  }
  return {
    recommended: true,
    stages: [
      "PLAN",
      "IMPLEMENT",
      "TEST",
      "SECURITY_REVIEW",
      "EVIDENCE_REVIEW",
      "PATCH",
      "TEST_AGAIN",
      "REGRESSION",
      "APPROVE",
    ],
    note: "Bridge to POST /api/v1/engineering/loop after Judge allows propose_patch (never silent apply).",
  };
}

/** Intelligence Kernel run — Phases 1–7 cohesive path. */
export function runIntelligenceKernel(input: {
  request: string;
  projectId?: string | null;
  maxAgents?: number;
  budgetUsd?: number;
  runSimulation?: boolean;
  runJudge?: boolean;
  securityObservation?: { claims: string[]; evidenceRefs: string[] } | null;
  retrievalScope?: KnowledgeRetrievalScope | null;
}): KernelRunResult {
  const plan = createTaskPlan({
    request: input.request,
    ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
    ...(input.maxAgents !== undefined ? { maxAgents: input.maxAgents } : {}),
    ...(input.budgetUsd !== undefined ? { budgetUsd: input.budgetUsd } : {}),
  });

  const traceId = `kern_${crypto.randomUUID().slice(0, 10)}`;
  const bus = new EvidenceBus(traceId);
  const lessonsApplied = matchLessonsForRequest(input.request);

  // P4 — Knowledge Fabric package (need-based). Skip for ultra-thin prompts.
  const thinPrompt = input.request.trim().length < 12;
  const knowledge = thinPrompt
    ? {
        query: input.request,
        hits: [] as { id: string; title: string; url: string | null; sourceClass: string; authority: number; sourceUpdatedAt: string | null; epistemicState: "OBSERVED" | "INFERRED" }[],
        filteredOut: 0,
      }
    : buildEvidencePackageForAgent({
        query: input.request,
        agentSpecialtyHints: plan.requiredAgents.flatMap((id) =>
          getRegisteredAgent(id).capabilities.slice(0, 2),
        ),
        agentIds: plan.requiredAgents,
        maxItems: 8,
        ...(input.retrievalScope ? { scope: input.retrievalScope } : {}),
      });

  for (const hit of knowledge.hits) {
    bus.publishClaim({
      claim: hit.title,
      source: hit.url ?? hit.id,
      sourceType:
        hit.sourceClass.includes("SECURITY")
          ? "SECURITY_ADVISORY"
          : hit.sourceClass.includes("STANDARD") ||
              hit.sourceClass.includes("GOVERNMENT")
            ? "STANDARD"
            : hit.sourceClass.includes("OFFICIAL")
              ? "OFFICIAL_DOCS"
              : "AGENT_OBSERVATION",
      authorityScore: hit.authority,
      confidence: hit.authority,
      agentId: "RESEARCHER",
      projectId: input.projectId ?? null,
      supports: [hit.id],
      sourceUpdatedAt: hit.sourceUpdatedAt,
      taskPlanId: plan.id,
      epistemicState: hit.epistemicState,
    });
  }

  bus.publishClaim({
    claim: `User objective accepted: ${input.request.slice(0, 240)}`,
    source: "user_request",
    sourceType: "HUMAN",
    authorityScore: 0.85,
    confidence: 0.9,
    agentId: "ORCHESTRATOR",
    projectId: input.projectId ?? null,
    supports: ["user_request"],
    taskPlanId: plan.id,
    epistemicState: "OBSERVED",
  });

  const simulation =
    input.runSimulation === false ? null : runSimulation(plan);

  if (simulation) {
    bus.publish({
      type: "simulation.completed",
      taskPlanId: plan.id,
      agentId: "ORCHESTRATOR",
      payload: {
        allowed: simulation.allowed,
        requiresHuman: simulation.requiresHuman,
        blockedActions: simulation.blockedActions,
      },
    });
  }

  // P5 — Specialists (skip JUDGE here; Judge is P6)
  const summaries: KernelRunResult["specialistSummaries"] = [];
  for (const sub of plan.subtasks) {
    if (sub.agentId === "JUDGE") continue;
    const result = runSpecialist({
      agentId: sub.agentId,
      plan,
      request: input.request,
      bus,
      knowledgeHitIds: knowledge.hits.map((h) => h.id),
      lessons: lessonsApplied,
      projectId: input.projectId ?? null,
      ...(input.securityObservation
        ? { securityObservation: input.securityObservation }
        : {}),
    });
    summaries.push(result);
  }

  const judge =
    input.runJudge !== false
      ? kernelJudge({ plan, bus, request: input.request })
      : null;

  if (judge) {
    bus.publish({
      type: "judge.decided",
      taskPlanId: plan.id,
      agentId: "JUDGE",
      payload: { decision: judge.decision, confidence: judge.confidence },
    });
  }

  return kernelRunResultSchema.parse({
    id: crypto.randomUUID(),
    traceId,
    plan,
    simulation,
    evidenceEvents: bus.listEvents(),
    evidenceItems: bus.listItems(),
    specialistSummaries: summaries,
    judge,
    knowledgePackage: {
      query: knowledge.query,
      hitIds: knowledge.hits.map((h) => h.id),
      filteredOut: knowledge.filteredOut,
    },
    engineeringLoopBridge: engineeringLoopBridge(plan),
    lessonsApplied,
    createdAt: new Date().toISOString(),
  });
}

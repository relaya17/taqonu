import type { EvidenceBus } from "./evidence-bus.js";
import { getRegisteredAgent } from "./registry.js";
import type { FabricAgentId, TaskPlan } from "@atlas/shared";

export interface SpecialistResult {
  agentId: FabricAgentId;
  status:
    | "COMPLETED"
    | "SKIPPED"
    | "FAILED"
    | "NEEDS_EVIDENCE"
    | "INSUFFICIENT_EVIDENCE";
  summary: string;
  evidenceIds: string[];
}

/** P5 — Specialist runtime: isolated context + Evidence Bus only (no chat). */
export function runSpecialist(input: {
  agentId: FabricAgentId;
  plan: TaskPlan;
  request: string;
  bus: EvidenceBus;
  knowledgeHitIds: string[];
  lessons: string[];
  projectId?: string | null;
}): SpecialistResult {
  const agent = getRegisteredAgent(input.agentId);
  const sub = input.plan.subtasks.find((s) => s.agentId === input.agentId);
  const thin = input.request.trim().length < 12;
  const hasPackage = input.knowledgeHitIds.length > 0;

  if (input.agentId === "ORCHESTRATOR") {
    const item = input.bus.publishClaim({
      claim: `Orchestrator allocated ${input.plan.requiredAgents.length} agents; budget $${input.plan.budgetUsd}`,
      source: "kernel:orchestrator",
      sourceType: "AGENT_OBSERVATION",
      authorityScore: 0.7,
      confidence: 0.75,
      agentId: "ORCHESTRATOR",
      projectId: input.projectId ?? null,
      supports: ["user_request"],
      taskPlanId: input.plan.id,
      epistemicState: "INFERRED",
    });
    return {
      agentId: "ORCHESTRATOR",
      status: "COMPLETED",
      summary: "Orchestrator published allocation evidence.",
      evidenceIds: [item.id],
    };
  }

  if (thin && !hasPackage) {
    const item = input.bus.publishClaim({
      claim: `${agent.name}: INSUFFICIENT_EVIDENCE — refusing confident hallucination`,
      source: "kernel_policy",
      sourceType: "AGENT_OBSERVATION",
      authorityScore: 0.05,
      confidence: 0.05,
      agentId: input.agentId,
      projectId: input.projectId ?? null,
      taskPlanId: input.plan.id,
    });
    return {
      agentId: input.agentId,
      status: "INSUFFICIENT_EVIDENCE",
      summary: `${agent.name} returned INSUFFICIENT_EVIDENCE.`,
      evidenceIds: [item.id],
    };
  }

  if (input.agentId === "OMISSION_DETECTOR") {
    const item = input.bus.publishClaim({
      claim: [
        "Omission Detector: ask what nobody requested",
        "Run Engineering Constitution checklist against intent + repo Evidence",
        "Critical example: payments without webhook signature verification",
        `request=${input.request.slice(0, 120)}`,
      ].join(" · "),
      source: "agent:OMISSION_DETECTOR",
      sourceType: "AGENT_OBSERVATION",
      authorityScore: 0.7,
      confidence: 0.72,
      agentId: "OMISSION_DETECTOR",
      projectId: input.projectId ?? null,
      supports: ["constitution_checklist", "user_intent"],
      taskPlanId: input.plan.id,
      epistemicState: "INFERRED",
    });
    return {
      agentId: "OMISSION_DETECTOR",
      status: "COMPLETED",
      summary:
        "Omission Detector published Constitution gap hypotheses to Evidence Bus.",
      evidenceIds: [item.id],
    };
  }

  // Apply portfolio lessons when relevant (no raw project data)
  const matchedLessons = input.lessons.filter((p) =>
    input.request.toLowerCase().includes(p.split("_")[0]!.toLowerCase()) ||
    /webhook|auth|security|idempot/.test(input.request.toLowerCase()),
  );

  const item = input.bus.publishClaim({
    claim: [
      `${agent.name} specialty=${agent.capabilities.slice(0, 3).join(",")}`,
      hasPackage
        ? `evidencePackageHits=${input.knowledgeHitIds.length}`
        : "no_external_package",
      matchedLessons.length
        ? `lessons=${matchedLessons.join(",")}`
        : "no_lesson_match",
      `risk=${agent.riskLevel}`,
      agent.canWriteCode ? "WRITE=propose_patch_only" : "WRITE=forbidden",
    ].join(" · "),
    source: `agent:${input.agentId}`,
    sourceType: "AGENT_OBSERVATION",
    authorityScore: hasPackage ? 0.65 : 0.45,
    confidence: hasPackage ? 0.7 : 0.5,
    agentId: input.agentId,
    projectId: input.projectId ?? null,
    supports: [
      ...(sub?.requiredEvidence ?? []),
      ...input.knowledgeHitIds.slice(0, 5),
    ],
    taskPlanId: input.plan.id,
    epistemicState: hasPackage ? "INFERRED" : "UNVERIFIED",
  });

  input.bus.publish({
    type: "handoff.completed",
    taskPlanId: input.plan.id,
    agentId: input.agentId,
    evidence: [item],
    payload: {
      subtaskId: sub?.id ?? null,
      knowledgeHitIds: input.knowledgeHitIds,
    },
  });

  return {
    agentId: input.agentId,
    status: hasPackage || !thin ? "COMPLETED" : "NEEDS_EVIDENCE",
    summary: `${agent.name}: published to Evidence Bus (isolated).`,
    evidenceIds: [item.id],
  };
}

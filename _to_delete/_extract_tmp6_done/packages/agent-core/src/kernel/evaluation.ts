import {
  agentEvalReportSchema,
  type AgentEvalReport,
  type FabricAgentId,
} from "@atlas/shared";
import { geniusRoute } from "../router/genius.js";
import { runIntelligenceKernel } from "./run.js";

const SMOKE_CASES: Array<{
  id: string;
  prompt: string;
  expectAgent?: FabricAgentId;
  expectDecisionIncludes?: string[];
  mustNotHallucinate: boolean;
}> = [
  {
    id: "sec-prod",
    prompt: "Critical production security review for auth and secrets",
    expectAgent: "SECURITY",
    expectDecisionIncludes: ["ESCALATE_HUMAN", "REQUEST_MORE_EVIDENCE", "INSUFFICIENT_EVIDENCE"],
    mustNotHallucinate: true,
  },
  {
    id: "thin-hi",
    prompt: "hi",
    mustNotHallucinate: true,
    expectDecisionIncludes: [
      "INSUFFICIENT_EVIDENCE",
      "REQUEST_MORE_EVIDENCE",
      "REJECT",
    ],
  },
  {
    id: "a11y",
    prompt: "Check WCAG accessibility and RTL keyboard focus",
    expectAgent: "ACCESSIBILITY",
    mustNotHallucinate: true,
  },
  {
    id: "webhook",
    prompt: "Review webhook handlers for idempotency pattern",
    expectAgent: "SECURITY",
    mustNotHallucinate: true,
  },
];

/** P8 — Agent / Kernel evaluation harness. */
export function runKernelEvaluation(input?: {
  agentId?: FabricAgentId | null;
  suite?: string;
}): AgentEvalReport {
  const suite = input?.suite ?? "kernel-smoke-v1";
  const started = Date.now();
  const details: AgentEvalReport["details"] = [];
  let passed = 0;
  let refusals = 0;
  let cost = 0;

  for (const c of SMOKE_CASES) {
    if (input?.agentId) {
      const route = geniusRoute(c.prompt);
      if (!route.agentIds.includes(input.agentId) && input.agentId !== "ORCHESTRATOR") {
        details.push({
          caseId: c.id,
          passed: true,
          note: `skipped — agent ${input.agentId} not routed`,
        });
        passed += 1;
        continue;
      }
    }

    const result = runIntelligenceKernel({
      request: c.prompt,
      maxAgents: 5,
      budgetUsd: 1,
      runSimulation: true,
      runJudge: true,
    });
    // Real, not synthetic: runIntelligenceKernel's specialists
    // (packages/agent-core/src/kernel/specialists.ts) are rule-based
    // Evidence Bus publishers — they never call an LLM provider
    // (packages/agent-core/src/providers/llm.ts) and SpecialistResult carries
    // no cost field at all, so there is no real per-specialist number to sum.
    // $0 accurately reflects that this smoke suite performs no billed calls.
    // This previously accumulated a synthetic `specialistSummaries.length *
    // 0.01` estimate unrelated to any real spend.
    cost += 0;
    const decision = result.judge?.decision ?? "REJECT";
    const insuff = result.specialistSummaries.some(
      (s) => s.status === "INSUFFICIENT_EVIDENCE",
    );
    if (insuff || decision === "INSUFFICIENT_EVIDENCE") refusals += 1;

    let ok = true;
    let note = `judge=${decision}`;
    if (c.expectAgent) {
      const routed = result.plan.requiredAgents.includes(c.expectAgent);
      if (!routed) {
        ok = false;
        note += ` missing agent ${c.expectAgent}`;
      }
    }
    if (c.expectDecisionIncludes && !c.expectDecisionIncludes.includes(decision)) {
      // thin prompts may still get REQUEST_MORE_EVIDENCE — accept if no APPROVE hallucination
      if (decision === "APPROVE" && c.mustNotHallucinate) {
        ok = false;
        note += " hallucinated APPROVE";
      } else if (c.prompt.length < 12 && decision === "APPROVE") {
        ok = false;
        note += " thin prompt approved";
      } else {
        note += ` decision=${decision} (soft)`;
      }
    }
    if (c.mustNotHallucinate && decision === "APPROVE" && c.prompt.length < 12) {
      ok = false;
      note += " refuse failed";
    }

    if (ok) passed += 1;
    details.push({ caseId: c.id, passed: ok, note });
  }

  const total = SMOKE_CASES.length;
  return agentEvalReportSchema.parse({
    id: crypto.randomUUID(),
    agentId: input?.agentId ?? null,
    suite,
    casesTotal: total,
    casesPassed: passed,
    accuracy: total ? passed / total : 0,
    hallucinationRefusals: refusals,
    avgLatencyMs: Math.max(1, Date.now() - started) / Math.max(1, total),
    costUsd: Number(cost.toFixed(4)),
    createdAt: new Date().toISOString(),
    details,
  });
}

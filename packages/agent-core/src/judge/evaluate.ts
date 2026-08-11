import {
  judgeResultSchema,
  type AgentRunResult,
  type JudgeResult,
} from "@atlas/shared";

type Run = {
  agentId: string;
  status: string;
  claims: string[];
  evidenceRefs: string[];
  epistemicState: string;
};

/** Judge: belief decision — never writes code (ADR-017). */
export function evaluateJudge(input: {
  runs: readonly Run[] | readonly AgentRunResult[];
  request?: string;
}): JudgeResult {
  const contradictions: string[] = [];
  const unsupported: string[] = [];
  const missing: string[] = [];

  for (const run of input.runs) {
    if (run.status === "NEEDS_EVIDENCE" || run.status === "FAILED") {
      missing.push(`${run.agentId}: ${run.status}`);
    }
    if (run.epistemicState === "UNVERIFIED" || run.epistemicState === "ASSUMED") {
      unsupported.push(
        `${run.agentId} produced ${run.epistemicState} claims without verified evidence`,
      );
    }
    if (run.evidenceRefs.length === 0 && run.agentId !== "ORCHESTRATOR") {
      missing.push(`${run.agentId}: empty evidenceRefs`);
    }
  }

  const writeAgents = input.runs.filter((r) =>
    ["CODE_ENGINEER", "DEBUGGER", "TEST_ENGINEER"].includes(r.agentId),
  );
  if (writeAgents.length > 0 && missing.length > 0) {
    contradictions.push(
      "Write-capable specialists ran while required evidence is incomplete",
    );
  }

  let decision: JudgeResult["decision"] = "APPROVE";
  let confidence = 0.82;
  if (missing.length > 0) {
    decision = "REQUEST_MORE_EVIDENCE";
    confidence = 0.55;
  }
  if (unsupported.length >= 3) {
    decision = "REJECT";
    confidence = 0.4;
  }
  if (
    /production|critical|release|secre/.test((input.request ?? "").toLowerCase()) &&
    (missing.length > 0 || writeAgents.length > 0)
  ) {
    decision = "ESCALATE_HUMAN";
    confidence = Math.min(confidence, 0.5);
  }

  return judgeResultSchema.parse({
    decision,
    confidence,
    contradictions,
    unsupportedClaims: unsupported,
    missingEvidence: missing,
    rationale: [
      `Judge reviewed ${input.runs.length} specialist outputs.`,
      `Decision=${decision}.`,
      "Agents are roles with policies — not a multi-LLM chat room.",
    ].join(" "),
    epistemicState: decision === "APPROVE" ? "INFERRED" : "UNVERIFIED",
  });
}

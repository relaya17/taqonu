import { describe, expect, it } from "vitest";
import { evaluateJudge } from "./evaluate.js";

const baseRun = {
  agentId: "ARCHITECT",
  status: "COMPLETED",
  claims: ["c1"],
  evidenceRefs: ["e1"],
  epistemicState: "INFERRED",
};

describe("evaluateJudge", () => {
  it("approves when every run completed with evidence and no unverified claims", () => {
    const result = evaluateJudge({ runs: [baseRun] });
    expect(result.decision).toBe("APPROVE");
    expect(result.missingEvidence).toEqual([]);
  });

  it("requests more evidence when a run has empty evidenceRefs (non-orchestrator)", () => {
    const result = evaluateJudge({
      runs: [{ ...baseRun, evidenceRefs: [] }],
    });
    expect(result.decision).toBe("REQUEST_MORE_EVIDENCE");
    expect(result.missingEvidence.length).toBeGreaterThan(0);
  });

  it("does not penalize ORCHESTRATOR for empty evidenceRefs", () => {
    const result = evaluateJudge({
      runs: [{ ...baseRun, agentId: "ORCHESTRATOR", evidenceRefs: [] }],
    });
    expect(result.decision).toBe("APPROVE");
  });

  it("rejects when 3+ runs produced UNVERIFIED/ASSUMED claims", () => {
    const unverified = { ...baseRun, epistemicState: "UNVERIFIED" };
    const result = evaluateJudge({
      runs: [unverified, unverified, unverified],
    });
    expect(result.decision).toBe("REJECT");
  });

  it("flags a contradiction when write-capable agents ran with missing evidence", () => {
    const result = evaluateJudge({
      runs: [
        { ...baseRun, agentId: "CODE_ENGINEER", evidenceRefs: [] },
      ],
    });
    expect(result.contradictions.length).toBeGreaterThan(0);
  });

  it("escalates to a human for production/critical/secret-flavored requests with missing evidence", () => {
    const result = evaluateJudge({
      runs: [{ ...baseRun, evidenceRefs: [] }],
      request: "critical production secret rotation",
    });
    expect(result.decision).toBe("ESCALATE_HUMAN");
    expect(result.confidence).toBeLessThanOrEqual(0.5);
  });

  it("does not escalate for a clean, fully-evidenced production request", () => {
    const result = evaluateJudge({
      runs: [baseRun],
      request: "production release checklist",
    });
    expect(result.decision).toBe("APPROVE");
  });
});

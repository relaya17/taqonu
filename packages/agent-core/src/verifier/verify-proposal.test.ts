import { describe, expect, it } from "vitest";
import type { AgentProposal, EvidenceRecord, SourceAuthorityRank } from "@atlas/shared";
import {
  DEFAULT_PROPOSAL_CHECKS,
  verifyProposal,
  type ProposalVerificationCheck,
} from "./verify-proposal.js";

const UUID_A = "00000000-0000-4000-8000-000000000001";
const UUID_B = "00000000-0000-4000-8000-000000000002";
const UUID_C = "00000000-0000-4000-8000-000000000003";

function evidence(
  authorityRank: SourceAuthorityRank,
  overrides: Partial<EvidenceRecord> = {},
): EvidenceRecord {
  return {
    id: UUID_C,
    ownerId: UUID_A,
    projectId: null,
    source: "ci:build-1",
    sourceType: "CI",
    sourceId: "build-1",
    uri: null,
    excerpt: "typecheck passed",
    version: null,
    observedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    confidence: 0.9,
    epistemicState: "OBSERVED",
    category: "CODE",
    classification: "INTERNAL",
    authorityRank,
    metadata: {},
    ...overrides,
  } as EvidenceRecord;
}

function proposal(overrides: Partial<AgentProposal> = {}): AgentProposal {
  return {
    agentId: "CODE_ENGINEER",
    taskId: UUID_B,
    projectId: null,
    action: { entityType: "RECORD", action: "CREATE" },
    inputs: {},
    claims: ["The typecheck failure originates in universal-filter.ts."],
    evidence: [evidence("CI_ARTIFACT")],
    confidence: 0.7,
    rationale: "CI output points at a single file.",
    ...overrides,
  } as AgentProposal;
}

describe("verifyProposal — the three-verdict contract", () => {
  it("returns VERIFIED when every check passes", () => {
    const result = verifyProposal(proposal());
    expect(result.verdict).toBe("VERIFIED");
    expect(result.epistemicState).toBe("VERIFIED");
    expect(result.checks).toHaveLength(DEFAULT_PROPOSAL_CHECKS.length);
  });

  it("returns INCONCLUSIVE — never VERIFIED — when no check runs at all", () => {
    // The single most important property in this file: a proposal nothing
    // could evaluate must not be laundered into apparent proof.
    const result = verifyProposal(proposal(), {
      useDefaults: false,
      additionalChecks: [],
    });
    expect(result.verdict).toBe("INCONCLUSIVE");
    expect(result.epistemicState).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.checks).toEqual([]);
    expect(result.rationale).toContain("Absence of a check is not a pass");
  });

  it("a single FAILED dominates any number of passing checks", () => {
    const alwaysPasses: ProposalVerificationCheck[] = Array.from({ length: 9 }, (_, i) => ({
      id: `pass-${i}`,
      description: "always passes",
      run: () => ({ checkId: `pass-${i}`, verdict: "VERIFIED" as const, detail: "ok" }),
    }));
    const oneFails: ProposalVerificationCheck = {
      id: "hard-fail",
      description: "always fails",
      run: () => ({ checkId: "hard-fail", verdict: "FAILED" as const, detail: "defect" }),
    };

    const result = verifyProposal(proposal(), {
      useDefaults: false,
      additionalChecks: [...alwaysPasses, oneFails],
    });

    // 9 passes vs 1 failure is still a failure — verification is not a score.
    expect(result.verdict).toBe("FAILED");
    expect(result.epistemicState).toBe("CONTRADICTED");
    expect(result.rationale).toContain("hard-fail");
  });

  it("INCONCLUSIVE does not silently become VERIFIED when other checks pass", () => {
    const result = verifyProposal(
      proposal({ evidence: [evidence("DEVELOPER_STATEMENT")], confidence: 0.5 }),
    );
    expect(result.verdict).toBe("INCONCLUSIVE");
    expect(result.rationale).toContain("not the same as verification");
  });
});

describe("verifyProposal — built-in checks", () => {
  it("is INCONCLUSIVE — not FAILED — when evidence is only the model's own inference", () => {
    // Absence of external evidence is not proof of a defect, and a FAILED
    // here would deny every real LLM proposal (they are all LLM_INFERENCE),
    // making the verifier useless. See the check's doc comment.
    const result = verifyProposal(
      proposal({ evidence: [evidence("LLM_INFERENCE")], confidence: 0.5 }),
    );
    expect(result.verdict).toBe("INCONCLUSIVE");
    expect(
      result.checks.find((c) => c.checkId === "evidence-not-self-referential")?.verdict,
    ).toBe("INCONCLUSIVE");
  });

  it("still FAILS inference-only evidence when confidence is overclaimed on top of it", () => {
    const result = verifyProposal(
      proposal({ evidence: [evidence("LLM_INFERENCE")], confidence: 0.95 }),
    );
    expect(result.verdict).toBe("FAILED");
  });

  it("accepts inference evidence when it is not the ONLY evidence", () => {
    const result = verifyProposal(
      proposal({ evidence: [evidence("LLM_INFERENCE"), evidence("CI_ARTIFACT")] }),
    );
    expect(
      result.checks.find((c) => c.checkId === "evidence-not-self-referential")?.verdict,
    ).toBe("VERIFIED");
  });

  it("FAILS overclaimed confidence — 'says 90%' is not 'earned 90%'", () => {
    const result = verifyProposal(
      proposal({ evidence: [evidence("DEVELOPER_STATEMENT")], confidence: 0.95 }),
    );
    expect(result.verdict).toBe("FAILED");
    const check = result.checks.find(
      (c) => c.checkId === "confidence-supported-by-authority",
    );
    expect(check?.verdict).toBe("FAILED");
    expect(check?.detail).toContain("claimed, not earned");
  });

  it("allows high confidence when it IS backed by executed evidence", () => {
    const result = verifyProposal(
      proposal({ evidence: [evidence("AUTOMATED_VERIFIED_TEST")], confidence: 0.95 }),
    );
    expect(result.verdict).toBe("VERIFIED");
  });

  it("allows modest confidence on assertion-only evidence (weak is not false)", () => {
    const result = verifyProposal(
      proposal({ evidence: [evidence("DEVELOPER_STATEMENT")], confidence: 0.4 }),
    );
    expect(
      result.checks.find((c) => c.checkId === "confidence-supported-by-authority")?.verdict,
    ).toBe("VERIFIED");
    // ...but it still cannot be positively verified.
    expect(result.verdict).toBe("INCONCLUSIVE");
  });

  it("FAILS a proposal carrying a secret in its claims", () => {
    const result = verifyProposal(
      proposal({ claims: ["Found key AKIAIOSFODNN7EXAMPLE in the config."] }),
    );
    expect(result.verdict).toBe("FAILED");
    expect(result.checks.find((c) => c.checkId === "no-secrets-in-proposal")?.verdict).toBe(
      "FAILED",
    );
  });

  it("treats CI_ARTIFACT as the weakest still-executed authority (boundary)", () => {
    expect(
      verifyProposal(proposal({ evidence: [evidence("CI_ARTIFACT")] })).verdict,
    ).toBe("VERIFIED");
    expect(
      verifyProposal(proposal({ evidence: [evidence("REPOSITORY_CODE")] })).verdict,
    ).toBe("INCONCLUSIVE");
  });
});

describe("verifyProposal — extensibility seam for the future Tool Runtime", () => {
  it("runs an additional tool-backed check alongside the built-ins", () => {
    // Stands in for a future `run_typecheck` check.
    const toolCheck: ProposalVerificationCheck = {
      id: "run_typecheck",
      description: "typecheck the proposed patch",
      run: () => ({
        checkId: "run_typecheck",
        verdict: "FAILED" as const,
        detail: "tsc exited 1",
      }),
    };
    const result = verifyProposal(proposal(), { additionalChecks: [toolCheck] });
    expect(result.verdict).toBe("FAILED");
    expect(result.checks).toHaveLength(DEFAULT_PROPOSAL_CHECKS.length + 1);
  });
});

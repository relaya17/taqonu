import { describe, expect, it } from "vitest";
import { draftTruthFindingRemediation } from "./truth-remediation.js";

describe("draftTruthFindingRemediation", () => {
  it("creates LOW draft eligible for gated auto-apply", () => {
    const draft = draftTruthFindingRemediation({
      projectId: null,
      workspaceRoot: "/tmp/ws",
      finding: {
        id: "production-intelligence",
        title: "Production coverage",
        detail: "Missing metrics probe",
        riskBand: "LOW",
        evidenceRefs: ["metrics:MISSING"],
      },
    });
    expect(draft).toBeTruthy();
    expect(draft!.patch.title.startsWith("TRUTH_FIX:")).toBe(true);
    expect(draft!.patch.risk).toBe("LOW");
    expect(draft!.autoApplyEligible).toBe(true);
    expect(draft!.applyBlocked).toBe(false);
    expect(draft!.patch.createdBy).toBe("atlas-truth-remediation");
  });

  it("blocks apply for HIGH findings", () => {
    const draft = draftTruthFindingRemediation({
      projectId: null,
      workspaceRoot: "/tmp/ws",
      finding: {
        id: "behavior-x",
        title: "Payment after confirm",
        detail: "Order flipped",
        riskBand: "HIGH",
      },
    });
    expect(draft!.applyBlocked).toBe(true);
    expect(draft!.autoApplyEligible).toBe(false);
    expect(draft!.patch.risk).toBe("HIGH");
  });

  it("skips when draft already open for finding", () => {
    const draft = draftTruthFindingRemediation({
      projectId: null,
      workspaceRoot: "/tmp/ws",
      finding: {
        id: "behavior-x",
        title: "x",
        detail: "d",
        riskBand: "MEDIUM",
      },
      existingSourceIssueIds: new Set(["behavior-x"]),
    });
    expect(draft).toBeNull();
  });
});

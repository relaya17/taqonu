import { describe, expect, it } from "vitest";
import { assessEvidenceSufficiency, memoryEpistemicAfterAction } from "./evidence-sufficiency.js";

describe("assessEvidenceSufficiency", () => {
  it("lets inspect continue with no prior evidence — gathering is not concluding", () => {
    const result = assessEvidenceSufficiency({ evidenceCount: 0, mutation: false });
    expect(result.decision).toBe("CONTINUE");
  });

  it("does not let a mutation conclude FACT without bound evidence", () => {
    const result = assessEvidenceSufficiency({
      evidenceCount: 0,
      mutation: true,
      claimedState: "FACT",
    });
    expect(result.decision).toBe("INCONCLUSIVE");
  });

  it("halts a mutation when evidence conflicts", () => {
    const result = assessEvidenceSufficiency({
      evidenceCount: 2,
      mutation: true,
      conflicting: true,
    });
    expect(result.decision).toBe("HALT");
  });

  it("halts a mutation when conflicting claim ids are bound", () => {
    const result = assessEvidenceSufficiency({
      evidenceCount: 0,
      mutation: true,
      conflictingClaimIds: ["claim-a"],
    });
    expect(result.decision).toBe("HALT");
  });

  it("treats bound evidence ids as present without calling that VERIFIED", () => {
    const result = assessEvidenceSufficiency({
      evidenceCount: 0,
      boundEvidenceIds: ["ev-1"],
      mutation: true,
      claimedState: "VERIFIED",
    });
    expect(result.decision).toBe("CONTINUE");
  });

  it("continues when non-conflicting evidence exists without calling that VERIFIED", () => {
    const result = assessEvidenceSufficiency({
      evidenceCount: 2,
      mutation: true,
      claimedState: "VERIFIED",
    });
    expect(result.decision).toBe("CONTINUE");
    expect(result.reason).not.toMatch(/VERIFIED verdict/i);
  });

  it("records an execution result as OBSERVED, never FACT", () => {
    expect(memoryEpistemicAfterAction()).toBe("OBSERVED");
  });
});

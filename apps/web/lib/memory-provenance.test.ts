import { describe, expect, it } from "vitest";
import { memoryEvidenceCount, memoryProvenanceLine } from "./memory-provenance";

describe("memoryProvenanceLine", () => {
  it("surfaces source, evidence count, confidence, and verifier", () => {
    const line = memoryProvenanceLine({
      sourceType: "USER",
      source: "dashboard",
      confidence: 0.4,
      evidence: [{ id: "1" }, { id: "2" }],
      verifiedBy: "owner-1",
    });
    expect(line).toEqual({
      sourceType: "USER",
      source: "dashboard",
      evidenceCount: 2,
      confidence: 0.4,
      verified: true,
    });
    expect(memoryEvidenceCount({ evidence: [] })).toBe(0);
  });

  it("does not invent a source when the row has none", () => {
    const line = memoryProvenanceLine({});
    expect(line.sourceType).toBe("UNKNOWN");
    expect(line.source).toBe("—");
    expect(line.verified).toBe(false);
    expect(line.evidenceCount).toBe(0);
  });
});

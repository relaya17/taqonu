import { describe, expect, it } from "vitest";
import { createClaimSchema, createEvidenceRecordSchema } from "./evidence.schema.js";
import { isWriteGateOpen } from "./evaluation.schema.js";

describe("evidence + claim contracts", () => {
  it("requires epistemic labeling on claims", () => {
    const claim = createClaimSchema.parse({
      statement: "Zod is the API contract source of truth",
      epistemicState: "CONFIRMED",
      evidenceIds: ["11111111-1111-4111-8111-111111111111"],
      confidence: 0.95,
    });
    expect(claim.epistemicState).toBe("CONFIRMED");
  });

  it("records FACT evidence from GitHub", () => {
    const evidence = createEvidenceRecordSchema.parse({
      source: "github:brokeros@main:README.md",
      sourceType: "REPOSITORY_FILE",
      epistemicState: "FACT",
      excerpt: "# BrokerOS",
      version: "abc1234",
    });
    expect(evidence.epistemicState).toBe("FACT");
  });
});

describe("write gate", () => {
  it("stays closed until all required eval dimensions pass", () => {
    expect(
      isWriteGateOpen(
        [
          { dimension: "ACCURACY", score: 0.9, passed: true, notes: null },
          { dimension: "SECURITY", score: 0.5, passed: false, notes: "fail" },
        ],
        ["ACCURACY", "SECURITY"],
      ),
    ).toBe(false);
  });
});

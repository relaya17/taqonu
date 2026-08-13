import { describe, expect, it } from "vitest";
import type { ObserverFinding } from "@atlas/shared";
import { selectTopTruthFinding, isTruthPriorityFinding } from "./top.js";

function finding(
  partial: Partial<ObserverFinding> & Pick<ObserverFinding, "id" | "title">,
): ObserverFinding {
  return {
    detail: "",
    claim: "INFERRED",
    epistemicState: "INFERRED",
    riskBand: "MEDIUM",
    category: "BEHAVIOR",
    ...partial,
  };
}

describe("selectTopTruthFinding", () => {
  it("prefers HIGH ADR conflict over MEDIUM behavior", () => {
    const top = selectTopTruthFinding([
      finding({
        id: "behavior-x-STEP",
        title: "step change",
        riskBand: "MEDIUM",
      }),
      finding({
        id: "adr-conflict-docs/adr.md-flow",
        title: "ADR conflict",
        riskBand: "HIGH",
      }),
      finding({
        id: "expected-model",
        title: "noise",
        riskBand: "HIGH",
        category: "BEHAVIOR",
      }),
    ]);
    expect(top?.id.startsWith("adr-conflict-")).toBe(true);
  });

  it("includes MEDIUM security-graph and production coverage", () => {
    expect(
      isTruthPriorityFinding({
        id: "security-graph",
        category: "GENOME",
        riskBand: "MEDIUM",
      }),
    ).toBe(true);
    expect(
      isTruthPriorityFinding({
        id: "production-intelligence",
        category: "GENOME",
        riskBand: "LOW",
      }),
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  recommendFromVerificationHistory,
  scoreHistoricalOutcomes,
} from "./verification-learning.js";

describe("recommendFromVerificationHistory", () => {
  it("never marks lessons as executable or auto-apply", () => {
    const report = recommendFromVerificationHistory([
      { verificationVerdict: "FAILED", result: "SUCCESS" },
    ]);
    expect(report.failedVerification).toBe(1);
    expect(report.lessons.every((lesson) => lesson.executes === false)).toBe(true);
    expect(report.lessons.every((lesson) => lesson.autoApply === false)).toBe(true);
  });

  it("recommends from regression FAILED without mutating governance", () => {
    const report = recommendFromVerificationHistory([
      { verificationVerdict: "VERIFIED", regressionVerdict: "FAILED" },
    ]);
    expect(report.regressionFailed).toBe(1);
    expect(report.lessons.some((lesson) => lesson.title.includes("Regression"))).toBe(true);
  });
});

describe("scoreHistoricalOutcomes", () => {
  it("never grants privileges or mutates governance", () => {
    const report = scoreHistoricalOutcomes([
      { result: "SUCCESS", verificationVerdict: "INCONCLUSIVE", agentId: "RESEARCHER" },
      { result: "FAILURE", verificationVerdict: "FAILED", agentId: "RESEARCHER" },
    ]);
    expect(report.executes).toBe(false);
    expect(report.autoApply).toBe(false);
    expect(report.mutatesGovernance).toBe(false);
    expect(report.successRate).toBe(0.5);
    expect(report.recommendation).toMatch(/Do not auto-approve/);
  });
});

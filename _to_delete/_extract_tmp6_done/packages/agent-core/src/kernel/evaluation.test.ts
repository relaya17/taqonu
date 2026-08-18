import { describe, expect, it } from "vitest";
import { runKernelEvaluation } from "./evaluation.js";

describe("runKernelEvaluation (P8 smoke suite)", () => {
  it("runs the full kernel-smoke-v1 suite and returns a well-formed report", () => {
    const report = runKernelEvaluation();
    expect(report.suite).toBe("kernel-smoke-v1");
    expect(report.casesTotal).toBeGreaterThan(0);
    expect(report.details).toHaveLength(report.casesTotal);
    expect(report.accuracy).toBeGreaterThanOrEqual(0);
    expect(report.accuracy).toBeLessThanOrEqual(1);
  });

  it("never lets a thin ('hi') prompt hallucinate an APPROVE decision", () => {
    const report = runKernelEvaluation();
    const thin = report.details.find((d) => d.caseId === "thin-hi");
    expect(thin?.passed).toBe(true);
  });

  it("accepts a custom suite label", () => {
    const report = runKernelEvaluation({ suite: "custom-suite" });
    expect(report.suite).toBe("custom-suite");
  });

  it("reports real (not synthetic) zero cost — the smoke suite's specialists never call an LLM provider", () => {
    const report = runKernelEvaluation();
    expect(report.costUsd).toBe(0);
  });

  it("skips cases not routed to a filtered agentId (still counts as passed)", () => {
    const report = runKernelEvaluation({ agentId: "LEGAL_MEDIA_COMMS" });
    expect(report.casesPassed).toBe(report.casesTotal);
    expect(
      report.details.every((d) => d.passed || d.note.includes("skipped")),
    ).toBe(true);
  });
});

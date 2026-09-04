import { describe, expect, it } from "vitest";
import {
  assessRegression,
  captureExpectedState,
  compareExpectedActual,
  composeLoopVerdict,
  evaluateWorldState,
  verificationVerdictFromOutcome,
} from "./verification.js";

describe("verificationVerdictFromOutcome", () => {
  it("does not treat executed as verified", () => {
    expect(
      verificationVerdictFromOutcome({
        stage: "EXECUTION",
        status: "EXECUTED",
        artifactHash: "abc",
        output: "ok",
      }),
    ).toBe("INCONCLUSIVE");
  });

  it("marks runtime failures as FAILED", () => {
    expect(
      verificationVerdictFromOutcome({
        stage: "EXECUTION",
        status: "FAILED",
        reason: "timeout",
      }),
    ).toBe("FAILED");
  });

  it("marks authorization and approval stops as BLOCKED", () => {
    expect(
      verificationVerdictFromOutcome({
        stage: "AUTHORIZATION",
        status: "DENIED",
        reason: "catalog",
      }),
    ).toBe("BLOCKED");
    expect(
      verificationVerdictFromOutcome({
        stage: "POLICY",
        status: "APPROVAL_REQUIRED",
        reason: "need sign-off",
      }),
    ).toBe("BLOCKED");
  });
});

describe("compareExpectedActual", () => {
  const expected = captureExpectedState({
    artifactHash: "aaa",
    toolName: "analyze_repo",
  });

  it("stays INCONCLUSIVE when executed without bound expected observations", () => {
    const result = compareExpectedActual(expected, {
      artifactHash: "aaa",
      toolName: "analyze_repo",
      executed: true,
      output: "tool returned success",
    });
    expect(result.verdict).toBe("INCONCLUSIVE");
  });

  it("VERIFIES only when expected observations match actual output", () => {
    const bound = captureExpectedState({
      artifactHash: "aaa",
      toolName: "analyze_repo",
      expectedObservations: ["3 TypeScript files"],
    });
    expect(
      compareExpectedActual(bound, {
        artifactHash: "aaa",
        toolName: "analyze_repo",
        executed: true,
        output: "observation: 3 TypeScript files",
      }).verdict,
    ).toBe("VERIFIED");
  });

  it("FAILS when the artifact hash diverges", () => {
    expect(
      compareExpectedActual(expected, {
        artifactHash: "bbb",
        toolName: "analyze_repo",
        executed: true,
        output: "ok",
      }).verdict,
    ).toBe("FAILED");
  });
});

describe("assessRegression", () => {
  it("is INCONCLUSIVE without a baseline — not a pass", () => {
    expect(
      assessRegression({
        baselineObservations: [],
        actualOutput: "ok",
        executed: true,
      }).verdict,
    ).toBe("INCONCLUSIVE");
  });

  it("FAILS when a prior observation is missing after mutation", () => {
    expect(
      assessRegression({
        baselineObservations: ["login still works"],
        actualOutput: "patched checkout",
        executed: true,
      }).verdict,
    ).toBe("FAILED");
  });

  it("does not treat preserved baseline as VERIFIED", () => {
    expect(
      assessRegression({
        baselineObservations: ["login still works"],
        actualOutput: "patched checkout; login still works",
        executed: true,
      }).verdict,
    ).toBe("INCONCLUSIVE");
  });
});

describe("evaluateWorldState", () => {
  const expected = captureExpectedState({
    artifactHash: "abc",
    toolName: "knowledge_search",
    expectedObservations: ["answer = 42"],
  });

  it("stops at AUTHORIZED when the action was not authorized", () => {
    const result = evaluateWorldState({
      intended: true,
      authorized: false,
      expected,
      actual: {
        artifactHash: "abc",
        toolName: "knowledge_search",
        executed: false,
        output: "",
      },
    });
    expect(result.stageReached).toBe("AUTHORIZED");
    expect(result.loopVerdict).toBe("BLOCKED");
  });

  it("reaches EXECUTED but not VERIFIED when execution has no bound observations", () => {
    const result = evaluateWorldState({
      intended: true,
      authorized: true,
      expected: captureExpectedState({
        artifactHash: "abc",
        toolName: "knowledge_search",
      }),
      actual: {
        artifactHash: "abc",
        toolName: "knowledge_search",
        executed: true,
        output: "ok",
      },
    });
    expect(result.stageReached).toBe("EXECUTED");
    expect(result.loopVerdict).toBe("INCONCLUSIVE");
  });

  it("reaches VERIFIED only when expected observations match and regression does not fail", () => {
    const result = evaluateWorldState({
      intended: true,
      authorized: true,
      expected,
      actual: {
        artifactHash: "abc",
        toolName: "knowledge_search",
        executed: true,
        output: "observation: answer = 42",
      },
      baselineObservations: ["answer = 42"],
    });
    expect(result.stageReached).toBe("VERIFIED");
    expect(result.loopVerdict).toBe("VERIFIED");
  });
});

describe("composeLoopVerdict", () => {
  it("lets regression FAILED override VERIFIED", () => {
    expect(composeLoopVerdict("VERIFIED", "FAILED")).toBe("FAILED");
  });

  it("keeps expected-vs-actual VERIFIED when regression is only INCONCLUSIVE", () => {
    expect(composeLoopVerdict("VERIFIED", "INCONCLUSIVE")).toBe("VERIFIED");
  });
});

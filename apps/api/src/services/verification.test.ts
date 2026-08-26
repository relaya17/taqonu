import { describe, expect, it } from "vitest";
import {
  captureExpectedState,
  compareExpectedActual,
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

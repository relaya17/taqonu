import { describe, expect, it } from "vitest";
import { verificationVerdictFromOutcome } from "./verification.js";

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

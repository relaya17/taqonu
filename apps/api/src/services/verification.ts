import type { GovernedExecutionOutcome } from "./governed-execution.js";

/**
 * Receipt verification is independent of whether a tool ran.
 * Success of execution is not evidence that the outcome is correct.
 */
export const VERIFICATION_VERDICTS = [
  "VERIFIED",
  "FAILED",
  "PARTIAL",
  "INCONCLUSIVE",
  "BLOCKED",
] as const;

export type VerificationVerdict = (typeof VERIFICATION_VERDICTS)[number];

export interface ExpectedState {
  readonly artifactHash: string;
  readonly toolName: string;
  /** Concrete observations that must appear after mutation. Empty → cannot verify. */
  readonly expectedObservations: readonly string[];
}

export interface ActualState {
  readonly artifactHash: string;
  readonly toolName: string;
  readonly executed: boolean;
  readonly output: string;
}

export function captureExpectedState(input: {
  readonly artifactHash: string;
  readonly toolName: string;
  readonly expectedObservations?: readonly string[];
}): ExpectedState {
  return {
    artifactHash: input.artifactHash,
    toolName: input.toolName,
    expectedObservations: input.expectedObservations ?? [],
  };
}

export function compareExpectedActual(
  expected: ExpectedState,
  actual: ActualState,
): { readonly verdict: VerificationVerdict; readonly detail: string } {
  if (!actual.executed) {
    return {
      verdict: "BLOCKED",
      detail: "No actual state — execution did not run",
    };
  }
  if (actual.artifactHash !== expected.artifactHash) {
    return {
      verdict: "FAILED",
      detail: "Artifact hash changed between expected and actual",
    };
  }
  if (actual.toolName !== expected.toolName) {
    return {
      verdict: "FAILED",
      detail: "Tool name changed between expected and actual",
    };
  }
  const needles = expected.expectedObservations.filter((s) => s.trim().length > 0);
  if (needles.length === 0) {
    return {
      verdict: "INCONCLUSIVE",
      detail: "Executed, but no expected observations were bound — executed ≠ verified",
    };
  }
  const hits = needles.filter((n) => actual.output.includes(n));
  if (hits.length === needles.length) {
    return {
      verdict: "VERIFIED",
      detail: "All expected observations present in actual output",
    };
  }
  if (hits.length > 0) {
    return {
      verdict: "PARTIAL",
      detail: `${hits.length}/${needles.length} expected observations matched`,
    };
  }
  return {
    verdict: "FAILED",
    detail: "None of the expected observations were present in actual output",
  };
}

/**
 * Regression gate — same loop, not a QA product.
 * No baseline means we cannot claim "no regression".
 * Missing a prior observation after mutation is a FAILED repair, not VERIFIED.
 */
export function assessRegression(input: {
  readonly baselineObservations: readonly string[];
  readonly actualOutput: string;
  readonly executed: boolean;
}): { readonly verdict: VerificationVerdict; readonly detail: string } {
  if (!input.executed) {
    return { verdict: "BLOCKED", detail: "No execution — regression not evaluated" };
  }
  const baseline = input.baselineObservations.filter((s) => s.trim().length > 0);
  if (baseline.length === 0) {
    return {
      verdict: "INCONCLUSIVE",
      detail: "No baseline observations — cannot claim absence of regression",
    };
  }
  const missing = baseline.filter((n) => !input.actualOutput.includes(n));
  if (missing.length > 0) {
    return {
      verdict: "FAILED",
      detail: `Regression: ${missing.length} prior observation(s) missing after mutation`,
    };
  }
  return {
    verdict: "INCONCLUSIVE",
    detail: "Prior observations still present — not a verification of the new change",
  };
}

/**
 * General world-state check. Execution is never treated as verification.
 * INTENDED → AUTHORIZED → EXECUTED → VERIFIED.
 */
export function evaluateWorldState(input: {
  readonly intended: boolean;
  readonly authorized: boolean;
  readonly expected: ExpectedState;
  readonly actual: ActualState;
  readonly baselineObservations?: readonly string[];
}): {
  readonly stageReached: "INTENDED" | "AUTHORIZED" | "EXECUTED" | "VERIFIED";
  readonly verification: { readonly verdict: VerificationVerdict; readonly detail: string };
  readonly regression: { readonly verdict: VerificationVerdict; readonly detail: string };
  readonly loopVerdict: VerificationVerdict;
} {
  if (!input.intended) {
    const verification = {
      verdict: "BLOCKED" as const,
      detail: "No intended state was declared",
    };
    const regression = assessRegression({
      baselineObservations: input.baselineObservations ?? [],
      actualOutput: "",
      executed: false,
    });
    return {
      stageReached: "INTENDED",
      verification,
      regression,
      loopVerdict: composeLoopVerdict(verification.verdict, regression.verdict),
    };
  }
  if (!input.authorized) {
    const verification = {
      verdict: "BLOCKED" as const,
      detail: "Intended state was not authorized",
    };
    const regression = assessRegression({
      baselineObservations: input.baselineObservations ?? [],
      actualOutput: "",
      executed: false,
    });
    return {
      stageReached: "AUTHORIZED",
      verification,
      regression,
      loopVerdict: composeLoopVerdict(verification.verdict, regression.verdict),
    };
  }
  const verification = compareExpectedActual(input.expected, input.actual);
  const regression = assessRegression({
    baselineObservations: input.baselineObservations ?? [],
    actualOutput: input.actual.output,
    executed: input.actual.executed,
  });
  const loopVerdict = composeLoopVerdict(verification.verdict, regression.verdict);
  return {
    stageReached: loopVerdict === "VERIFIED" ? "VERIFIED" : "EXECUTED",
    verification,
    regression,
    loopVerdict,
  };
}

export function composeLoopVerdict(
  verification: VerificationVerdict,
  regression: VerificationVerdict,
): VerificationVerdict {
  if (regression === "FAILED") return "FAILED";
  if (verification === "BLOCKED" || regression === "BLOCKED") {
    return verification === "BLOCKED" ? verification : regression;
  }
  return verification;
}

export function verificationVerdictFromOutcome(
  outcome: GovernedExecutionOutcome,
): VerificationVerdict {
  if (outcome.status === "EXECUTED") {
    return "INCONCLUSIVE";
  }
  if (outcome.stage === "EXECUTION" && outcome.status === "FAILED") {
    return "FAILED";
  }
  if (outcome.status === "APPROVAL_REQUIRED") {
    return "BLOCKED";
  }
  return "BLOCKED";
}

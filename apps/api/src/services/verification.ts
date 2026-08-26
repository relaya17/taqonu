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

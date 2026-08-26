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

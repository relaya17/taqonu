import {
  ACT_STEPS,
  CONTROL_LOOP_PHASES,
  type ActStep,
  type ControlLoopPhase,
  type SystemPosture,
} from "@atlas/shared";

/** Connectors observe. They do not own ACT. */
export const CONNECTOR_CAPABILITIES = [
  "DISCOVER",
  "READ",
  "VERIFY",
  "OBSERVE",
  "ACT",
] as const;

export type ConnectorCapability = (typeof CONNECTOR_CAPABILITIES)[number];

export function isControlLoopPhase(value: string): value is ControlLoopPhase {
  return (CONTROL_LOOP_PHASES as readonly string[]).includes(value);
}

export function nextControlPhase(
  phase: ControlLoopPhase,
): ControlLoopPhase | null {
  const i = CONTROL_LOOP_PHASES.indexOf(phase);
  return i >= 0 && i < CONTROL_LOOP_PHASES.length - 1
    ? CONTROL_LOOP_PHASES[i + 1]!
    : null;
}

/** ACT is illegal until VERIFY has produced evidence. */
export function actAllowed(input: {
  phase: ControlLoopPhase;
  verified: boolean;
  policyAllows: boolean;
  approvalGranted: boolean;
}): boolean {
  return (
    input.phase === "ACT" &&
    input.verified &&
    input.policyAllows &&
    input.approvalGranted
  );
}

export function actPipeline(): readonly ActStep[] {
  return ACT_STEPS;
}

/**
 * Derive the outside-in loop from what is actually observed.
 * ACT is eligible only after a confirmed contract and passing invariants.
 */
export function deriveControlLoopPhase(input: {
  hasRepos: boolean;
  evidenceCount: number;
  healthObserved: boolean;
  contractState: "PROPOSED" | "CONFIRMED" | "INFERRED";
  invariantOverall: "PASS" | "FAIL" | "UNKNOWN" | null;
  posture: SystemPosture;
}): { phase: ControlLoopPhase; actEligible: boolean } {
  if (!input.hasRepos && input.evidenceCount === 0) {
    return { phase: "DISCOVER", actEligible: false };
  }
  if (input.evidenceCount === 0 || !input.healthObserved) {
    return { phase: "UNDERSTAND", actEligible: false };
  }

  const verified =
    input.contractState === "CONFIRMED" && input.invariantOverall === "PASS";
  const actEligible = actAllowed({
    phase: "ACT",
    verified,
    policyAllows: input.posture !== "BLOCKED",
    approvalGranted: verified,
  });

  if (actEligible) {
    return { phase: "ACT", actEligible: true };
  }
  return { phase: "VERIFY", actEligible: false };
}

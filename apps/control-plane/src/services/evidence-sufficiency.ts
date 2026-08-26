/**
 * Control Plane copy of evidence sufficiency (no @atlas/shared dependency).
 * Keep in lockstep with packages/shared/src/constants/evidence-sufficiency.ts.
 */
export const SUFFICIENCY_DECISIONS = ["CONTINUE", "HALT", "INCONCLUSIVE"] as const;
export type SufficiencyDecision = (typeof SUFFICIENCY_DECISIONS)[number];

export interface EvidenceSufficiencyInput {
  readonly evidenceCount: number;
  readonly conflicting?: boolean;
  readonly stale?: boolean;
  readonly claimedState?: string;
  readonly mutation?: boolean;
  readonly boundEvidenceIds?: readonly string[];
  readonly conflictingClaimIds?: readonly string[];
}

export interface EvidenceSufficiencyResult {
  readonly decision: SufficiencyDecision;
  readonly reason: string;
}

const HIGH_CLAIMS = new Set(["FACT", "VERIFIED", "CONFIRMED", "KNOWN"]);

export function assessEvidenceSufficiency(
  input: EvidenceSufficiencyInput,
): EvidenceSufficiencyResult {
  const bound = input.boundEvidenceIds?.filter((id) => id.trim().length > 0) ?? [];
  const conflicts = input.conflictingClaimIds?.filter((id) => id.trim().length > 0) ?? [];
  const count = Math.max(0, input.evidenceCount, bound.length);
  const mutation = input.mutation === true;
  const claimed = (input.claimedState ?? "").toUpperCase();
  const conflicting = input.conflicting === true || conflicts.length > 0;

  if (conflicting && mutation) {
    return {
      decision: "HALT",
      reason: "Conflicting evidence — Atlas cannot conclude or mutate as if the claim were known",
    };
  }

  if (conflicting) {
    return {
      decision: "INCONCLUSIVE",
      reason: "Conflicting evidence — observe only; do not conclude VERIFIED",
    };
  }

  if (input.stale === true && mutation) {
    return {
      decision: "INCONCLUSIVE",
      reason: "Stale evidence cannot authorize a mutation as a verified repair",
    };
  }

  if (count <= 0 && mutation && HIGH_CLAIMS.has(claimed)) {
    return {
      decision: "INCONCLUSIVE",
      reason: "Claim is not bound to evidence ids — cannot conclude FACT/VERIFIED",
    };
  }

  if (count <= 0 && mutation) {
    return {
      decision: "INCONCLUSIVE",
      reason: "No prior evidence for this mutation — proceed only through policy/approval, not as known truth",
    };
  }

  if (count <= 0) {
    return {
      decision: "CONTINUE",
      reason: "Read/observe path may gather evidence; emptiness is not VERIFIED",
    };
  }

  return {
    decision: "CONTINUE",
    reason: "Evidence is present and non-conflicting — still not a verification verdict",
  };
}

export function memoryEpistemicAfterAction(): "OBSERVED" {
  return "OBSERVED";
}

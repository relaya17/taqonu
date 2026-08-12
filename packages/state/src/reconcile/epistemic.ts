import type { EpistemicState } from "@atlas/shared";

/**
 * Lower = weaker. Overall project state takes the weakest slice —
 * never upgrade PROPOSED/INFERRED to FACT.
 */
const RANK: Record<EpistemicState, number> = {
  CONFLICTED: 0,
  CONTRADICTED: 0,
  INSUFFICIENT_EVIDENCE: 1,
  UNKNOWN: 2,
  UNVERIFIED: 3,
  ASSUMED: 3,
  STALE: 3,
  PROPOSED: 4,
  INFERRED: 5,
  OBSERVED: 6,
  CONFIRMED: 7,
  VERIFIED: 8,
  FACT: 9,
};

/** Overall state is the weakest slice — never upgrade PROPOSED to FACT. */
export function weakestEpistemicState(
  states: readonly EpistemicState[],
): EpistemicState {
  if (states.length === 0) {
    return "UNKNOWN";
  }
  return states.reduce((weakest, current) =>
    RANK[current] < RANK[weakest] ? current : weakest,
  );
}

export function assertNeverPromotesToFact(
  derived: EpistemicState,
  sources: readonly EpistemicState[],
): EpistemicState {
  if (derived === "FACT") {
    const hasFact = sources.some((state) => state === "FACT");
    if (!hasFact) {
      return "INFERRED";
    }
  }
  if (derived === "CONFIRMED") {
    const ok = sources.some(
      (state) => state === "FACT" || state === "CONFIRMED",
    );
    if (!ok) {
      return "INFERRED";
    }
  }
  return derived;
}

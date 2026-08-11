import type { EpistemicState } from "@atlas/shared";

const RANK: Record<EpistemicState, number> = {
  CONFLICTED: 0,
  UNKNOWN: 1,
  PROPOSED: 2,
  INFERRED: 3,
  CONFIRMED: 4,
  FACT: 5,
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

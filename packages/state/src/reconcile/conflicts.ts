import type { Claim, ProjectStateSliceKey } from "@atlas/shared";
import type { SliceDraft } from "./input.js";

/**
 * Detect opposing claims on the same slice without merging them.
 * Callers pass an explicit contradiction predicate — the engine never invents agreement.
 */
export function detectSliceConflict(input: {
  sliceKey: ProjectStateSliceKey;
  claimA: Claim;
  claimB: Claim;
  areContradictory: boolean;
  detectedAt: string;
}): SliceDraft["conflictingClaimIds"] | undefined {
  if (!input.areContradictory) {
    return undefined;
  }
  return [input.claimA.id, input.claimB.id];
}

export function summarizeConflict(
  claimA: Claim,
  claimB: Claim,
): string {
  return `CONFLICTED: "${claimA.statement}" vs "${claimB.statement}" — both retained.`;
}

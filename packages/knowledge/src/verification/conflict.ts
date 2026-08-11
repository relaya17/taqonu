export interface ClaimRef {
  readonly id: string;
  readonly statement: string;
  readonly authorityWeight: number;
  readonly at: Date;
}

export interface ConflictDetectionResult {
  readonly conflicted: boolean;
  readonly preferredClaimId: string | null;
  readonly reason: string | null;
}

/**
 * Detects conflicts without silently merging opposing claims.
 */
export function detectConflict(
  claimA: ClaimRef,
  claimB: ClaimRef,
  areContradictory: boolean,
): ConflictDetectionResult {
  if (!areContradictory) {
    return { conflicted: false, preferredClaimId: null, reason: null };
  }

  if (claimA.at.getTime() !== claimB.at.getTime()) {
    const newer = claimA.at > claimB.at ? claimA : claimB;
    const older = claimA.at > claimB.at ? claimB : claimA;
    if (newer.authorityWeight >= older.authorityWeight) {
      return {
        conflicted: true,
        preferredClaimId: newer.id,
        reason: "Newer claim with equal or higher authority",
      };
    }
  }

  if (claimA.authorityWeight !== claimB.authorityWeight) {
    const preferred =
      claimA.authorityWeight > claimB.authorityWeight ? claimA : claimB;
    return {
      conflicted: true,
      preferredClaimId: preferred.id,
      reason: "Higher authority source preferred; conflict retained",
    };
  }

  return {
    conflicted: true,
    preferredClaimId: null,
    reason: "Credible sources disagree; mark CONFLICTED",
  };
}

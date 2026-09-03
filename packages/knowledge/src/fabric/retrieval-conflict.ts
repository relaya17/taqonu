import { detectConflict, type ClaimRef } from "../verification/conflict.js";

const CONTRADICTION_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["deprecated", "supported"],
  ["deprecated", "exists"],
  ["forbidden", "allowed"],
  ["required", "not required"],
  ["never", "always"],
];

function significantTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9\u0590-\u05ff]+/i)
      .filter((token) => token.length >= 4),
  );
}

/**
 * Conservative contradiction signal. Unknown/ambiguous pairs are not treated
 * as conflicts — that would invent a dispute. Material overlap plus an
 * explicit opposing pair is required.
 */
export function excerptsAppearContradictory(a: string, b: string): boolean {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  const tokensA = significantTokens(a);
  const tokensB = significantTokens(b);
  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) overlap += 1;
  }
  if (overlap < 3) return false;
  return CONTRADICTION_PAIRS.some(
    ([x, y]) =>
      (left.includes(x) && right.includes(y)) || (left.includes(y) && right.includes(x)),
  );
}

export function eligibleHitsAreMateriallyConflicting(
  hits: ReadonlyArray<{
    readonly id: string;
    readonly excerpt: string;
    readonly authority: number;
    readonly sourceUpdatedAt: string | null;
  }>,
): boolean {
  for (let i = 0; i < hits.length; i += 1) {
    for (let j = i + 1; j < hits.length; j += 1) {
      const a = hits[i];
      const b = hits[j];
      if (!a || !b) continue;
      if (!excerptsAppearContradictory(a.excerpt, b.excerpt)) continue;
      const claimA: ClaimRef = {
        id: a.id,
        statement: a.excerpt,
        authorityWeight: a.authority,
        at: a.sourceUpdatedAt ? new Date(a.sourceUpdatedAt) : new Date(0),
      };
      const claimB: ClaimRef = {
        id: b.id,
        statement: b.excerpt,
        authorityWeight: b.authority,
        at: b.sourceUpdatedAt ? new Date(b.sourceUpdatedAt) : new Date(0),
      };
      const result = detectConflict(claimA, claimB, true);
      if (result.conflicted) return true;
    }
  }
  return false;
}

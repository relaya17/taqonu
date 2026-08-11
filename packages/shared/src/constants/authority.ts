/** Source authority ranking — highest wins conflicts (ADR-014). */

export const SOURCE_AUTHORITY_RANKS = [
  "LIVE_PRODUCTION",
  "AUTOMATED_VERIFIED_TEST",
  "STAGING_OBSERVATION",
  "CI_ARTIFACT",
  "REPOSITORY_CODE",
  "ARCHITECTURE_DOCUMENT",
  "DEVELOPER_STATEMENT",
  "LLM_INFERENCE",
] as const;

export type SourceAuthorityRank = (typeof SOURCE_AUTHORITY_RANKS)[number];

/** Lower number = higher authority. */
export const SOURCE_AUTHORITY_WEIGHT: Readonly<
  Record<SourceAuthorityRank, number>
> = {
  LIVE_PRODUCTION: 1,
  AUTOMATED_VERIFIED_TEST: 2,
  STAGING_OBSERVATION: 3,
  CI_ARTIFACT: 4,
  REPOSITORY_CODE: 5,
  ARCHITECTURE_DOCUMENT: 6,
  DEVELOPER_STATEMENT: 7,
  LLM_INFERENCE: 8,
};

export function compareSourceAuthority(
  a: SourceAuthorityRank,
  b: SourceAuthorityRank,
): number {
  return SOURCE_AUTHORITY_WEIGHT[a] - SOURCE_AUTHORITY_WEIGHT[b];
}

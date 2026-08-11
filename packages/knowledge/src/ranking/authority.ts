import type { AuthorityTier, SourceType } from "@atlas/shared";

const SOURCE_TYPE_TIER: Record<SourceType, AuthorityTier> = {
  OFFICIAL_DOCUMENTATION: "TIER_1",
  GOVERNMENT: "TIER_1",
  STANDARDS_BODY: "TIER_1",
  REGULATOR: "TIER_1",
  ACADEMIC: "TIER_2",
  PEER_REVIEWED: "TIER_2",
  TECHNICAL_ORG: "TIER_2",
  SECONDARY: "TIER_3",
  COMMUNITY: "TIER_4",
  FORUM: "TIER_4",
  BLOG: "TIER_4",
  SOCIAL: "TIER_4",
};

export function tierForSourceType(sourceType: SourceType): AuthorityTier {
  return SOURCE_TYPE_TIER[sourceType];
}

export function authorityWeight(tier: AuthorityTier): number {
  switch (tier) {
    case "TIER_1":
      return 1;
    case "TIER_2":
      return 0.75;
    case "TIER_3":
      return 0.4;
    case "TIER_4":
      return 0.15;
  }
}

/** Tier 3/4 must never be presented as equal to primary evidence. */
export function isPrimaryEvidence(tier: AuthorityTier): boolean {
  return tier === "TIER_1" || tier === "TIER_2";
}

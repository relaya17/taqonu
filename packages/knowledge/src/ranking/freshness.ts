import type { AuthorityTier } from "@atlas/shared";
import { authorityWeight } from "./authority.js";

export function computeFreshnessScore(input: {
  authority: AuthorityTier;
  retrievedAt: Date;
  publishedAt: Date | null;
  updatedAt: Date | null;
  verified: boolean;
  relevance: number;
  now?: Date;
}): number {
  const now = input.now ?? new Date();
  const reference = input.updatedAt ?? input.publishedAt ?? input.retrievedAt;
  const ageMs = Math.max(0, now.getTime() - reference.getTime());
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const recency = Math.max(0, 1 - ageDays / 365);
  const verification = input.verified ? 1 : 0.5;
  const relevance = Math.min(1, Math.max(0, input.relevance));

  return (
    authorityWeight(input.authority) * recency * verification * relevance
  );
}

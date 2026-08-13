/** Cloudflare BYO Provider Adapter — customer-owned cloud (ADR storage policy v2). */

import type { NormalizedEvidenceDraft } from "@atlas/shared";

export interface CloudflareAccountObservation {
  readonly accountLabel: string;
  readonly externalAccountId: string | null;
  readonly product: "workers" | "pages" | "r2" | "d1" | "kv" | "unknown";
  readonly status: "live" | "configured" | "error" | "unknown";
  readonly resourceName: string | null;
  readonly observedAt: string;
}

/** Map a Cloudflare resource observation into Atlas evidence drafts. */
export function cloudflareObservationToEvidenceDrafts(
  observation: CloudflareAccountObservation,
): readonly NormalizedEvidenceDraft[] {
  const epistemicState =
    observation.status === "live" || observation.status === "configured"
      ? "OBSERVED"
      : observation.status === "error"
        ? "UNVERIFIED"
        : "UNKNOWN";

  return [
    {
      provider: "cloudflare",
      source: `cloudflare:${observation.accountLabel}`,
      sourceType: "CLOUDFLARE_RESOURCE",
      sourceId: observation.externalAccountId,
      uri: null,
      excerpt: `${observation.product} · ${observation.status}${
        observation.resourceName ? ` · ${observation.resourceName}` : ""
      }`,
      version: null,
      observedAt: observation.observedAt,
      epistemicState,
      confidence:
        observation.status === "live"
          ? 0.85
          : observation.status === "configured"
            ? 0.7
            : 0.35,
      authorityRank:
        observation.status === "live" ? "LIVE_PRODUCTION" : "STAGING_OBSERVATION",
      classification: "INTERNAL",
      metadata: {
        product: observation.product,
        status: observation.status,
        resourceName: observation.resourceName,
      },
    },
  ];
}

/**
 * Validate that a Cloudflare API token *shape* looks sane without calling CF.
 * Never logs or returns the token.
 */
export function looksLikeCloudflareApiToken(token: string): boolean {
  const trimmed = token.trim();
  return trimmed.length >= 20 && trimmed.length <= 2000 && !/\s/.test(trimmed);
}

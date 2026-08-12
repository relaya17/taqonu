/** Render Provider Adapter — normalized evidence drafts (ADR-014 §9). */

import type { NormalizedEvidenceDraft } from "@atlas/shared";

export interface RenderServiceObservation {
  readonly serviceName: string;
  readonly serviceUrl: string | null;
  readonly environment: "production" | "preview" | "development";
  readonly status: "live" | "build_failed" | "suspended" | "deploying" | "unknown";
  readonly commitSha: string | null;
  readonly observedAt: string;
}

/** Map a Render deploy/service observation into Atlas evidence drafts. */
export function renderObservationToEvidenceDrafts(
  observation: RenderServiceObservation,
): readonly NormalizedEvidenceDraft[] {
  const authorityRank =
    observation.environment === "production" && observation.status === "live"
      ? "LIVE_PRODUCTION"
      : observation.environment === "preview"
        ? "STAGING_OBSERVATION"
        : "CI_ARTIFACT";

  const epistemicState =
    observation.status === "live"
      ? "OBSERVED"
      : observation.status === "build_failed"
        ? "UNVERIFIED"
        : "UNKNOWN";

  return [
    {
      provider: "render",
      source: `render:${observation.serviceName}`,
      sourceType: "RENDER_DEPLOYMENT",
      sourceId: observation.serviceUrl,
      uri: observation.serviceUrl,
      excerpt: `${observation.environment} · ${observation.status}`,
      version: observation.commitSha,
      observedAt: observation.observedAt,
      epistemicState,
      confidence: observation.status === "live" ? 0.9 : 0.4,
      authorityRank,
      classification: "INTERNAL",
      metadata: {
        environment: observation.environment,
        status: observation.status,
      },
    },
  ];
}

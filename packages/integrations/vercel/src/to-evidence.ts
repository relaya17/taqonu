/** Vercel Provider Adapter — normalized evidence drafts (ADR-014 §9). */

import type { NormalizedEvidenceDraft } from "@atlas/shared";

export interface VercelDeploymentObservation {
  readonly projectName: string;
  readonly deploymentUrl: string | null;
  readonly environment: "production" | "preview" | "development";
  readonly readyState: "READY" | "ERROR" | "BUILDING" | "QUEUED" | "UNKNOWN";
  readonly commitSha: string | null;
  readonly observedAt: string;
}

/** Map a Vercel deployment observation into Atlas evidence drafts. */
export function vercelObservationToEvidenceDrafts(
  observation: VercelDeploymentObservation,
): readonly NormalizedEvidenceDraft[] {
  const authorityRank =
    observation.environment === "production" && observation.readyState === "READY"
      ? "LIVE_PRODUCTION"
      : observation.environment === "preview"
        ? "STAGING_OBSERVATION"
        : "CI_ARTIFACT";

  const epistemicState =
    observation.readyState === "READY"
      ? "OBSERVED"
      : observation.readyState === "ERROR"
        ? "UNVERIFIED"
        : "UNKNOWN";

  return [
    {
      provider: "vercel",
      source: `vercel:${observation.projectName}`,
      sourceType: "VERCEL_DEPLOYMENT",
      sourceId: observation.deploymentUrl,
      uri: observation.deploymentUrl,
      excerpt: `${observation.environment} · ${observation.readyState}`,
      version: observation.commitSha,
      observedAt: observation.observedAt,
      epistemicState,
      confidence: observation.readyState === "READY" ? 0.9 : 0.4,
      authorityRank,
      classification: "INTERNAL",
      metadata: {
        environment: observation.environment,
        readyState: observation.readyState,
      },
    },
  ];
}

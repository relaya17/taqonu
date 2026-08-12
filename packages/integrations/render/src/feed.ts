/**
 * Render deployment observation feed — metadata only (no API tokens).
 * Produces DEPLOYMENT evidence for Current State.
 */
export interface RenderFeedInput {
  readonly projectId: string;
  readonly serviceName: string;
  readonly serviceUrl?: string | null;
  readonly environment: "production" | "preview" | "development";
  readonly status: "live" | "build_failed" | "suspended" | "deploying" | "unknown";
  readonly commitSha?: string | null;
}

export function summarizeRenderFeed(input: RenderFeedInput): {
  summary: string;
  environment: RenderFeedInput["environment"];
  status: RenderFeedInput["status"];
  url: string | null;
  commitSha: string | null;
} {
  return {
    summary: `Render/${input.serviceName}: ${input.environment} · ${input.status}`,
    environment: input.environment,
    status: input.status,
    url: input.serviceUrl ?? null,
    commitSha: input.commitSha ?? null,
  };
}

/**
 * Vercel deployment observation feed — metadata only (no API tokens).
 * Produces DEPLOYMENT evidence for Current State.
 */
export interface VercelFeedInput {
  readonly projectId: string;
  readonly projectName: string;
  readonly deploymentUrl?: string | null;
  readonly environment: "production" | "preview" | "development";
  readonly readyState: "READY" | "ERROR" | "BUILDING" | "QUEUED" | "UNKNOWN";
  readonly commitSha?: string | null;
}

export function summarizeVercelFeed(input: VercelFeedInput): {
  summary: string;
  environment: VercelFeedInput["environment"];
  status: VercelFeedInput["readyState"];
  url: string | null;
  commitSha: string | null;
} {
  return {
    summary: `Vercel/${input.projectName}: ${input.environment} · ${input.readyState}`,
    environment: input.environment,
    status: input.readyState,
    url: input.deploymentUrl ?? null,
    commitSha: input.commitSha ?? null,
  };
}

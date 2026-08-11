import type { GitHubRepoObservation } from "./observation.js";

/**
 * Initial sync pipeline output shape (Phase 3 will fill from GitHub API).
 * For Architecture v1.0 we accept an observation payload and treat it as FACT evidence.
 */
export function buildObservationFromSyncPayload(input: {
  fullName: string;
  defaultBranch?: string | null | undefined;
  private?: boolean | undefined;
  htmlUrl?: string | null | undefined;
  headSha?: string | null | undefined;
  openPrCount?: number | undefined;
  openIssueCount?: number | undefined;
  dependencyManifests?: readonly string[] | undefined;
  hasCiConfig?: boolean | undefined;
  architectureDocPaths?: readonly string[] | undefined;
  hasTestDirectory?: boolean | undefined;
  recentCiStatus?: "success" | "failure" | "unknown" | null | undefined;
  hasDependabot?: boolean | undefined;
  hasCodeowners?: boolean | undefined;
  observedAt?: string | undefined;
}): GitHubRepoObservation {
  const observedAt = input.observedAt ?? new Date().toISOString();
  return {
    fullName: input.fullName,
    defaultBranch: input.defaultBranch ?? null,
    private: input.private ?? true,
    htmlUrl: input.htmlUrl ?? null,
    lastSyncedAt: observedAt,
    headSha: input.headSha ?? null,
    openPrCount: input.openPrCount ?? 0,
    openIssueCount: input.openIssueCount ?? 0,
    dependencyManifests: input.dependencyManifests ?? [],
    hasCiConfig: input.hasCiConfig ?? false,
    architectureDocPaths: input.architectureDocPaths ?? [],
    hasTestDirectory: input.hasTestDirectory ?? false,
    recentCiStatus: input.recentCiStatus ?? null,
    hasDependabot: input.hasDependabot ?? false,
    hasCodeowners: input.hasCodeowners ?? false,
    observedAt,
  };
}

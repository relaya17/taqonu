/** Observable GitHub repository state used as reconciliation input. */
export interface GitHubRepoObservation {
  readonly fullName: string;
  readonly defaultBranch: string | null;
  readonly private: boolean;
  readonly htmlUrl: string | null;
  readonly lastSyncedAt: string | null;
  readonly headSha: string | null;
  readonly openPrCount: number;
  readonly openIssueCount: number;
  readonly dependencyManifests: readonly string[];
  readonly hasCiConfig: boolean;
  readonly architectureDocPaths: readonly string[];
  readonly hasTestDirectory: boolean;
  readonly recentCiStatus: "success" | "failure" | "unknown" | null;
  readonly hasDependabot: boolean;
  readonly hasCodeowners: boolean;
  readonly observedAt: string;
}

export function emptyGitHubObservation(
  fullName: string,
  observedAt: string = new Date().toISOString(),
): GitHubRepoObservation {
  return {
    fullName,
    defaultBranch: null,
    private: true,
    htmlUrl: null,
    lastSyncedAt: null,
    headSha: null,
    openPrCount: 0,
    openIssueCount: 0,
    dependencyManifests: [],
    hasCiConfig: false,
    architectureDocPaths: [],
    hasTestDirectory: false,
    recentCiStatus: null,
    hasDependabot: false,
    hasCodeowners: false,
    observedAt,
  };
}

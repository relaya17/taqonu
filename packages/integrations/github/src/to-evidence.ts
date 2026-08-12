import type { GitHubRepoObservation } from "./observation.js";
import type { EvidenceCategory } from "@atlas/shared";

export interface GitHubEvidenceDraft {
  readonly source: string;
  readonly sourceType: "GITHUB" | "COMMIT" | "REPOSITORY_FILE" | "PULL_REQUEST" | "ISSUE";
  readonly sourceId: string | null;
  readonly uri: string | null;
  readonly excerpt: string | null;
  readonly version: string | null;
  readonly observedAt: string;
  readonly epistemicState: "FACT";
  readonly confidence: number;
  readonly category: EvidenceCategory;
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
}

/** Map a GitHub observation into evidence drafts (FACT only — never PROPOSED). */
export function observationToEvidenceDrafts(
  observation: GitHubRepoObservation,
): readonly GitHubEvidenceDraft[] {
  const drafts: GitHubEvidenceDraft[] = [
    {
      source: `github:${observation.fullName}`,
      sourceType: "GITHUB",
      sourceId: observation.fullName,
      uri: observation.htmlUrl,
      excerpt: `defaultBranch=${observation.defaultBranch ?? "unknown"}; private=${observation.private}`,
      version: observation.headSha,
      observedAt: observation.observedAt,
      epistemicState: "FACT",
      confidence: 1,
      category: "GIT",
      metadata: {
        openPrCount: observation.openPrCount,
        openIssueCount: observation.openIssueCount,
      },
    },
  ];

  if (observation.headSha) {
    drafts.push({
      source: `github:${observation.fullName}@${observation.headSha}`,
      sourceType: "COMMIT",
      sourceId: observation.headSha,
      uri: observation.htmlUrl,
      excerpt: `HEAD ${observation.headSha}`,
      version: observation.headSha,
      observedAt: observation.observedAt,
      epistemicState: "FACT",
      confidence: 1,
      category: "GIT",
      metadata: {},
    });
  }

  for (const path of observation.architectureDocPaths) {
    drafts.push({
      source: `github:${observation.fullName}:${path}`,
      sourceType: "REPOSITORY_FILE",
      sourceId: path,
      uri: observation.htmlUrl,
      excerpt: path,
      version: observation.headSha,
      observedAt: observation.observedAt,
      epistemicState: "FACT",
      confidence: 0.95,
      category: "ARCHITECTURE",
      metadata: { kind: "architecture_doc" },
    });
  }

  for (const manifest of observation.dependencyManifests) {
    drafts.push({
      source: `github:${observation.fullName}:${manifest}`,
      sourceType: "REPOSITORY_FILE",
      sourceId: manifest,
      uri: observation.htmlUrl,
      excerpt: manifest,
      version: observation.headSha,
      observedAt: observation.observedAt,
      epistemicState: "FACT",
      confidence: 0.95,
      category: "DEPENDENCIES",
      metadata: { kind: "dependency_manifest" },
    });
  }

  return drafts;
}

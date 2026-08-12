import { z } from "zod";
import { AtlasError } from "@atlas/shared";
import type { GitHubApiRepo } from "./user-repos.js";

const installationRepoSchema = z.object({
  full_name: z.string(),
  name: z.string(),
  private: z.boolean(),
  html_url: z.string().url(),
  default_branch: z.string().optional().nullable(),
  description: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  pushed_at: z.string().nullable().optional(),
});

const installationReposPageSchema = z.object({
  total_count: z.number().int().optional(),
  repositories: z.array(installationRepoSchema),
});

/**
 * List repositories accessible to a GitHub App installation.
 * Uses an installation access token (not a user PAT).
 * @see https://docs.github.com/en/rest/apps/installations#list-repositories-accessible-to-the-app-installation
 */
export async function listInstallationRepos(input: {
  readonly installationToken: string;
  readonly fetchImpl?: typeof fetch;
  /** Cap pages (100 repos/page). Default 10 → max 1000. */
  readonly maxPages?: number;
}): Promise<readonly GitHubApiRepo[]> {
  const doFetch = input.fetchImpl ?? fetch;
  const maxPages = input.maxPages ?? 10;
  const repos: GitHubApiRepo[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const response = await doFetch(
      `https://api.github.com/installation/repositories?per_page=100&page=${page}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${input.installationToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "ArletOS-Atlas",
        },
      },
    );

    if (!response.ok) {
      throw new AtlasError(
        "INTEGRATION_ERROR",
        `GitHub installation repositories list failed (${response.status})`,
        { statusCode: 502 },
      );
    }

    const parsed = installationReposPageSchema.parse(await response.json());
    repos.push(...parsed.repositories);
    if (parsed.repositories.length < 100) {
      break;
    }
  }

  return repos;
}

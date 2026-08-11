import { z } from "zod";

const githubRepoSchema = z.object({
  full_name: z.string(),
  name: z.string(),
  private: z.boolean(),
  html_url: z.string().url(),
  default_branch: z.string().optional().nullable(),
  description: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  pushed_at: z.string().nullable().optional(),
});

export type GitHubApiRepo = z.infer<typeof githubRepoSchema>;

export interface GitHubUserProfile {
  readonly login: string;
  readonly id: number;
  readonly name: string | null;
  readonly htmlUrl: string;
}

async function githubFetch(
  path: string,
  token: string,
): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "ArletOS-Atlas",
    },
  });
}

export async function verifyGithubToken(token: string): Promise<GitHubUserProfile> {
  const response = await githubFetch("/user", token);
  if (!response.ok) {
    throw new Error(`GitHub auth failed (${response.status}) — check token scopes`);
  }
  const json = (await response.json()) as {
    login: string;
    id: number;
    name: string | null;
    html_url: string;
  };
  return {
    login: json.login,
    id: json.id,
    name: json.name,
    htmlUrl: json.html_url,
  };
}

/** Parse owner/repo from "owner/repo" or a github.com URL. */
export function parseGithubRepoRef(input: string): { owner: string; repo: string } {
  const trimmed = input.trim().replace(/\.git$/i, "");
  const urlMatch = trimmed.match(
    /github\.com[/:]([^/]+)\/([^/?#]+)/i,
  );
  if (urlMatch) {
    return { owner: urlMatch[1]!, repo: urlMatch[2]! };
  }
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length === 2) {
    return { owner: parts[0]!, repo: parts[1]! };
  }
  throw new Error(
    `Invalid GitHub repo ref "${input}" — use owner/repo or a github.com URL`,
  );
}

export async function fetchGithubRepo(
  token: string,
  owner: string,
  repo: string,
): Promise<GitHubApiRepo> {
  const response = await githubFetch(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    token,
  );
  if (!response.ok) {
    throw new Error(`GitHub repo fetch failed (${response.status}) for ${owner}/${repo}`);
  }
  return githubRepoSchema.parse(await response.json());
}

export async function listGithubReposForToken(
  token: string,
): Promise<readonly GitHubApiRepo[]> {
  const repos: GitHubApiRepo[] = [];
  let page = 1;
  for (;;) {
    const response = await githubFetch(
      `/user/repos?per_page=100&page=${page}&affiliation=owner,collaborator,organization_member&sort=updated`,
      token,
    );
    if (!response.ok) {
      throw new Error(`GitHub list repos failed (${response.status})`);
    }
    const batch = z.array(githubRepoSchema).parse(await response.json());
    repos.push(...batch);
    if (batch.length < 100 || page >= 10) {
      break;
    }
    page += 1;
  }
  return repos;
}

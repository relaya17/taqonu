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
  token?: string | null,
  fetchImpl: typeof fetch = fetch,
  accept = "application/vnd.github+json",
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "ArletOS-Atlas",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return fetchImpl(`https://api.github.com${path}`, { headers });
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
  token: string | null | undefined,
  owner: string,
  repo: string,
): Promise<GitHubApiRepo> {
  const response = await githubFetch(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    token,
  );
  if (!response.ok) {
    const hint =
      response.status === 404 && !token
        ? " — private repos need a PAT; public repos should work without one"
        : response.status === 401 || response.status === 403
          ? " — check PAT scopes (repo read) or rate limits"
          : "";
    throw new Error(
      `GitHub repo fetch failed (${response.status}) for ${owner}/${repo}${hint}`,
    );
  }
  return githubRepoSchema.parse(await response.json());
}

export interface GitHubTreeEntry {
  readonly path: string;
  readonly type: "blob" | "tree";
  readonly size?: number;
}

export interface GitHubTreeResult {
  readonly entries: readonly GitHubTreeEntry[];
  readonly truncated: boolean;
}

/**
 * Real repository file listing via GitHub's Git Trees API (recursive) — no clone,
 * no tarball, no local disk. Works from any serverless runtime with just HTTPS.
 * Returns paths + blob/tree type only; file contents are never fetched or stored.
 */
export async function fetchGithubRepoTree(
  token: string | null | undefined,
  owner: string,
  repo: string,
  ref: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GitHubTreeResult> {
  const response = await githubFetch(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    token,
    fetchImpl,
  );
  if (!response.ok) {
    throw new Error(
      `GitHub tree fetch failed (${response.status}) for ${owner}/${repo}@${ref}`,
    );
  }
  const json = (await response.json()) as {
    tree: Array<{ path: string; type: string; size?: number }>;
    truncated?: boolean;
  };
  const entries: GitHubTreeEntry[] = json.tree
    .filter((item) => item.type === "blob" || item.type === "tree")
    .map((item) => ({
      path: item.path,
      type: item.type as "blob" | "tree",
      ...(item.size != null ? { size: item.size } : {}),
    }));
  return { entries, truncated: Boolean(json.truncated) };
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

/** Encode a repo-relative POSIX path for the contents API (keeps `/`). */
function encodeRepoPath(path: string): string {
  return path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export class GitHubFileFetchError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GitHubFileFetchError";
  }
}

/**
 * Read one file's raw bytes via the contents API (read-only, no clone).
 * `maxBytes` guards memory: larger bodies are rejected before buffering
 * when GitHub reports Content-Length.
 */
export async function fetchGithubFileContent(
  token: string | null | undefined,
  owner: string,
  repo: string,
  path: string,
  ref: string,
  options?: { readonly fetchImpl?: typeof fetch; readonly maxBytes?: number },
): Promise<Buffer> {
  const cleaned = path.replace(/\\/g, "/");
  if (cleaned.split("/").some((segment) => segment === "..")) {
    throw new GitHubFileFetchError("Path escapes repository", 400);
  }
  const response = await githubFetch(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeRepoPath(cleaned)}?ref=${encodeURIComponent(ref)}`,
    token,
    options?.fetchImpl ?? fetch,
    "application/vnd.github.raw+json",
  );
  if (!response.ok) {
    throw new GitHubFileFetchError(
      `GitHub file fetch failed (${response.status}) for ${owner}/${repo}:${cleaned}@${ref}`,
      response.status,
    );
  }
  const maxBytes = options?.maxBytes;
  const declared = Number(response.headers.get("content-length") ?? "");
  if (maxBytes != null && Number.isFinite(declared) && declared > maxBytes) {
    throw new GitHubFileFetchError(
      `File too large to open in studio (${declared} bytes).`,
      413,
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

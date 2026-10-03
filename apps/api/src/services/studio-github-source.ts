import type { FastifyInstance } from "fastify";
import {
  GitHubAppTokenCache,
  GitHubFileFetchError,
  fetchGithubFileContent,
  fetchGithubRepoTree,
  listInstallationRepos,
  normalizeGithubPrivateKey,
  type GitHubApiRepo,
} from "@atlas/integrations-github";
import {
  buildWorkspaceTreeFromEntries,
  workspaceFileViewFromBuffer,
  type WorkspaceFileView,
  type WorkspaceTreeNode,
} from "@atlas/code-intelligence";
import { AtlasError } from "@atlas/shared";
import { osStore } from "../store/os-store.js";

/**
 * Studio's read-only GitHub source: when a project has no local folder on the
 * API host (always the case on Vercel), Studio lists and opens the files of
 * the repository the project owner connected through the GitHub App.
 *
 * Read-only by design — the App holds `contents: read` only; edits still go
 * through Patch propose → Approve → Apply against a linked workspace.
 */

export interface StudioGithubSourceInfo {
  readonly kind: "github";
  /** "owner/repo" currently shown. */
  readonly repo: string;
  readonly ref: string;
  /** Every repository the installation can read, for the repo picker. */
  readonly repos: readonly string[];
}

export interface ResolvedStudioGithubSource {
  readonly installationId: string;
  readonly owner: string;
  readonly name: string;
  readonly ref: string;
  readonly token: string;
  readonly info: StudioGithubSourceInfo;
}

const REPO_CACHE_TTL_MS = 60_000;
const MAX_REMOTE_FILE_BYTES = 800_000;

let tokenCache: { key: string; cache: GitHubAppTokenCache } | null = null;
const repoCache = new Map<string, { at: number; repos: readonly GitHubApiRepo[] }>();

/** Test hook — drop cached tokens/repo lists between cases. */
export function resetStudioGithubCaches(): void {
  tokenCache = null;
  repoCache.clear();
}

function getTokenCache(appId: string, privateKey: string): GitHubAppTokenCache {
  const key = `${appId}:${privateKey.length}`;
  if (!tokenCache || tokenCache.key !== key) {
    tokenCache = {
      key,
      cache: new GitHubAppTokenCache({
        appId,
        privateKeyPem: normalizeGithubPrivateKey(privateKey),
      }),
    };
  }
  return tokenCache.cache;
}

async function installationRepos(
  installationId: string,
  token: string,
): Promise<readonly GitHubApiRepo[]> {
  const cached = repoCache.get(installationId);
  if (cached && Date.now() - cached.at < REPO_CACHE_TTL_MS) return cached.repos;
  const repos = await listInstallationRepos({ installationToken: token, maxPages: 3 });
  repoCache.set(installationId, { at: Date.now(), repos });
  return repos;
}

function sameRepo(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

function pickRepo(
  projectId: string,
  repos: readonly GitHubApiRepo[],
  chosen: string | null,
): GitHubApiRepo {
  const byChoice = repos.find((r) => sameRepo(r.full_name, chosen));
  if (byChoice) return byChoice;
  const observed = osStore.github.get(projectId)?.fullName ?? null;
  const byObservation = repos.find((r) => sameRepo(r.full_name, observed));
  if (byObservation) return byObservation;
  const project = osStore.getProject(projectId);
  const slug = project?.slug?.toLowerCase() ?? "";
  const byName = repos.find(
    (r) =>
      r.name.toLowerCase() === slug ||
      r.name.toLowerCase() === (project?.name ?? "").toLowerCase(),
  );
  if (byName) return byName;
  return [...repos].sort((a, b) => a.full_name.localeCompare(b.full_name))[0]!;
}

function installationIdFor(projectId: string): { installationId: string; repo: string | null } | null {
  const bound = osStore.getStudioGithubSource(projectId);
  if (bound) return { installationId: bound.installationId, repo: bound.repoFullName };
  const legacy = osStore.getGithubAppInstallationForProject(projectId);
  return legacy ? { installationId: legacy.installationId, repo: null } : null;
}

/** True when the API has GitHub App credentials (so Studio can offer "Connect GitHub"). */
export function studioGithubAppConfigured(app: FastifyInstance): boolean {
  return Boolean(app.atlasEnv.GITHUB_APP_ID && app.atlasEnv.GITHUB_PRIVATE_KEY);
}

/**
 * Resolve the GitHub source for a project, or null when the project has no
 * installation bound (caller then falls back to the "link a folder" message).
 * Caller must already have checked project read access.
 */
export async function resolveStudioGithubSource(
  app: FastifyInstance,
  projectId: string,
): Promise<ResolvedStudioGithubSource | null> {
  const appId = app.atlasEnv.GITHUB_APP_ID;
  const privateKey = app.atlasEnv.GITHUB_PRIVATE_KEY;
  if (!appId || !privateKey) return null;
  const binding = installationIdFor(projectId);
  if (!binding) return null;

  let token: string;
  let repos: readonly GitHubApiRepo[];
  try {
    token = await getTokenCache(appId, privateKey).getToken(binding.installationId);
    repos = await installationRepos(binding.installationId, token);
  } catch (error) {
    throw new AtlasError(
      "INTEGRATION_ERROR",
      `GitHub is not reachable for this project right now (${error instanceof Error ? error.message : "unknown"}). Reconnect GitHub from Studio if the app was uninstalled.`,
      { statusCode: 502 },
    );
  }
  if (repos.length === 0) {
    throw new AtlasError(
      "VALIDATION_ERROR",
      "The GitHub App has no repository access. Open GitHub → Settings → Applications and add the project repository.",
    );
  }

  const repo = pickRepo(projectId, repos, binding.repo);
  const [owner, name] = repo.full_name.split("/") as [string, string];
  return {
    installationId: binding.installationId,
    owner,
    name,
    ref: repo.default_branch || "main",
    token,
    info: {
      kind: "github",
      repo: repo.full_name,
      ref: repo.default_branch || "main",
      repos: repos.map((r) => r.full_name).sort((a, b) => a.localeCompare(b)),
    },
  };
}

/** Remember which repository of the installation Studio shows for a project. */
export async function chooseStudioGithubRepo(
  app: FastifyInstance,
  projectId: string,
  repoFullName: string,
): Promise<StudioGithubSourceInfo> {
  const source = await resolveStudioGithubSource(app, projectId);
  if (!source) {
    throw new AtlasError("VALIDATION_ERROR", "Connect GitHub to this project first.");
  }
  const match = source.info.repos.find((r) => sameRepo(r, repoFullName));
  if (!match) {
    throw new AtlasError(
      "VALIDATION_ERROR",
      "That repository is not shared with the GitHub App for this project.",
    );
  }
  osStore.setStudioGithubSource(projectId, {
    installationId: source.installationId,
    repoFullName: match,
    updatedAt: new Date().toISOString(),
  });
  const refreshed = await resolveStudioGithubSource(app, projectId);
  return refreshed!.info;
}

export async function listStudioGithubTree(source: ResolvedStudioGithubSource): Promise<{
  root: string;
  tree: WorkspaceTreeNode;
  truncated: boolean;
  entryCount: number;
  readOnly: true;
}> {
  let listed;
  try {
    listed = await fetchGithubRepoTree(source.token, source.owner, source.name, source.ref);
  } catch (error) {
    throw new AtlasError(
      "INTEGRATION_ERROR",
      error instanceof Error ? error.message : "GitHub tree fetch failed",
      { statusCode: 502 },
    );
  }
  const built = buildWorkspaceTreeFromEntries(
    source.name,
    listed.entries.map((entry) => ({
      path: entry.path,
      kind: entry.type === "tree" ? ("dir" as const) : ("file" as const),
      ...(entry.size != null ? { size: entry.size } : {}),
    })),
    { truncated: listed.truncated },
  );
  return {
    root: `github:${source.info.repo}@${source.ref}`,
    ...built,
    readOnly: true,
  };
}

export async function readStudioGithubFile(
  source: ResolvedStudioGithubSource,
  path: string,
): Promise<WorkspaceFileView> {
  let buf: Buffer;
  try {
    buf = await fetchGithubFileContent(source.token, source.owner, source.name, path, source.ref, {
      maxBytes: MAX_REMOTE_FILE_BYTES,
    });
  } catch (error) {
    if (error instanceof GitHubFileFetchError) {
      if (error.status === 404) {
        throw new AtlasError("VALIDATION_ERROR", `File not found: ${path}`);
      }
      if (error.status === 400 || error.status === 413) {
        throw new AtlasError("VALIDATION_ERROR", error.message);
      }
    }
    throw new AtlasError(
      "INTEGRATION_ERROR",
      error instanceof Error ? error.message : "GitHub file fetch failed",
      { statusCode: 502 },
    );
  }
  try {
    return workspaceFileViewFromBuffer(path, buf);
  } catch (error) {
    throw new AtlasError(
      "VALIDATION_ERROR",
      error instanceof Error ? error.message : "Failed to read file",
    );
  }
}

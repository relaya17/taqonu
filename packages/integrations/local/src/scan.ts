import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

export interface LocalRepoDiscovery {
  readonly folderName: string;
  readonly absolutePath: string;
  readonly fullName: string | null;
  readonly remoteUrl: string | null;
}

function parseOriginRemote(gitConfig: string): string | null {
  const match = gitConfig.match(
    /\[remote\s+"origin"\][^\[]*url\s*=\s*(.+)/i,
  );
  return match?.[1]?.trim() ?? null;
}

function remoteUrlToFullName(url: string): string | null {
  const cleaned = url
    .replace(/\.git$/i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/^ssh:\/\/git@github\.com\//i, "");
  if (!cleaned.includes("/")) {
    return null;
  }
  const [owner, repo] = cleaned.split("/");
  if (!owner || !repo) {
    return null;
  }
  return `${owner}/${repo}`;
}

function discoverAt(dir: string): LocalRepoDiscovery | null {
  const gitDir = join(dir, ".git");
  if (!existsSync(gitDir)) {
    return null;
  }
  let remoteUrl: string | null = null;
  let fullName: string | null = null;
  try {
    const configPath = join(gitDir, "config");
    if (existsSync(configPath)) {
      remoteUrl = parseOriginRemote(readFileSync(configPath, "utf8"));
      if (remoteUrl) {
        fullName = remoteUrlToFullName(remoteUrl);
      }
    }
  } catch {
    // ignore unreadable configs
  }
  return {
    folderName: basename(dir),
    absolutePath: dir,
    fullName,
    remoteUrl,
  };
}

/**
 * Scan a folder on the machine running the API for git repositories.
 * Depth 1 = immediate children; depth 2 also checks one nested level.
 */
export function scanLocalReposRoot(
  reposRoot: string,
  maxDepth = 2,
): readonly LocalRepoDiscovery[] {
  const root = resolve(reposRoot);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Local path not found or not a directory: ${root}`);
  }

  const found: LocalRepoDiscovery[] = [];
  const self = discoverAt(root);
  if (self) {
    found.push(self);
    return found;
  }

  const walk = (dir: string, depth: number): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === "node_modules" || name === ".git" || name.startsWith(".")) {
        continue;
      }
      const absolute = join(dir, name);
      let isDir = false;
      try {
        isDir = statSync(absolute).isDirectory();
      } catch {
        continue;
      }
      if (!isDir) {
        continue;
      }
      const repo = discoverAt(absolute);
      if (repo) {
        found.push(repo);
        continue;
      }
      if (depth < maxDepth) {
        walk(absolute, depth + 1);
      }
    }
  };

  walk(root, 1);
  return found;
}

function looksLikeProjectFolder(dir: string): boolean {
  return (
    existsSync(join(dir, "package.json")) ||
    existsSync(join(dir, "pnpm-workspace.yaml")) ||
    existsSync(join(dir, "src")) ||
    existsSync(join(dir, "app")) ||
    existsSync(join(dir, "README.md"))
  );
}

/**
 * Git repos under root PLUS immediate child folders that look like apps
 * (even without `.git`) — used to link CaseFlow-style unzipped folders.
 */
export function listLocalProjectCandidates(
  reposRoot: string,
  maxDepth = 2,
): readonly LocalRepoDiscovery[] {
  const root = resolve(reposRoot);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`Local path not found or not a directory: ${root}`);
  }

  const gitRepos = scanLocalReposRoot(reposRoot, maxDepth);
  const seen = new Set(gitRepos.map((r) => resolve(r.absolutePath)));
  const extra: LocalRepoDiscovery[] = [];

  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    return gitRepos;
  }

  for (const name of entries) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const absolute = join(root, name);
    try {
      if (!statSync(absolute).isDirectory()) continue;
    } catch {
      continue;
    }
    if (seen.has(resolve(absolute))) continue;
    if (!looksLikeProjectFolder(absolute)) continue;
    extra.push({
      folderName: name,
      absolutePath: absolute,
      fullName: null,
      remoteUrl: null,
    });
  }

  return [...gitRepos, ...extra];
}

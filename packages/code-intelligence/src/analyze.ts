import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SKIP = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "coverage",
  ".turbo",
  ".atlas",
]);

export interface RepoNode {
  path: string;
  kind: "dir" | "file";
  children?: RepoNode[];
}

export interface RepoAnalysis {
  root: string;
  apps: string[];
  packages: string[];
  topLevel: string[];
  fileCount: number;
  sampleFiles: string[];
  graphHint: string;
}

function listImmediate(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => !SKIP.has(name) && !name.startsWith("."));
}

function walkFiles(dir: string, root: string, out: string[], limit: number): void {
  if (out.length >= limit) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkFiles(full, root, out, limit);
    } else if (/\.(ts|tsx|js|jsx|json|md)$/i.test(name)) {
      out.push(relative(root, full).split(sep).join("/"));
      if (out.length >= limit) return;
    }
  }
}

/** Lightweight repository structure analysis (ADR-015 Code Intelligence). */
export function analyzeRepository(root: string): RepoAnalysis {
  const abs = root;
  const topLevel = listImmediate(abs);
  const appsDir = join(abs, "apps");
  const packagesDir = join(abs, "packages");
  const apps = existsSync(appsDir) ? listImmediate(appsDir) : [];
  const packages = existsSync(packagesDir) ? listImmediate(packagesDir) : [];
  const sampleFiles: string[] = [];
  walkFiles(abs, abs, sampleFiles, 80);

  return {
    root: abs,
    apps,
    packages,
    topLevel,
    fileCount: sampleFiles.length,
    sampleFiles,
    graphHint: [
      "Repository",
      apps.length ? `├── Apps (${apps.join(", ")})` : "├── Apps (none)",
      packages.length
        ? `├── Packages (${packages.slice(0, 12).join(", ")}${packages.length > 12 ? "…" : ""})`
        : "├── Packages (none)",
      "├── Tests / CI / Infra (scan deeper via impact)",
      "└── Integrations",
    ].join("\n"),
  };
}

export interface RemoteTreeEntry {
  readonly path: string;
  readonly type: "blob" | "tree";
}

/**
 * Same structural analysis as analyzeRepository (apps/packages/fileCount/graphHint),
 * but computed from a remote file-tree listing (e.g. GitHub's Git Trees API) instead
 * of walking a local filesystem. Lets hosted deployments produce real repo structure
 * without needing disk access to the repo.
 */
export function analyzeRepoTreeEntries(
  root: string,
  entries: readonly RemoteTreeEntry[],
): RepoAnalysis {
  const kept = entries.filter(
    (entry) => !entry.path.split("/").some((segment) => SKIP.has(segment)),
  );

  const topLevel = Array.from(
    new Set(kept.map((entry) => entry.path.split("/")[0]).filter((v): v is string => Boolean(v))),
  );

  const appsSet = new Set<string>();
  const packagesSet = new Set<string>();
  for (const entry of kept) {
    const parts = entry.path.split("/");
    if (parts[0] === "apps" && parts.length >= 2 && parts[1]) appsSet.add(parts[1]);
    if (parts[0] === "packages" && parts.length >= 2 && parts[1]) packagesSet.add(parts[1]);
  }

  const sampleFiles = kept
    .filter((entry) => entry.type === "blob" && /\.(ts|tsx|js|jsx|json|md)$/i.test(entry.path))
    .map((entry) => entry.path)
    .slice(0, 80);

  const apps = Array.from(appsSet);
  const packages = Array.from(packagesSet);

  return {
    root,
    apps,
    packages,
    topLevel,
    fileCount: sampleFiles.length,
    sampleFiles,
    graphHint: [
      "Repository",
      apps.length ? `├── Apps (${apps.join(", ")})` : "├── Apps (none)",
      packages.length
        ? `├── Packages (${packages.slice(0, 12).join(", ")}${packages.length > 12 ? "…" : ""})`
        : "├── Packages (none)",
      "├── Tests / CI / Infra (scan deeper via impact)",
      "└── Integrations",
    ].join("\n"),
  };
}

export function readTextFile(root: string, relPath: string): string | null {
  const full = join(root, relPath);
  if (!existsSync(full)) return null;
  try {
    return readFileSync(full, "utf8");
  } catch {
    return null;
  }
}

export function findFilesByKeyword(
  root: string,
  keyword: string,
  limit = 20,
): string[] {
  const needle = keyword.toLowerCase();
  const all: string[] = [];
  walkFiles(root, root, all, 400);
  return all
    .filter((p) => p.toLowerCase().includes(needle))
    .slice(0, limit);
}

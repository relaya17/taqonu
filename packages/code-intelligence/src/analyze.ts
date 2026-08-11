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

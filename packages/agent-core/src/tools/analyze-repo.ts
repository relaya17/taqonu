import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { registerTool, type ToolImplementation } from "./runtime.js";

const SKIP = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "coverage",
  ".turbo",
  ".atlas",
]);
const MAX_TOP_LEVEL = 40;
const MAX_SAMPLE_FILES = 80;
const MAX_WALK_DEPTH = 8;
const MAX_SCAN_FILES = 2_000;

export interface AnalyzeRepoResult {
  readonly root: string;
  readonly topLevel: readonly string[];
  readonly apps: readonly string[];
  readonly packages: readonly string[];
  readonly fileCount: number;
  readonly sampleFiles: readonly string[];
  readonly truncated: boolean;
}

async function listDir(
  dir: string,
  signal: AbortSignal | undefined,
): Promise<readonly { readonly name: string; readonly isDirectory: boolean }[]> {
  const entries = await readdir(dir, {
    withFileTypes: true,
    ...(signal ? { signal } : {}),
  });
  return entries
    .filter((entry) => !SKIP.has(entry.name) && !entry.name.startsWith("."))
    .map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
    }));
}

async function walkFiles(
  dir: string,
  rel: string,
  depth: number,
  out: string[],
  signal: AbortSignal | undefined,
  budget: { scanned: number; truncated: boolean },
): Promise<void> {
  if (signal?.aborted) return;
  if (out.length >= MAX_SAMPLE_FILES || budget.scanned >= MAX_SCAN_FILES || depth > MAX_WALK_DEPTH) {
    budget.truncated = true;
    return;
  }
  let entries: readonly { readonly name: string; readonly isDirectory: boolean }[];
  try {
    entries = await listDir(dir, signal);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= MAX_SAMPLE_FILES || budget.scanned >= MAX_SCAN_FILES) {
      budget.truncated = true;
      return;
    }
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory) {
      await walkFiles(join(dir, entry.name), childRel, depth + 1, out, signal, budget);
      continue;
    }
    budget.scanned += 1;
    if (/\.(ts|tsx|js|jsx|json|md)$/i.test(entry.name)) {
      out.push(childRel);
    }
  }
}

const analyzeRepoTool: ToolImplementation = {
  name: "analyze_repo",
  async run(_args, context) {
    const top = await listDir(context.projectRoot, context.signal);
    const topLevel = top.slice(0, MAX_TOP_LEVEL).map((entry) =>
      entry.isDirectory ? `${entry.name}/` : entry.name,
    );
    const apps = top.find((entry) => entry.name === "apps" && entry.isDirectory)
      ? (await listDir(join(context.projectRoot, "apps"), context.signal))
          .filter((entry) => entry.isDirectory)
          .map((entry) => entry.name)
      : [];
    const packages = top.find((entry) => entry.name === "packages" && entry.isDirectory)
      ? (await listDir(join(context.projectRoot, "packages"), context.signal))
          .filter((entry) => entry.isDirectory)
          .map((entry) => entry.name)
      : [];
    const sampleFiles: string[] = [];
    const budget = { scanned: 0, truncated: top.length > MAX_TOP_LEVEL };
    await walkFiles(context.projectRoot, "", 0, sampleFiles, context.signal, budget);
    const result: AnalyzeRepoResult = {
      root: context.projectRoot,
      topLevel,
      apps,
      packages,
      fileCount: sampleFiles.length,
      sampleFiles,
      truncated: budget.truncated,
    };
    return JSON.stringify(result);
  },
};

/** Read-only workspace analysis. Idempotent. Execution still goes through executeGovernedAction. */
export function registerAnalyzeRepoTool(): void {
  registerTool(analyzeRepoTool);
}

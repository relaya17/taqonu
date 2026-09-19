/**
 * Workspace-wide replace preview and apply.
 * Exact string match only. Never writes .env / secret files. Not a regex engine.
 */
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import {
  isWorkspaceSecretFile,
  readWorkspaceFile,
  resolveUnderWorkspace,
  WORKSPACE_SKIP_DIRS,
  writeWorkspaceFile,
} from "./workspace-browser.js";

const TEXT_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|json|md|mdx|css|scss|html|htm|svg|txt|yml|yaml|toml|example|gitignore|sql|py|java|kt|go|rs|c|cc|cpp|h|hpp|cs|xml|sh|ps1|bat)$/i;
const MAX_MATCHES = 40;
const MAX_FILES = 400;
const MAX_MS = 1_500;
const MAX_DEPTH = 12;
const PREVIEW = 120;

export interface WorkspaceReplaceHit {
  readonly path: string;
  readonly line: number;
  readonly preview: string;
  readonly nextPreview: string;
}

export interface WorkspaceReplacePreview {
  readonly query: string;
  readonly replacement: string;
  readonly items: readonly WorkspaceReplaceHit[];
  readonly blocked: readonly string[];
  readonly truncated: boolean;
}

function toPosix(rel: string): string {
  return rel.split(sep).join("/");
}

function collectExactHits(
  workspaceRoot: string,
  needle: string,
): { items: WorkspaceReplaceHit[]; blocked: string[]; truncated: boolean } {
  const root = resolve(workspaceRoot);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`workspaceRoot not found: ${root}`);
  }
  const items: WorkspaceReplaceHit[] = [];
  const blocked: string[] = [];
  let truncated = false;
  let scanned = 0;
  const deadline = Date.now() + MAX_MS;

  function walk(dir: string, depth: number): void {
    if (truncated || depth > MAX_DEPTH || Date.now() > deadline) {
      truncated = true;
      return;
    }
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (truncated) return;
      if (WORKSPACE_SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      let st;
      try {
        st = lstatSync(full);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        if (name.startsWith(".")) continue;
        walk(full, depth + 1);
        continue;
      }
      if (!st.isFile()) continue;
      const rel = toPosix(relative(root, full));
      if (isWorkspaceSecretFile(rel) || isWorkspaceSecretFile(name)) {
        blocked.push(rel);
        continue;
      }
      if (name.startsWith(".") && name !== ".env.example") continue;
      if (scanned >= MAX_FILES || Date.now() > deadline) {
        truncated = true;
        return;
      }
      if (!TEXT_EXT.test(name) && st.size > 64_000) continue;
      scanned += 1;
      let content: string;
      try {
        content = readFileSync(full, "utf8");
      } catch {
        continue;
      }
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? "";
        if (!line.includes(needle)) continue;
        const preview = line.trim().slice(0, PREVIEW);
        items.push({
          path: rel,
          line: i + 1,
          preview,
          nextPreview: line.trim().split(needle).join("").length > PREVIEW
            ? line.trim().split(needle).join("").slice(0, PREVIEW)
            : line.trim().split(needle).join("").slice(0, PREVIEW),
        });
        if (items.length >= MAX_MATCHES) {
          truncated = true;
          return;
        }
      }
    }
  }

  walk(root, 0);
  return { items, blocked: [...new Set(blocked)], truncated };
}

export function previewWorkspaceReplace(
  workspaceRoot: string,
  query: string,
  replacement: string,
): WorkspaceReplacePreview {
  const needle = query.trim().slice(0, 80);
  if (needle.length < 2) {
    return { query: needle, replacement, items: [], blocked: [], truncated: false };
  }
  const found = collectExactHits(workspaceRoot, needle);
  const items = found.items.map((hit) => ({
    ...hit,
    nextPreview: hit.preview.split(needle).join(replacement).slice(0, PREVIEW),
  }));
  return {
    query: needle,
    replacement,
    items,
    blocked: found.blocked,
    truncated: found.truncated,
  };
}

export function applyWorkspaceReplace(
  workspaceRoot: string,
  query: string,
  replacement: string,
  selectedPaths: readonly string[],
): {
  readonly written: readonly { path: string; bytes: number; replacements: number }[];
  readonly skipped: readonly string[];
} {
  const needle = query.trim().slice(0, 80);
  if (needle.length < 2) {
    throw new Error("Replace query must be at least 2 characters.");
  }
  const unique = [...new Set(selectedPaths.map((path) => path.replace(/\\/g, "/")))];
  const written: { path: string; bytes: number; replacements: number }[] = [];
  const skipped: string[] = [];
  for (const path of unique) {
    resolveUnderWorkspace(workspaceRoot, path);
    if (isWorkspaceSecretFile(path)) {
      skipped.push(path);
      continue;
    }
    const view = readWorkspaceFile(workspaceRoot, path);
    if (view.readOnly || view.truncated) {
      skipped.push(path);
      continue;
    }
    if (!view.content.includes(needle)) {
      skipped.push(path);
      continue;
    }
    const replacements = view.content.split(needle).length - 1;
    const next = view.content.split(needle).join(replacement);
    const result = writeWorkspaceFile(workspaceRoot, path, next);
    written.push({ path: result.path, bytes: result.bytes, replacements });
  }
  return { written, skipped };
}

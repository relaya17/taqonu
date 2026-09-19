import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

/** Directories never shown in the read-only studio browser. */
export const WORKSPACE_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".atlas",
  ".vercel",
  "__pycache__",
  ".pnpm-store",
]);

const TEXT_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|json|md|mdx|css|scss|html|htm|svg|txt|yml|yaml|toml|env|example|gitignore|dockerignore|sql|py|java|kt|go|rs|c|cc|cpp|h|hpp|cs|xml|sh|ps1|bat|vue|svelte)$/i;

const MAX_FILE_BYTES = 400_000;
const MAX_TREE_ENTRIES = 2_500;
const MAX_DEPTH = 12;

export interface WorkspaceTreeNode {
  readonly name: string;
  readonly path: string;
  readonly kind: "dir" | "file";
  readonly size?: number;
  readonly children?: readonly WorkspaceTreeNode[];
}

export interface WorkspaceFileView {
  readonly path: string;
  readonly content: string;
  readonly bytes: number;
  readonly truncated: boolean;
  readonly languageHint: string | null;
  readonly readOnly: boolean;
}

function toPosix(rel: string): string {
  return rel.split(sep).join("/");
}

/**
 * Walk upward from `path` until an existing entry is found (itself, or the
 * nearest existing parent). Used to canonicalize a not-yet-existing write
 * target: `realpathSync` cannot resolve a path that doesn't exist yet, but
 * an ancestor directory that DOES exist can still be a symlink or Windows
 * junction pointing outside the workspace -- exactly what write-side
 * containment must catch (unlike a read, where a missing target is simply
 * a dead end and nothing is written through it).
 */
function nearestExistingAncestor(path: string): string {
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) {
      // Reached the filesystem root without finding anything real --
      // give up; the lexical check already ran, and there is nothing
      // left to canonicalize against.
      return current;
    }
    current = parent;
  }
  return current;
}

/**
 * Resolve a relative path under workspaceRoot. Throws if it escapes the root
 * (path traversal / absolute / null bytes / symlink or junction escape).
 *
 * Two stages, in order:
 *
 *  1. LEXICAL -- the checks that existed here before: rejects `..` segments
 *     and any resolved path that doesn't sit under `root` as a string.
 *  2. CANONICAL -- re-checks containment on the REAL path (`fs.realpathSync`,
 *     which resolves symlinks and, on Windows, directory junctions). The
 *     lexical check alone cannot catch `<root>/foo` being a symlink/junction
 *     that points outside `root` -- stage 1 sees a string that looks
 *     contained; the filesystem would actually read or write somewhere
 *     else. Mirrors `resolveInsideRoot()` in
 *     `packages/agent-core/src/tools/runtime.ts`, adapted for writes: the
 *     target may not exist yet (creating a new file), so the nearest
 *     *existing* ancestor is canonicalized instead of the leaf itself -- an
 *     ancestor directory can still be a symlink/junction even when the leaf
 *     filename is brand new.
 *
 * The canonical stage is skipped (falling back to the lexical result) when
 * `workspaceRoot` itself doesn't exist on disk -- callers already require it
 * to exist before reaching here, and there is nothing to canonicalize
 * against.
 */
export function resolveUnderWorkspace(
  workspaceRoot: string,
  relativePath: string,
): string {
  if (!relativePath || relativePath.includes("\0")) {
    throw new Error("Invalid path");
  }
  const root = resolve(workspaceRoot);
  const cleaned = relativePath.replace(/^[/\\]+/, "").replace(/\\/g, "/");
  if (cleaned.split("/").some((part) => part === "..")) {
    throw new Error("Path escapes workspace");
  }
  const full = resolve(root, cleaned);
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (full !== root && !full.startsWith(rootWithSep)) {
    throw new Error("Path escapes workspace");
  }

  let canonicalRoot: string;
  try {
    canonicalRoot = realpathSync(root);
  } catch {
    return full;
  }

  const existingAncestor = nearestExistingAncestor(full);
  let canonicalAncestor: string;
  try {
    canonicalAncestor = realpathSync(existingAncestor);
  } catch {
    return full;
  }
  const suffix = relative(existingAncestor, full);
  const canonicalFull =
    suffix === "" ? canonicalAncestor : resolve(canonicalAncestor, suffix);

  const canonicalRootWithSep = canonicalRoot.endsWith(sep)
    ? canonicalRoot
    : canonicalRoot + sep;
  if (
    canonicalFull !== canonicalRoot &&
    !canonicalFull.startsWith(canonicalRootWithSep)
  ) {
    throw new Error(
      "Path escapes workspace (resolves via symlink or junction outside the project root)",
    );
  }

  return full;
}

function languageHint(path: string): string | null {
  const lower = path.toLowerCase();
  if (lower.endsWith(".tsx") || lower.endsWith(".ts")) return "typescript";
  if (lower.endsWith(".jsx") || lower.endsWith(".js") || lower.endsWith(".mjs"))
    return "javascript";
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".java")) return "java";
  if (lower.endsWith(".cs")) return "csharp";
  if (lower.endsWith(".go")) return "go";
  if (lower.endsWith(".rs")) return "rust";
  if (/\.(c|cc|cpp|h|hpp)$/.test(lower)) return "cpp";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".md") || lower.endsWith(".mdx")) return "markdown";
  if (lower.endsWith(".css") || lower.endsWith(".scss")) return "css";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "yaml";
  if (lower.endsWith(".sql")) return "sql";
  return null;
}

function isProbablyText(name: string, sample: Buffer): boolean {
  if (
    TEXT_EXT.test(name) ||
    name === "Dockerfile" ||
    name === "Makefile" ||
    name === ".env.example"
  ) {
    return true;
  }
  let weird = 0;
  const n = Math.min(sample.length, 512);
  for (let i = 0; i < n; i += 1) {
    const b = sample[i]!;
    if (b === 0) return false;
    if (b < 7 || (b > 13 && b < 32)) weird += 1;
  }
  return weird / Math.max(n, 1) < 0.05;
}

/**
 * Build a bounded directory tree for the read-only studio.
 * Skips symlinks and heavy/vendor dirs. Never writes.
 */
export function listWorkspaceTree(
  workspaceRoot: string,
  opts?: { readonly maxEntries?: number; readonly maxDepth?: number },
): {
  root: string;
  tree: WorkspaceTreeNode;
  truncated: boolean;
  entryCount: number;
  readOnly: true;
} {
  const root = resolve(workspaceRoot);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`workspaceRoot not found: ${root}`);
  }

  const maxEntries = opts?.maxEntries ?? MAX_TREE_ENTRIES;
  const maxDepth = opts?.maxDepth ?? MAX_DEPTH;
  let entryCount = 0;
  let truncated = false;

  function walk(dir: string, depth: number): WorkspaceTreeNode[] {
    if (truncated || depth > maxDepth) {
      truncated = true;
      return [];
    }
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return [];
    }
    names.sort((a, b) => a.localeCompare(b));
    const nodes: WorkspaceTreeNode[] = [];
    for (const name of names) {
      if (entryCount >= maxEntries) {
        truncated = true;
        break;
      }
      if (WORKSPACE_SKIP_DIRS.has(name)) continue;
      if (name.startsWith(".") && name !== ".env.example") continue;
      const full = join(dir, name);
      let st;
      try {
        st = lstatSync(full);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      const rel = toPosix(relative(root, full));
      if (st.isDirectory()) {
        entryCount += 1;
        nodes.push({
          name,
          path: rel,
          kind: "dir",
          children: walk(full, depth + 1),
        });
      } else if (st.isFile()) {
        entryCount += 1;
        nodes.push({ name, path: rel, kind: "file", size: st.size });
      }
    }
    return nodes;
  }

  const children = walk(root, 0);
  const rootName = root.split(/[/\\]/).filter(Boolean).pop() ?? "workspace";
  return {
    root,
    tree: { name: rootName, path: "", kind: "dir", children },
    truncated,
    entryCount,
    readOnly: true,
  };
}

export interface WorkspaceSearchHit {
  readonly path: string;
  readonly line: number;
  readonly preview: string;
}

const SEARCH_MAX_MATCHES = 40;
const SEARCH_MAX_FILES = 400;
const SEARCH_MAX_MS = 1_500;
const SEARCH_PREVIEW = 120;
const SECRETISH =
  /\b(AKIA[0-9A-Z]{16}|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY|AWS_SECRET|PASSWORD\s*=)\b/i;

function isEnvSecretFile(name: string): boolean {
  return name === ".env" || /^\.env\./.test(name);
}

export function isWorkspaceSecretFile(relativePath: string): boolean {
  const name = relativePath.split(/[/\\]/).pop() ?? relativePath;
  return isEnvSecretFile(name);
}

/**
 * Bounded workspace search for Studio. Path-contained, budgeted, no symlink
 * follow, no .env contents. Does not replace Sentinel.
 */
export function searchWorkspaceFiles(
  workspaceRoot: string,
  query: string,
  opts?: {
    readonly maxMatches?: number;
    readonly maxFiles?: number;
    readonly maxMs?: number;
  },
): {
  readonly query: string;
  readonly items: readonly WorkspaceSearchHit[];
  readonly truncated: boolean;
  readonly scannedFiles: number;
} {
  const needle = query.trim().slice(0, 80).toLowerCase();
  if (needle.length < 2) {
    return { query: needle, items: [], truncated: false, scannedFiles: 0 };
  }
  const root = resolve(workspaceRoot);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`workspaceRoot not found: ${root}`);
  }
  const maxMatches = opts?.maxMatches ?? SEARCH_MAX_MATCHES;
  const maxFiles = opts?.maxFiles ?? SEARCH_MAX_FILES;
  const deadline = Date.now() + (opts?.maxMs ?? SEARCH_MAX_MS);
  const items: WorkspaceSearchHit[] = [];
  let scannedFiles = 0;
  let truncated = false;

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
      if (name.startsWith(".") && name !== ".env.example") continue;
      const full = join(dir, name);
      let st;
      try {
        st = lstatSync(full);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!st.isFile()) continue;
      if (isEnvSecretFile(name)) continue;
      if (scannedFiles >= maxFiles || Date.now() > deadline) {
        truncated = true;
        return;
      }
      if (!TEXT_EXT.test(name) && st.size > 64_000) continue;
      scannedFiles += 1;
      const rel = toPosix(relative(root, full));
      if (rel.toLowerCase().includes(needle) && items.length < maxMatches) {
        items.push({ path: rel, line: 1, preview: rel });
      }
      if (st.size > MAX_FILE_BYTES) continue;
      let text: string;
      try {
        const buf = readFileSync(full);
        if (!isProbablyText(name, buf)) continue;
        text = buf.toString("utf8");
      } catch {
        continue;
      }
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        if (items.length >= maxMatches) {
          truncated = true;
          return;
        }
        const line = lines[i] ?? "";
        if (!line.toLowerCase().includes(needle)) continue;
        items.push({
          path: rel,
          line: i + 1,
          preview: SECRETISH.test(line)
            ? "[redacted]"
            : line.trim().slice(0, SEARCH_PREVIEW),
        });
      }
    }
  }

  walk(root, 0);
  return { query: needle, items, truncated, scannedFiles };
}

/** Read a single text file under the workspace — never writes. */
export function readWorkspaceFile(
  workspaceRoot: string,
  relativePath: string,
): WorkspaceFileView {
  const full = resolveUnderWorkspace(workspaceRoot, relativePath);
  if (!existsSync(full)) {
    throw new Error(`File not found: ${relativePath}`);
  }
  const st = statSync(full);
  if (!st.isFile()) {
    throw new Error(`Not a file: ${relativePath}`);
  }
  if (st.size > MAX_FILE_BYTES * 2) {
    throw new Error(
      `File too large to open in studio (${st.size} bytes). Ask the agent to inspect it.`,
    );
  }
  const buf = readFileSync(full);
  const name = relativePath.split("/").pop() ?? relativePath;
  if (!isProbablyText(name, buf)) {
    throw new Error(
      "Binary or non-text file — Studio opens text files only.",
    );
  }
  let truncated = false;
  let content = buf.toString("utf8");
  if (buf.length > MAX_FILE_BYTES) {
    content = content.slice(0, MAX_FILE_BYTES);
    truncated = true;
  }
  return {
    path: toPosix(relativePath),
    content,
    bytes: buf.length,
    truncated,
    languageHint: languageHint(relativePath),
    readOnly: truncated,
  };
}

export interface WorkspaceFileWrite {
  readonly path: string;
  readonly bytes: number;
  readonly readOnly: false;
}

/** Write a text file under the workspace. Never escapes the root. */
export function writeWorkspaceFile(
  workspaceRoot: string,
  relativePath: string,
  content: string,
): WorkspaceFileWrite {
  if (content.length > MAX_FILE_BYTES) {
    throw new Error(
      `File too large to save in studio (${content.length} chars).`,
    );
  }
  const full = resolveUnderWorkspace(workspaceRoot, relativePath);
  const name = relativePath.split("/").pop() ?? relativePath;
  const sample = Buffer.from(content.slice(0, 512), "utf8");
  if (!isProbablyText(name, sample)) {
    throw new Error("Studio only writes text files.");
  }
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, "utf8");
  return {
    path: toPosix(relativePath),
    bytes: Buffer.byteLength(content, "utf8"),
    readOnly: false,
  };
}

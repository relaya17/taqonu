import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { registerTool, resolveInsideRoot, type ToolImplementation } from "./runtime.js";

/**
 * The read-only filesystem tools.
 *
 * These are the first three of the Tool Runtime's tool set, and they are
 * deliberately the read-only ones: `write_patch`, `run_tests` and friends
 * mutate or execute, so they carry `requiresApproval: true` in
 * `DEFAULT_TOOL_POLICIES` and cannot run until the API layer composes
 * `executeTool()` with `dispatchAgentAction()`. Shipping the read side
 * first means the runtime's containment and policy enforcement are proven
 * by something real before anything can change a file.
 *
 * Every path argument goes through `resolveInsideRoot()` in the runtime,
 * never through the tool itself — see rule 3 in `runtime.ts`.
 */

/** Refuse to stream a huge file into an LLM context; also bounds memory. */
const MAX_FILE_BYTES = 256 * 1024;
const MAX_DIR_ENTRIES = 500;
const MAX_SEARCH_MATCHES = 200;

/** Directories never worth walking, and whose contents are not source. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
]);

function requireString(args: Readonly<Record<string, unknown>>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`"${key}" is required and must be a non-empty string`);
  }
  return value;
}

export const readFileTool: ToolImplementation = {
  name: "fs.read_file",
  async run(args, context) {
    const resolved = resolveInsideRoot(context.projectRoot, requireString(args, "path"));
    if (!resolved.ok) throw new Error(resolved.reason);

    const info = await stat(resolved.path);
    if (!info.isFile()) throw new Error("path is not a file");
    if (info.size > MAX_FILE_BYTES) {
      throw new Error(
        `file is ${info.size} bytes, above the ${MAX_FILE_BYTES}-byte read limit`,
      );
    }
    return await readFile(resolved.path, "utf8");
  },
};

export const readDirectoryTool: ToolImplementation = {
  name: "fs.read_directory",
  async run(args, context) {
    const resolved = resolveInsideRoot(context.projectRoot, requireString(args, "path"));
    if (!resolved.ok) throw new Error(resolved.reason);

    const info = await stat(resolved.path);
    if (!info.isDirectory()) throw new Error("path is not a directory");

    const entries = await readdir(resolved.path, { withFileTypes: true });
    const listed = entries
      .filter((entry) => !SKIP_DIRS.has(entry.name))
      .slice(0, MAX_DIR_ENTRIES)
      .map((entry) => `${entry.isDirectory() ? "dir " : "file"}  ${entry.name}`)
      .sort();

    const truncated = entries.length > MAX_DIR_ENTRIES;
    // Never silently truncate — an agent that cannot tell a complete listing
    // from a clipped one will reason as if it saw everything.
    return truncated
      ? `${listed.join("\n")}\n… truncated at ${MAX_DIR_ENTRIES} of ${entries.length} entries`
      : listed.join("\n");
  },
};

async function* walk(dir: string, root: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // unreadable directory is skipped, not fatal
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full, root);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

export const searchRepoTool: ToolImplementation = {
  name: "fs.search_repo",
  async run(args, context) {
    const query = requireString(args, "query");
    const root = resolveInsideRoot(context.projectRoot, ".");
    if (!root.ok) throw new Error(root.reason);

    // Literal substring search, not a caller-supplied regex: an agent-chosen
    // pattern is untrusted input, and a pathological one is a denial-of-
    // service against this process (catastrophic backtracking). The runtime
    // timeout bounds it too, but not constructing the hazard is better than
    // racing it.
    const needle = query.toLowerCase();
    const matches: string[] = [];

    for await (const file of walk(root.path, root.path)) {
      if (matches.length >= MAX_SEARCH_MATCHES) break;
      let content: string;
      try {
        const info = await stat(file);
        if (info.size > MAX_FILE_BYTES) continue;
        content = await readFile(file, "utf8");
      } catch {
        continue; // binary/unreadable file
      }
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? "";
        if (line.toLowerCase().includes(needle)) {
          // Normalize to forward slashes: a tool's output is consumed by an
          // agent and compared across runs, so it must not change shape
          // depending on the host OS ("src/a.ts" vs "src\\a.ts").
          const rel = relative(root.path, file).split(sep).join("/");
          matches.push(`${rel}:${i + 1}: ${line.trim().slice(0, 200)}`);
          if (matches.length >= MAX_SEARCH_MATCHES) break;
        }
      }
    }

    if (matches.length === 0) return `No match for "${query}".`;
    const header =
      matches.length >= MAX_SEARCH_MATCHES
        ? `${matches.length} matches (capped — more may exist):`
        : `${matches.length} match(es):`;
    return `${header}\n${matches.join("\n")}`;
  },
};

/** Register the read-only filesystem tools. Idempotent. */
export function registerFilesystemTools(): void {
  registerTool(readFileTool);
  registerTool(readDirectoryTool);
  registerTool(searchRepoTool);
}

import { readFile, readdir, stat } from "node:fs/promises";
import type { Dirent, PathLike, StatOptions, Stats } from "node:fs";
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
 * never through the tool itself.
 *
 * SECURITY: the tools are NOT exported. They are private constants reachable
 * only through `registerTool()` and `executeTool()`, so no caller can bypass
 * the runtime's policy enforcement by importing one directly.
 *
 * CANCELLATION: the `AbortSignal` on `ToolExecutionContext` is passed into
 * every fs call and checked between loop iterations, so a policy timeout
 * actually cancels in-flight work instead of orphaning it.
 */

/**
 * `node:fs/promises` accepts a cancellation `signal` on `stat`, `readFile`
 * and `readdir` (Node 15+), but @types/node does not declare it on their
 * option bags. The three bindings below restate the real runtime signatures
 * once, so the six call sites downstream are type-checked normally: pass a
 * wrong path type, drop `withFileTypes`, or mistype a result and the
 * compiler still objects. No `any`, no suppressions.
 *
 * `StatAbortableOptions` keeps `StatOptions & { bigint?: false }` for two
 * reasons: an option bag holding only `signal` shares no property with
 * `StatOptions` and so trips TypeScript's weak-type check, and pinning
 * `bigint` to `false` fixes the return as `Stats` rather than `BigIntStats`.
 */
interface AbortableFsOption {
  readonly signal?: AbortSignal | undefined;
}
type StatAbortableOptions = StatOptions & { bigint?: false | undefined } & AbortableFsOption;

const statAbortable: (path: PathLike, options: StatAbortableOptions) => Promise<Stats> = stat;

const readFileUtf8Abortable: (
  path: PathLike,
  encoding: "utf8",
  options: AbortableFsOption,
) => Promise<string> = readFile;

const readdirWithTypesAbortable: (
  path: PathLike,
  options: AbortableFsOption & { withFileTypes: true },
) => Promise<Dirent[]> = readdir;

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

const readFileTool: ToolImplementation = {
  name: "fs.read_file",
  async run(args, context) {
    const resolved = resolveInsideRoot(context.projectRoot, requireString(args, "path"));
    if (!resolved.ok) throw new Error(resolved.reason);

    const info = await statAbortable(resolved.path, { signal: context.signal });
    if (!info.isFile()) throw new Error("path is not a file");
    if (info.size > MAX_FILE_BYTES) {
      throw new Error(
        `file is ${info.size} bytes, above the ${MAX_FILE_BYTES}-byte read limit`,
      );
    }
    return await readFileUtf8Abortable(resolved.path, "utf8", { signal: context.signal });
  },
};

const readDirectoryTool: ToolImplementation = {
  name: "fs.read_directory",
  async run(args, context) {
    const resolved = resolveInsideRoot(context.projectRoot, requireString(args, "path"));
    if (!resolved.ok) throw new Error(resolved.reason);

    const info = await statAbortable(resolved.path, { signal: context.signal });
    if (!info.isDirectory()) throw new Error("path is not a directory");

    const entries = await readdirWithTypesAbortable(resolved.path, {
      withFileTypes: true,
      signal: context.signal,
    });
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

async function* walk(dir: string, root: string, signal?: AbortSignal): AsyncGenerator<string> {
  // Check for cancellation before descending into the directory.
  if (signal?.aborted) return;

  let entries: Dirent[];
  try {
    entries = await readdirWithTypesAbortable(dir, { withFileTypes: true, signal });
  } catch {
    return; // an unreadable directory is skipped, not fatal
  }
  for (const entry of entries) {
    // Cooperative cancellation: check the signal between iterations.
    if (signal?.aborted) return;

    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full, root, signal);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

const searchRepoTool: ToolImplementation = {
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

    for await (const file of walk(root.path, root.path, context.signal)) {
      // Cooperative cancellation: check the signal between files.
      if (context.signal?.aborted) break;

      if (matches.length >= MAX_SEARCH_MATCHES) break;
      let content: string;
      try {
        const info = await statAbortable(file, { signal: context.signal });
        if (info.size > MAX_FILE_BYTES) continue;
        content = await readFileUtf8Abortable(file, "utf8", { signal: context.signal });
      } catch {
        continue; // binary or unreadable file
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

import { relative, resolve, sep } from "node:path";
import { resolveInsideRoot } from "./runtime.js";

/**
 * Canonical resource instance for governed tool execution.
 * Not entity/action class, not artifact bytes, not the sandbox root.
 */
export type CanonicalTarget =
  | { readonly kind: "path"; readonly value: string }
  | { readonly kind: "query"; readonly value: string }
  | { readonly kind: "workspace"; readonly value: "." };

export type GovernedTargetResolution =
  | { readonly ok: true; readonly target: CanonicalTarget }
  | { readonly ok: false; readonly reason: string };

function fail(reason: string): { readonly ok: false; readonly reason: string } {
  return { ok: false, reason };
}

function trimmedLocator(
  args: Readonly<Record<string, unknown>>,
  key: string,
): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly reason: string } {
  const raw = args[key];
  if (typeof raw !== "string") {
    return fail(`"${key}" is required and must be a non-empty string`);
  }
  const value = raw.trim();
  if (value.length === 0) {
    return fail(`"${key}" is required and must be a non-empty string`);
  }
  return { ok: true, value };
}

function canonicalPathTarget(
  projectRoot: string,
  candidate: string,
): GovernedTargetResolution {
  const resolved = resolveInsideRoot(projectRoot, candidate);
  if (!resolved.ok) return fail(resolved.reason);

  const rootAbs = resolve(projectRoot);
  const rel = relative(rootAbs, resolved.path);
  const posix = rel === "" ? "." : rel.split(sep).join("/");
  if (posix.includes("\\") || posix.startsWith("/")) {
    return fail("path is not a portable project-relative locator");
  }
  if (posix !== ".") {
    const segments = posix.split("/");
    if (segments.some((part) => part === "" || part === "." || part === "..")) {
      return fail("path is not a portable project-relative locator");
    }
  }
  return { ok: true, target: { kind: "path", value: posix } };
}

/**
 * Closed extractors for the approved tool set. Extra `toolArgs` keys are ignored.
 * Unknown tools fail closed — they are not given a workspace default.
 */
export function extractGovernedTarget(
  toolName: string,
  toolArgs: Readonly<Record<string, unknown>>,
  projectRoot: string,
): GovernedTargetResolution {
  switch (toolName) {
    case "fs.read_file":
    case "fs.read_directory": {
      const path = trimmedLocator(toolArgs, "path");
      if (!path.ok) return path;
      return canonicalPathTarget(projectRoot, path.value);
    }
    case "fs.search_repo":
    case "knowledge_search": {
      const query = trimmedLocator(toolArgs, "query");
      if (!query.ok) return query;
      return { ok: true, target: { kind: "query", value: query.value } };
    }
    case "analyze_repo":
      return { ok: true, target: { kind: "workspace", value: "." } };
    default:
      return fail(`No governed target extractor for "${toolName}"`);
  }
}

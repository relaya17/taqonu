import { isAbsolute, normalize, relative, resolve, sep } from "node:path";
import type { ToolPolicy } from "@atlas/shared";
import { getToolPolicy } from "../policies/tool-policies.js";
import { detectSecrets } from "../secrets/detector.js";

/**
 * Tool Runtime — the layer that actually ENFORCES `ToolPolicy` at execution
 * time.
 *
 * `DEFAULT_TOOL_POLICIES` (policies/tool-policies.ts) has described each tool's
 * risk, approval requirement, timeout and secrets access since early on —
 * but nothing consulted it when a tool ran, because no tool ever ran. It
 * was an allow-list on paper. This is the runtime that makes it binding:
 * every tool invocation goes through `executeTool()`, and there is no other
 * path to a registered tool's implementation.
 *
 * Design rules, in the order they matter:
 *
 *  1. **Fail closed.** A tool with no policy entry is DENIED, never allowed
 *     "because nobody said no". Adding a tool implementation without also
 *     adding its policy therefore makes it unreachable rather than
 *     ungoverned — the safe direction to fail in.
 *  2. **The runtime never approves.** When a policy says
 *     `requiresApproval`, `executeTool()` returns `APPROVAL_REQUIRED` and
 *     does NOT run the tool. It deliberately does not call the approval
 *     service itself: routing to Policy/Risk/Approval already lives exactly
 *     once, in `apps/api/src/services/agent-dispatch-guard.ts`
 *     (`dispatchAgentAction`). Duplicating that decision here would create
 *     a second, divergent gate — the precise failure this codebase's own
 *     audit history keeps finding. The caller in `apps/api` composes the
 *     two.
 *  3. **Containment is checked here, not in the tool.** Every filesystem
 *     tool receives an already-validated absolute path inside the project
 *     root. A tool implementation cannot be trusted to police its own
 *     arguments, because the whole point is that an agent chose them.
 *  4. **Timeouts are enforced by the runtime**, not requested politely of
 *     the tool.
 */

export type ToolExecutionOutcome =
  | { readonly status: "OK"; readonly output: string; readonly durationMs: number }
  | { readonly status: "DENIED"; readonly reason: string }
  | { readonly status: "APPROVAL_REQUIRED"; readonly policy: ToolPolicy }
  | { readonly status: "ERROR"; readonly reason: string; readonly durationMs: number }
  | { readonly status: "TIMEOUT"; readonly timeoutMs: number };

export interface ToolExecutionContext {
  /**
   * Absolute path every filesystem argument must resolve inside. Supplied
   * by the caller (the API layer resolving the tenant's project), never by
   * the agent — an agent choosing its own sandbox root is the same class of
   * mistake as an agent choosing its own trust level.
   */
  readonly projectRoot: string;
  /** Project id used against `ToolPolicy.allowedProjects` when that list is non-empty. */
  readonly projectId?: string | null;
}

export interface ToolImplementation {
  readonly name: string;
  run(
    args: Readonly<Record<string, unknown>>,
    context: ToolExecutionContext,
  ): Promise<string>;
}

const registry = new Map<string, ToolImplementation>();

/** Register a tool implementation. A tool with no `ToolPolicy` stays unreachable (rule 1). */
export function registerTool(tool: ToolImplementation): void {
  registry.set(tool.name, tool);
}

/** Test seam — mirrors the reset helpers other services in this repo expose. */
export function resetToolRegistryForTests(): void {
  registry.clear();
}

export function listRegisteredTools(): readonly string[] {
  return [...registry.keys()].sort();
}

/**
 * Resolve an agent-supplied path and prove it stays inside `projectRoot`.
 *
 * Rejects absolute paths and any traversal that escapes the root. The check
 * is done on the RESOLVED, NORMALIZED path — comparing raw strings would be
 * defeated by `foo/../../etc/passwd`, and a `startsWith(root)` test alone
 * would wrongly accept a sibling directory whose name merely begins with
 * the root (`/srv/app-evil` vs `/srv/app`), which is why this compares path
 * segments via `relative()` instead.
 */
export function resolveInsideRoot(
  projectRoot: string,
  candidate: string,
): { ok: true; path: string } | { ok: false; reason: string } {
  if (typeof candidate !== "string" || candidate.trim().length === 0) {
    return { ok: false, reason: "path must be a non-empty string" };
  }
  if (isAbsolute(candidate)) {
    return { ok: false, reason: "absolute paths are not allowed; use a project-relative path" };
  }
  const root = resolve(projectRoot);
  const target = resolve(root, normalize(candidate));
  const rel = relative(root, target);
  if (rel === "") return { ok: true, path: target };
  if (rel.startsWith("..") || rel.split(sep).includes("..")) {
    return { ok: false, reason: "path escapes the project root" };
  }
  return { ok: true, path: target };
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  return new Promise((resolvePromise) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolvePromise({ timedOut: true });
    }, timeoutMs);
    void promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolvePromise({ timedOut: false, value });
      },
      (err: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // Rethrow shape preserved for the caller's catch below.
        resolvePromise({ timedOut: false, value: Promise.reject(err) as unknown as T });
      },
    );
  });
}

/**
 * The ONE entry point to a governed tool. There is deliberately no export
 * that hands a caller a `ToolImplementation` directly.
 */
export async function executeTool(
  toolName: string,
  args: Readonly<Record<string, unknown>>,
  context: ToolExecutionContext,
): Promise<ToolExecutionOutcome> {
  // Rule 1 — fail closed on an unknown/unpoliced tool, BEFORE looking at
  // whether an implementation happens to exist.
  const policy = getToolPolicy(toolName);
  if (!policy) {
    return {
      status: "DENIED",
      reason: `No ToolPolicy for "${toolName}". Tools without an explicit policy are denied, not allowed by default.`,
    };
  }

  const impl = registry.get(toolName);
  if (!impl) {
    return { status: "DENIED", reason: `Tool "${toolName}" has a policy but no registered implementation.` };
  }

  // An empty `allowedProjects` means "no project restriction" — the shape
  // every entry in DEFAULT_TOOL_POLICIES currently uses. A non-empty list
  // is a real restriction and is enforced.
  if (policy.allowedProjects.length > 0) {
    const projectId = context.projectId ?? null;
    if (projectId === null || !policy.allowedProjects.includes(projectId)) {
      return {
        status: "DENIED",
        reason: `Tool "${toolName}" is restricted to specific projects and "${projectId ?? "none"}" is not one of them.`,
      };
    }
  }

  // Rule 2 — the runtime reports the requirement; it never satisfies it.
  if (policy.requiresApproval) {
    return { status: "APPROVAL_REQUIRED", policy };
  }

  const startedAt = Date.now();
  let raced: { timedOut: false; value: string } | { timedOut: true };
  try {
    raced = await withTimeout(impl.run(args, context), policy.timeoutMs);
  } catch (err) {
    return {
      status: "ERROR",
      reason: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    };
  }

  if (raced.timedOut) {
    return { status: "TIMEOUT", timeoutMs: policy.timeoutMs };
  }

  let output: string;
  try {
    output = await Promise.resolve(raced.value);
  } catch (err) {
    return {
      status: "ERROR",
      reason: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    };
  }

  // A READ tool can still surface a credential it happened to read — a
  // `.env` committed to the repo is the obvious case. `secretsAccess: "NONE"`
  // means "this tool must not yield secret values", so that is enforced on
  // the OUTPUT, not merely assumed of the tool.
  if (policy.secretsAccess === "NONE" && detectSecrets(output).length > 0) {
    return {
      status: "DENIED",
      reason: `Tool "${toolName}" produced output containing a detected secret and its policy grants secretsAccess: "NONE".`,
    };
  }

  return { status: "OK", output, durationMs: Date.now() - startedAt };
}

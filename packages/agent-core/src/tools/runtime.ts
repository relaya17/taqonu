import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
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
 *     Containment is checked twice: once lexically (fast, catches `../`
 *     and absolute-path attempts before touching disk) and once on the
 *     REAL, canonical path when the root exists on disk (catches a
 *     symlink or, on Windows, a directory junction anywhere along the
 *     path that resolves outside `projectRoot` — the lexical check alone
 *     cannot see this, since it never asks the filesystem what a path
 *     actually points to). See `03-ATLAS_ENGINEERING_RUNTIME_SPEC.md` §2
 *     for the incident this closes (verified gap, found + fixed 2026-08-24).
 *  4. **Timeouts are enforced by the runtime, and now actually cancel the
 *     work** — not just stop waiting for it. `executeTool()` hands every
 *     `ToolImplementation.run()` call an `AbortSignal` via
 *     `ToolExecutionContext.signal`; when the policy timeout fires, that
 *     signal is aborted. Implementations that loop (like `fs.search_repo`'s
 *     directory walk) must check it between iterations, and Node's
 *     `fs/promises` calls that accept a `signal` option should be passed
 *     one so an in-flight read is cut short rather than running to
 *     completion after the caller has already moved on. Previously this
 *     was a `Promise.race` that only stopped *waiting* — the underlying
 *     work kept running as an orphan. See
 *     `03-ATLAS_ENGINEERING_RUNTIME_SPEC.md` §3 for the incident this
 *     closes (verified gap, found + fixed 2026-08-24).
 */

/**
 * ExecutionCorrelation: the immutable chain connecting all layers of execution.
 *
 * This object is created at the Runtime layer and passed through all subsequent
 * layers (verification, audit). It ensures every decision point is traceable.
 *
 * Ownership rules (architectural enforcement):
 *  - Agent creates: agentId, proposalId (ONLY)
 *  - Governance creates: governanceDecisionId, authorizationId (ONLY)
 *  - Runtime creates: executionId, toolCallId (ONLY)
 *  - Verification creates: verificationId (ONLY)
 *  - Audit creates: auditEventId (ONLY)
 *
 * No layer may create IDs outside its domain. This is not validation; it is
 * architectural impossibility enforced by type system + code organization.
 */
export interface ExecutionCorrelation {
  readonly requestId: string; // request boundary
  readonly agentId: string; // who acted
  /**
   * What was proposed, or `null` for a direct execution that did not
   * originate from an `AgentProposal` — the proposal layer above
   * `dispatchAgentAction()` is a gate only today and mints no proposal.
   *
   * The three nullable fields below keep their KEY required on purpose. An
   * explicit `null` records "this path produced none"; an omitted key means
   * the caller lost track of it. An auditor has to be able to tell those
   * apart, and a chain that cannot distinguish them is not a chain.
   */
  readonly proposalId: string | null;
  /** What was decided — `null` when the gate recorded no audit entry. */
  readonly governanceDecisionId: string | null;
  /** What was authorized — `null` when the action needed no approval. */
  readonly authorizationId: string | null;
  readonly executionId: string;         // execution instance
  readonly toolCallId: string;          // tool invocation instance
  readonly verificationId?: string;     // verification instance (added by verification layer)
  readonly auditEventId?: string;       // audit event instance (added by audit layer)
}

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
  /**
   * Cooperative cancellation signal, set by `executeTool()` when it starts
   * the policy timeout clock. A `ToolImplementation` that does I/O in a
   * loop should check `signal?.aborted` between iterations, and should pass
   * `signal` into any `node:fs/promises` call that accepts one. Callers of
   * `executeTool()` never set this themselves — it is always supplied by
   * the runtime, never by an agent or an API caller.
   */
  readonly signal?: AbortSignal;
  /**
   * Execution correlation chain, created by the Runtime layer at the start
   * of `executeTool()`. This object is immutable and passed through to
   * verification and audit layers. It enables full reconstruction of the
   * execution lifecycle.
   */
  readonly correlation: ExecutionCorrelation;
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

function escapesRoot(root: string, target: string): boolean {
  const rel = relative(root, target);
  if (rel === "") return false;
  return rel.startsWith("..") || rel.split(sep).includes("..");
}

/**
 * Resolve an agent-supplied path and prove it stays inside `projectRoot`.
 *
 * Two checks, in order:
 *
 *  1. LEXICAL — rejects absolute paths and any traversal that escapes the
 *     root, on the resolved/normalized string. Comparing raw strings would
 *     be defeated by `foo/../../etc/passwd`, and a `startsWith(root)` test
 *     alone would wrongly accept a sibling directory whose name merely
 *     begins with the root (`/srv/app-evil` vs `/srv/app`), which is why
 *     this compares path segments via `relative()` instead.
 *  2. CANONICAL — re-checks containment on the REAL path (`fs.realpathSync`,
 *     which resolves symlinks and, on Windows, directory junctions). The
 *     lexical check alone cannot catch `<root>/foo` being a symlink/junction
 *     that points outside `root` — check 1 sees a string that looks
 *     contained; the filesystem would actually read from somewhere else.
 *
 * The canonical check is skipped (falling back to the lexical result) when
 * `projectRoot` itself doesn't exist on disk — nothing to canonicalize
 * against, and any real read will fail naturally on its own stat/readdir
 * call regardless. This also keeps pure path-arithmetic unit tests (which
 * exercise this function against synthetic, non-existent roots) working
 * unchanged.
 *
 * When the target doesn't exist yet, it likewise cannot itself be a
 * symlink escaping the root (nothing there to be one) — the lexical check
 * already covers that case, so a missing target also falls back to the
 * lexical result rather than being rejected outright.
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
  if (escapesRoot(root, target)) {
    return { ok: false, reason: "path escapes the project root" };
  }

  let canonicalRoot: string;
  try {
    canonicalRoot = realpathSync(root);
  } catch {
    // projectRoot doesn't exist on disk — nothing to canonicalize against.
    return { ok: true, path: target };
  }

  let canonicalTarget: string;
  try {
    canonicalTarget = realpathSync(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: true, path: target };
    }
    return {
      ok: false,
      reason: `failed to resolve real path: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (escapesRoot(canonicalRoot, canonicalTarget)) {
    return { ok: false, reason: "path resolves (via symlink or junction) outside the project root" };
  }

  return { ok: true, path: target };
}

/**
 * Races `promise` against `timeoutMs`. On timeout, aborts `controller` so
 * the underlying work is actually told to stop — not just abandoned. The
 * promise itself may still take a moment to unwind after abort (an
 * in-flight `fs/promises` call rejects with an AbortError almost
 * immediately; a cooperative loop stops at its next `signal.aborted`
 * check), but nothing here waits for that unwind — the TIMEOUT result
 * returns to the caller as soon as the clock fires, same as before.
 */
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  controller: AbortController,
): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  return new Promise((resolvePromise) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      controller.abort();
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
 *
 * Runtime creates executionId and toolCallId here, completing the correlation
 * chain that started upstream (governance layer). This ensures:
 * - Every tool invocation is traceable
 * - No tool can be invoked without a valid correlation chain
 * - Execution cannot be replayed (fresh executionId per call)
 *
 * Invariant 10 enforcement: Every protected execution must be reconstructable
 * from its correlation chain. This function verifies the chain is complete
 * before execution proceeds.
 */
export async function executeTool(
  toolName: string,
  args: Readonly<Record<string, unknown>>,
  context: ToolExecutionContext,
): Promise<ToolExecutionOutcome> {
  // Invariant 10: Validate correlation chain is complete before proceeding
  // A missing ID means the chain is broken. Execution must be denied.
  //
  // Narrowed from "all five IDs must be non-empty". Two of them name WHO
  // acted and WITHIN WHICH request; neither has a legitimate absent case, so
  // a call that cannot supply them cannot be traced and is denied.
  const requiredIds = ["requestId", "agentId"] as const;

  // The other three have real absent cases — a direct execution has no
  // proposal, a gate may record no audit entry, an action may need no
  // approval. Their KEY is still mandatory: `null` is an assertion that the
  // path produced none, which is auditable; a missing key is an oversight,
  // which is not. Requiring the key is what keeps this a control rather
  // than a formality satisfied by whatever the caller happened to pass.
  const nullableIds = ["proposalId", "governanceDecisionId", "authorizationId"] as const;

  // The chain must exist at all before its fields can be read. A caller can
  // reach this boundary from untyped code — a JSON body at the API layer, a
  // JS test — and omit it entirely. That is the most broken chain there is,
  // so it has to deny like every other break rather than throw: a guard that
  // crashes on malformed input is a guard that stopped guarding.
  if (context.correlation === undefined || context.correlation === null) {
    return {
      status: "DENIED",
      reason: "Correlation chain is missing entirely. Execution cannot be traced.",
    };
  }

  for (const idField of requiredIds) {
    const value = context.correlation[idField];
    if (typeof value !== "string" || value.length === 0) {
      return {
        status: "DENIED",
        reason: `Correlation chain is incomplete: missing or empty ${idField}. Execution cannot be traced.`,
      };
    }
  }

  for (const idField of nullableIds) {
    if (!(idField in context.correlation)) {
      return {
        status: "DENIED",
        reason: `Correlation chain is incomplete: ${idField} was omitted. Pass null to record that this path produced none.`,
      };
    }
    const value = context.correlation[idField];
    if (value !== null && (typeof value !== "string" || value.length === 0)) {
      return {
        status: "DENIED",
        reason: `Correlation chain is incomplete: ${idField} must be a non-empty string or null. Execution cannot be traced.`,
      };
    }
  }

  // Runtime creates execution IDs at the start. These are immutable and will
  // be carried through verification and audit layers.
  const executionId = randomUUID();
  const toolCallId = randomUUID();

  // Rule 1 — fail closed on an unknown/unpoliced tool, BEFORE looking at
  // whether an implementation happens to exist.
  const policy = getToolPolicy(toolName);
  if (!policy) {
    return {
      status: "DENIED",
      reason: `No ToolPolicy for "${toolName}". Tools without an explicit policy are denied, not allowed by default.`,
    };
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
  //
  // This runs BEFORE the registry lookup on purpose. Whether a tool has a
  // registered implementation is internal state, and disclosing it to a
  // caller that has not been approved yet leaks the shape of the runtime.
  // The policy is the public contract: an approval-gated tool answers
  // APPROVAL_REQUIRED whether or not it happens to be implemented.
  //
  // The project restriction above stays ahead of this check — a tool barred
  // from the caller's project is denied outright, never routed to a human.
  if (policy.requiresApproval) {
    return { status: "APPROVAL_REQUIRED", policy };
  }

  const impl = registry.get(toolName);
  if (!impl) {
    return { status: "DENIED", reason: `Tool "${toolName}" has a policy but no registered implementation.` };
  }

  // Rule 4 — a fresh controller per call, handed to the implementation via
  // context.signal so a timeout can actually cancel in-flight work rather
  // than only stop waiting for it.
  const controller = new AbortController();

  // Complete the correlation chain: add executionId and toolCallId, thread
  // the complete chain to the tool implementation.
  const runContext: ToolExecutionContext = {
    ...context,
    signal: controller.signal,
    correlation: {
      ...context.correlation,
      executionId,
      toolCallId,
    },
  };

  const startedAt = Date.now();
  let raced: { timedOut: false; value: string } | { timedOut: true };
  try {
    raced = await withTimeout(impl.run(args, runContext), policy.timeoutMs, controller);
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

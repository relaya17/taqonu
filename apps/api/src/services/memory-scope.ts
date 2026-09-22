/**
 * Canonical memory-ownership scoping primitives (Defect #2 remediation).
 *
 * SECURITY INVARIANT: a memory-derived value that is meant to reflect a
 * single caller's own data must never be computed from an unscoped
 * memory/project read. Concretely: every function here that touches
 * `osStore.getMemories()` takes `ownerId` as a REQUIRED parameter -- there
 * is no unscoped variant exposed by this module. A caller cannot
 * accidentally reproduce Defect #2 (`GET /api/v1/ai/providers` summing
 * `osStore.getMemories(p.id)` with no owner argument across every project
 * of every tenant) by using these primitives, because the type signature
 * does not allow omitting the owner.
 *
 * `ownerId` must always be resolved server-side by the caller (via
 * `requireUser`, `resolveRequestIdentity`, or `resolveCloudIdentity`'s
 * soft/stub-owner fallback for intentionally anonymous-tolerant routes) --
 * never taken from client-supplied input. This module does not resolve
 * identity itself, so it stays usable from both hard-authenticated routes
 * and soft-identity routes without embedding an authentication policy
 * inside a data-access helper.
 *
 * Intentionally SYSTEM-WIDE aggregation (e.g. an operator dashboard
 * summing every tenant's memory count) is a different, already-authorized
 * concern -- see `buildKnowledgeGraphSummary()` in `platform-watchdog.ts`,
 * gated by `requireOperator` at its one call site
 * (`GET /api/v1/admin/knowledge-graph`). That path is deliberately left
 * unchanged: it is explicit and authorized, not an accidental default.
 */
import { osStore } from "../store/os-store.js";

/**
 * Count of a caller's own memories matching `source`, summed across every
 * project the caller owns plus the shared "global" bucket scoped to the
 * same owner. `ownerId` is mandatory and is passed through unchanged to
 * every `osStore.getMemories()` call -- it can never be omitted or widened
 * to "every tenant" from inside this function.
 */
export function countOwnedMemoriesBySource(input: {
  readonly ownerId: string;
  readonly source: string;
}): number {
  osStore.ensureLoaded();
  let count = 0;
  count += osStore
    .getMemories("global", input.ownerId)
    .filter((m) => m.source === input.source).length;
  for (const project of osStore.listProjects()) {
    count += osStore
      .getMemories(project.id, input.ownerId)
      .filter((m) => m.source === input.source).length;
  }
  return count;
}

import { FABRIC_AGENT_IDS, type FabricAgentId } from "@atlas/shared";

/**
 * Runtime enable/disable overlay for the Fabric Agent Registry — the
 * "Modular Add/Remove/Replace/Configure Architecture" roadmap item.
 *
 * `FABRIC_AGENT_CATALOG` (`@atlas/shared/constants/agents.ts`) and
 * `buildRegisteredAgent()`/`listRegisteredAgents()` (`./registry.ts`) stay a
 * pure, static, compile-time catalog — this module never mutates them. It is
 * a thin overlay: a runtime `Map` recording which catalog agent ids are
 * currently enabled, consulted by callers via `isAgentEnabled()` before they
 * dispatch to a given agent. Nothing in `./registry.ts`/`../kernel/run.ts`
 * etc. reads this map today — wiring an actual dispatch-time enforcement
 * point is left to those (currently concurrently edited) call sites.
 *
 * SCOPE LIMIT (honest, deliberate — not an oversight, same pattern as the
 * approval workflow's in-memory store, see
 * `apps/api/src/services/approvals.ts`): this is an in-memory, process-local
 * `Map`. It does not survive a process restart and is not shared across
 * multiple API instances/replicas. A multi-process deployment would need
 * this state moved into a real datastore (e.g. `osStore` or a database
 * table) so every replica observes the same enabled/disabled state.
 */
const agentEnabledState = new Map<FabricAgentId, boolean>();

/**
 * Agents that structurally cannot be disabled at runtime, because other
 * already-shipped, already-tested code paths unconditionally depend on them
 * being present in every plan/run. This is real dependency evidence from the
 * current source, not a guess:
 *
 * - `ORCHESTRATOR` is hardcoded as the mandatory first step of every plan:
 *   - `packages/agent-core/src/orchestrator/plan.ts:34` — `planAgentWork()`
 *     always unshifts an `agentId: "ORCHESTRATOR"` step before any
 *     specialists are added, unconditionally, for every request.
 *   - `packages/agent-core/src/kernel/task-plan.ts:40` — `createTaskPlan()`
 *     seeds `requiredAgents` with `["ORCHESTRATOR"]` before anything else,
 *     and `task-plan.ts:86` always emits an `agentId: "ORCHESTRATOR"`
 *     subtask (`t1_orchestrator`) with `parallelGroup: 0`.
 *   - `packages/agent-core/src/router/genius.ts:13` seeds every route's
 *     agent set with `"ORCHESTRATOR"` before any specialist matching runs.
 *   - `packages/agent-core/src/orchestrator/dispatch.ts:44,48,63` special-
 *     cases `"ORCHESTRATOR"` for run status/summary/epistemicState, and
 *     `packages/agent-core/src/kernel/run.ts:201,215` unconditionally
 *     records an `agentId: "ORCHESTRATOR"` evidence item + simulation event
 *     for every kernel run.
 *   - `packages/agent-core/src/judge/evaluate.ts:33` exempts only
 *     `"ORCHESTRATOR"` runs from the "must have evidenceRefs" Judge check —
 *     i.e. Judge itself assumes an Orchestrator run is always present and
 *     structurally different from specialist runs.
 *   Disabling it would silently break `POST /api/v1/kernel/plan`,
 *   `POST /api/v1/kernel/run`, `POST /api/v1/agents/plan`, and
 *   `POST /api/v1/agents/dispatch` — all already-tested, already-shipped
 *   endpoints that assume an Orchestrator step always exists.
 *
 * - `JUDGE` is structurally woven into the same pipelines as the mandatory
 *   belief-gate step for risk-bearing work:
 *   - `packages/agent-core/src/orchestrator/plan.ts:60-76` — always appends
 *     (and re-sorts to last) a `JUDGE` step unless one is already present.
 *   - `packages/agent-core/src/kernel/task-plan.ts:34-38,66-79` — adds
 *     `JUDGE` for `HIGH`/`CRITICAL` risk requests and gives it a dedicated
 *     `judgeTask` in the final parallel group.
 *   - `packages/agent-core/src/kernel/run.ts:224-227,250-253` — the P1-P7
 *     `runIntelligenceKernel()` pipeline explicitly *skips* `JUDGE` during
 *     the specialists loop (P5, "skip JUDGE here; Judge is P6") so it can
 *     run it separately as its own required phase (P6), i.e. Judge is a
 *     first-class pipeline phase, not an optional specialist.
 *   - `packages/agent-core/src/router/genius.ts:49,76` adds `JUDGE` as
 *     required for legal claims and for any multi-specialist/high-risk
 *     route ("Judge required for belief decision").
 *   - `packages/agent-core/src/orchestrator/dispatch.ts:116` filters `JUDGE`
 *     out of the normal per-group dispatch loop because it is handled as
 *     its own required stage, not an ordinary parallel specialist.
 *   Disabling it would silently remove the belief/evidence gate from every
 *   HIGH/CRITICAL-risk plan and from the required P6 phase of every kernel
 *   run — exactly the kind of silent breakage the roadmap's dependency
 *   check is meant to prevent.
 */
export const CORE_AGENT_IDS: ReadonlySet<FabricAgentId> = new Set<FabricAgentId>([
  "ORCHESTRATOR",
  "JUDGE",
]);

/** Every catalog agent is enabled by default unless explicitly disabled. */
export function isAgentEnabled(agentId: FabricAgentId): boolean {
  return agentEnabledState.get(agentId) ?? true;
}

/**
 * Enable/disable a catalog agent at runtime. Never throws — returns
 * `{ ok: false, reason }` if the caller tried to disable a `CORE_AGENT_IDS`
 * member (the roadmap's "dependency check": a core agent cannot be removed
 * without breaking other already-shipped pipelines that structurally assume
 * it is present — see the `CORE_AGENT_IDS` doc comment for the evidence).
 */
export function setAgentEnabled(
  agentId: FabricAgentId,
  enabled: boolean,
): { ok: true } | { ok: false; reason: string } {
  if (!enabled && CORE_AGENT_IDS.has(agentId)) {
    return {
      ok: false,
      reason:
        `Agent "${agentId}" is a core agent and cannot be disabled — other ` +
        "already-shipped pipelines (orchestrator plan/dispatch, kernel run, " +
        "task planning) structurally depend on it being present in every " +
        "plan/run.",
    };
  }
  agentEnabledState.set(agentId, enabled);
  return { ok: true };
}

/** One lifecycle entry per real catalog agent id — no duplicated id list. */
export function listAgentLifecycleState(): {
  agentId: FabricAgentId;
  enabled: boolean;
  core: boolean;
}[] {
  return FABRIC_AGENT_IDS.map((agentId) => ({
    agentId,
    enabled: isAgentEnabled(agentId),
    core: CORE_AGENT_IDS.has(agentId),
  }));
}

/** Test-only: clear all runtime overrides back to "everything enabled". */
export function resetAgentLifecycleForTests(): void {
  agentEnabledState.clear();
}

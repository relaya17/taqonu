/**
 * Agent Reputation — read-only aggregation over EXISTING outcome data.
 * No new persistence, no writes: pure aggregation of what `osStore`
 * already durably stores.
 *
 * -------------------------------------------------------------------
 * Data-source investigation (why `osStore.listAgentRuns()`, not
 * `agents.dispatch` audit entries):
 * -------------------------------------------------------------------
 * `AgentDispatchResult.runs` (`AgentRunResult[]`,
 * packages/shared/src/schemas/agent-fabric.schema.ts) is the per-fabric-
 * agent-id outcome shape `POST /api/v1/agents/dispatch`
 * (apps/api/src/routes/agent-fabric.ts) returns. It IS durably persisted
 * on dispatch — but only in a lossy, aggregated form, via
 * `osStore.appendAudit({ type: "agents.dispatch", ... })`:
 *
 *   - `runs` — total run COUNT for the dispatch (not per-agentId).
 *   - `failed` — total FAILED count for the whole dispatch (not per-agentId).
 *   - `totalCostUsd` / `runCosts: { agentId, costUsd }[]` — a real
 *     per-fabric-agentId COST breakdown (added for cost-intelligence.ts's
 *     `byAgent`), but `runCosts` entries carry `agentId` + `costUsd` only —
 *     no `status`, no `durationMs`, no `epistemicState`.
 *
 * So per-fabric-agent-id COST is available durably; per-fabric-agent-id
 * SUCCESS/FAILURE is not — there is no way to tell, from anything durable,
 * *which* agentId(s) in a multi-agent dispatch contributed to that
 * dispatch's single aggregate `failed` count. Building a "success rate"
 * keyed by fabric agentId from this source would mean either fabricating
 * an attribution that isn't there, or silently mislabeling "how many of
 * this dispatch's runs failed" as "how many of THIS agent's runs failed"
 * — both dishonest. Retrofitting per-run status onto the audit entry is a
 * real, separate schema/route change, out of scope for a read-only
 * aggregator.
 *
 * `osStore.listAgentRuns()` (`AgentRun[]`, agent-run.schema.ts — capped at
 * 200, persisted, populated by `apps/api/src/routes/agent.ts` and
 * `conversation.ts`) is the only durable source with a REAL per-outcome
 * `status` (SUCCEEDED / AWAITING_APPROVAL / FAILED / CANCELLED / QUEUED /
 * RUNNING). It has no `agentId` field at all, though — these are
 * single-agent conversational runs (one generalist agent, not the 14
 * `FABRIC_AGENT_IDS`), not fabric-dispatch runs. Its `createdBy` field
 * looked like the best per-identity proxy on paper, but both real
 * producers hardcode it to the literal string `"user"` (agent.ts:456,
 * conversation.ts:328) — it carries zero distinguishing signal today. Its
 * `mode` field (READ/ANALYZE/PLAN/APPROVE/WRITE/VERIFY) is the only real
 * per-run dimension that varies, so this aggregator groups by `mode`.
 *
 * Net: this is a real reputation ledger over real outcome data, honestly
 * scoped to what's actually there — a track record per conversational
 * *mode*, not per fabric *agent identity*. A true per-fabric-agent-id
 * reputation ledger needs `agents.dispatch` audit entries (or a successor)
 * to carry real per-run status, which they do not today. That is a
 * concrete Bucket-1/3 gap this file surfaces, not one it works around.
 *
 * Also honest about what `AgentRun` doesn't carry: no `costUsd` field
 * exists on it at all, so `avgCostUsd` below is always `null` (never a
 * fabricated 0). `avgDurationMs` is real as computed
 * (`completedAt - startedAt`) but, in practice, near-0 for every run
 * today: both producers capture a single `now` timestamp and reuse it for
 * both `startedAt` and `completedAt` rather than measuring real
 * wall-clock elapsed time — an upstream instrumentation gap this
 * aggregator surfaces rather than hides.
 */
import { AGENT_MODES, type AgentMode, type AgentReputationSummary } from "@atlas/shared";
import { osStore } from "../store/os-store.js";

/** Statuses `agentRunStatusSchema` (agent-run.schema.ts) defines as terminal. */
const TERMINAL_SUCCESS = "SUCCEEDED";
const TERMINAL_FAILURE = "FAILED";
/** No terminal verdict yet — either still in flight, or aborted without one. */
const PENDING_STATUSES = new Set(["QUEUED", "RUNNING", "AWAITING_APPROVAL", "CANCELLED"]);

function durationMsOf(startedAt: string, completedAt: string | null): number | null {
  if (completedAt === null) return null;
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const ms = end - start;
  return ms >= 0 ? ms : null;
}

/**
 * Aggregates `osStore.listAgentRuns()` into one `AgentReputationSummary`
 * per `mode`. Pure/read-only — no writes, no new store, no mutation of
 * `osStore`. Always returns a well-formed entry for every mode in
 * `modes` (default: all `AGENT_MODES`), including modes with zero
 * historical runs — an agent/mode that has never run is real, useful
 * information for a reputation ledger, not something to silently omit.
 *
 * A mode with zero terminal (SUCCEEDED/FAILED) runs gets
 * `successRate: null` and `epistemicState: "INSUFFICIENT_EVIDENCE"`
 * rather than a fabricated 0% or 100% — mirroring this codebase's own
 * "refuse confident hallucination" epistemic-state discipline (ADR-014).
 */
export function computeAgentReputation(options?: {
  modes?: readonly AgentMode[];
}): AgentReputationSummary[] {
  const modes = options?.modes ?? AGENT_MODES;
  const generatedAt = new Date().toISOString();
  const runs = osStore.listAgentRuns();

  return modes.map((mode) => {
    const forMode = runs.filter((run) => run.mode === mode);

    let succeededCount = 0;
    let failedCount = 0;
    let pendingCount = 0;
    let durationSumMs = 0;
    let durationSamples = 0;

    for (const run of forMode) {
      if (run.status === TERMINAL_SUCCESS) {
        succeededCount += 1;
      } else if (run.status === TERMINAL_FAILURE) {
        failedCount += 1;
      } else if (PENDING_STATUSES.has(run.status)) {
        pendingCount += 1;
      }

      if (run.status === TERMINAL_SUCCESS || run.status === TERMINAL_FAILURE) {
        const durationMs = durationMsOf(run.startedAt, run.completedAt);
        if (durationMs !== null) {
          durationSumMs += durationMs;
          durationSamples += 1;
        }
      }
    }

    const sampleSize = succeededCount + failedCount;

    return {
      mode,
      totalRuns: forMode.length,
      sampleSize,
      succeededCount,
      failedCount,
      pendingCount,
      successRate: sampleSize > 0 ? succeededCount / sampleSize : null,
      // AgentRun has no costUsd field — see file-level comment. Honest
      // "not tracked", never an invented 0.
      avgCostUsd: null,
      avgDurationMs: durationSamples > 0 ? durationSumMs / durationSamples : null,
      epistemicState: sampleSize > 0 ? "OBSERVED" : "INSUFFICIENT_EVIDENCE",
      generatedAt,
    } satisfies AgentReputationSummary;
  });
}

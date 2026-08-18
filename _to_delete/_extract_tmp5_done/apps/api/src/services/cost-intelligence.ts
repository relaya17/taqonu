/**
 * Cost Intelligence — aggregates real, already-persisted agent-fabric run
 * data from `osStore.listAudit()`. No new persistence layer, no writes.
 *
 * Data-source investigation (grep evidence, see full report for detail):
 *
 *  - `AgentRunResult.costUsd` (packages/shared/src/schemas/agent-fabric.schema.ts:82)
 *    IS computed today by the specialist-stub dispatcher
 *    (packages/agent-core/src/orchestrator/dispatch.ts:70 —
 *    `costUsd: Number((def.maxCostUsd * 0.05).toFixed(4))`), but that is a
 *    synthetic estimate (5% of the agent's configured budget cap), NOT a
 *    metered token/model cost. The two "real" (non-stub) specialist
 *    integrations hardcode `costUsd: 0`
 *    (apps/api/src/services/security-sentinel-dispatch.ts:53 and
 *    apps/api/src/services/legal-media-dispatch.ts:45). `AgentEvalReport.costUsd`
 *    (packages/agent-core/src/kernel/evaluation.ts:127) is similarly a
 *    synthetic `specialistCount * 0.01` estimate.
 *  - Nothing in apps/api/src/store/os-store.ts persists `AgentRunResult`,
 *    `AgentDispatchResult`, or `AgentEvalReport` objects (or their `costUsd`
 *    fields). `POST /api/v1/agents/dispatch`
 *    (apps/api/src/routes/agent-fabric.ts:216-225) only writes a summary
 *    entry via `osStore.appendAudit({ type: "agents.dispatch", id, traceId,
 *    projectId, judge, runs, failed, at })` — the per-run `costUsd` values
 *    and per-run `agentId`s are computed, returned in the HTTP response, and
 *    then discarded; only the *count* of runs and failures survives into the
 *    store. `POST /api/v1/kernel/eval/run` (apps/api/src/routes/kernel.ts:233-239)
 *    likewise only persists `{ accuracy, suite }`, dropping `costUsd`.
 *
 *  Conclusion: `costUsd` in this codebase today is a synthetic placeholder,
 *  and it is never durably persisted anywhere. `osStore.listAudit()`
 *  (apps/api/src/store/os-store.ts) is nonetheless the one real, durable,
 *  already-persisted trace of agent-fabric dispatch activity (hash-chained
 *  NDJSON + in-memory ring — apps/api/src/services/audit-log.ts). Audit
 *  entries are untyped (`Record<string, unknown>`), so this aggregator reads
 *  whatever numeric `costUsd` is actually present on each `"agents.dispatch"`
 *  entry rather than inventing one — today no producer writes `costUsd` onto
 *  an audit entry, so `totalUsd` legitimately computes to 0 against real
 *  dev/test data. That is an honest reflection of what is actually stored,
 *  not a bug in this aggregator; the day a producer starts recording a real
 *  `costUsd` on the audit entry, this function picks it up with no changes.
 *
 *  The one dimension real `"agents.dispatch"` audit entries DO reliably
 *  carry is `projectId` (apps/api/src/routes/agent-fabric.ts:220), so the
 *  breakdown below groups by project — grouping by `agentId` was considered
 *  but rejected because no producer persists a per-run `agentId` anywhere in
 *  `os-store.ts` (only the aggregate `runs` count survives), so a `byAgent`
 *  breakdown would have to be fabricated rather than read from real data.
 */
import { osStore } from "../store/os-store.js";

const AGENT_DISPATCH_AUDIT_TYPE = "agents.dispatch";

export interface CostIntelligenceProjectBreakdown {
  /** null = dispatch runs not scoped to a project (portfolio-level requests). */
  projectId: string | null;
  totalUsd: number;
  runCount: number;
  dispatchCount: number;
}

export interface CostIntelligenceSummary {
  totalUsd: number;
  runCount: number;
  dispatchCount: number;
  byProject: CostIntelligenceProjectBreakdown[];
  generatedAt: string;
  source: string;
  note: string;
}

function toFiniteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toRunCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : 0;
}

function toProjectKey(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Aggregates `costUsd` (and real dispatch/run counts) across every
 * `"agents.dispatch"` entry in `osStore.listAudit()`, grouped by project.
 * Pure/read-only — no writes, no new persistence. Always returns a
 * well-formed summary, even with zero audit entries or zero cost data.
 */
export function computeCostIntelligenceSummary(input?: {
  projectId?: string | null;
}): CostIntelligenceSummary {
  const filterProjectId = input?.projectId;
  const entries = osStore
    .listAudit()
    .filter(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        (entry as { type?: unknown }).type === AGENT_DISPATCH_AUDIT_TYPE,
    );

  const buckets = new Map<
    string | null,
    { totalUsd: number; runCount: number; dispatchCount: number }
  >();
  let totalUsd = 0;
  let runCount = 0;
  let dispatchCount = 0;

  for (const raw of entries) {
    const record = raw as Record<string, unknown>;
    const projectId = toProjectKey(record.projectId);

    if (filterProjectId !== undefined && projectId !== filterProjectId) {
      continue;
    }

    // Read defensively — no producer sets `costUsd` on an audit entry today
    // (see file-level comment), so this is almost always 0 in practice; it
    // is picked up automatically the moment a producer starts recording it.
    const cost = toFiniteNumber(record.costUsd);
    const runs = toRunCount(record.runs);

    totalUsd += cost;
    runCount += runs;
    dispatchCount += 1;

    const bucket = buckets.get(projectId) ?? {
      totalUsd: 0,
      runCount: 0,
      dispatchCount: 0,
    };
    bucket.totalUsd += cost;
    bucket.runCount += runs;
    bucket.dispatchCount += 1;
    buckets.set(projectId, bucket);
  }

  const byProject: CostIntelligenceProjectBreakdown[] = [...buckets.entries()]
    .map(([projectId, v]) => ({
      projectId,
      totalUsd: Number(v.totalUsd.toFixed(4)),
      runCount: v.runCount,
      dispatchCount: v.dispatchCount,
    }))
    .sort((a, b) => b.totalUsd - a.totalUsd || b.runCount - a.runCount);

  return {
    totalUsd: Number(totalUsd.toFixed(4)),
    runCount,
    dispatchCount,
    byProject,
    generatedAt: new Date().toISOString(),
    source: "osStore.listAudit() (type=agents.dispatch)",
    note:
      "costUsd is aggregated from whatever the audit trail actually stores; " +
      "no dispatch producer in this codebase currently persists a real " +
      "costUsd value, so totalUsd is typically 0 even with real dispatch " +
      "activity (see runCount/dispatchCount for real, non-zero activity).",
  };
}

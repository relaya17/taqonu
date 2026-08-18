/**
 * Cost Intelligence — aggregates real, already-persisted agent-fabric run
 * data from `osStore.listAudit()`. No new persistence layer, no writes.
 *
 * Data-source investigation (grep evidence, see full report for detail):
 *
 *  - `AgentRunResult.costUsd` (packages/shared/src/schemas/agent-fabric.schema.ts:82)
 *    is now real where a specialist path can produce a real number:
 *    `apps/api/src/services/security-sentinel-dispatch.ts` and
 *    `legal-media-dispatch.ts` accurately report `costUsd: 0` because those
 *    paths are rule-based scans with no LLM call at all — not a placeholder.
 *    The generic specialist stub
 *    (packages/agent-core/src/orchestrator/dispatch.ts, `runSpecialistStub`)
 *    likewise now reports a real `costUsd: 0` (it never calls an LLM
 *    provider either) instead of its old synthetic `maxCostUsd * 0.05`
 *    estimate. `packages/agent-core/src/providers/llm.ts` now computes a
 *    genuinely real `costUsd` from each provider response's real token
 *    `usage` (Anthropic `usage`, OpenAI-compatible `usage`, Gemini
 *    `usageMetadata`) — but nothing in the current fabric-dispatch specialist
 *    paths routes through that provider layer yet (the live LLM call sites,
 *    `apps/api/src/routes/conversation.ts` and `agent.ts`, are a separate
 *    conversational surface, not part of `agents.dispatch`), so `runCosts`
 *    entries below are $0 in practice until a specialist path is wired to
 *    `completeStrict`/`completeWithFreeFallback`.
 *  - `POST /api/v1/agents/dispatch` (apps/api/src/routes/agent-fabric.ts) now
 *    persists `totalCostUsd` (sum of `result.runs[].costUsd`) and a
 *    `runCosts: { agentId, costUsd }[]` breakdown onto the
 *    `"agents.dispatch"` audit entry, alongside the pre-existing `runs`
 *    (run *count*, unchanged) and `failed` fields — previously only the
 *    count survived and every per-run `costUsd`/`agentId` was discarded
 *    before reaching `osStore`.
 *  - Older audit entries (written before this change, or by any other
 *    producer) won't have `totalCostUsd`/`runCosts` at all — the audit log is
 *    append-only, so this aggregator falls back to the legacy flat `costUsd`
 *    field when present (some historical/test fixtures used that shape) and
 *    otherwise defaults to 0, exactly as before. No entry is ever assumed to
 *    have a cost it doesn't actually carry.
 *
 *  `byProject` groups by `projectId` (reliably present on every real
 *  `"agents.dispatch"` entry). `byAgent` is now populated too, sourced from
 *  `runCosts` when present on an entry — for older entries without
 *  `runCosts` there is nothing per-agent to attribute, so those dispatches
 *  only contribute to the project-level and grand totals, not to `byAgent`.
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

export interface CostIntelligenceAgentBreakdown {
  agentId: string;
  totalUsd: number;
  runCount: number;
}

export interface CostIntelligenceSummary {
  totalUsd: number;
  runCount: number;
  dispatchCount: number;
  byProject: CostIntelligenceProjectBreakdown[];
  /** Per-agent breakdown, sourced from `runCosts` on entries that carry it. */
  byAgent: CostIntelligenceAgentBreakdown[];
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

interface RunCostEntry {
  agentId: string;
  costUsd: number;
}

function toRunCosts(value: unknown): RunCostEntry[] {
  if (!Array.isArray(value)) return [];
  const out: RunCostEntry[] = [];
  for (const item of value) {
    if (
      typeof item === "object" &&
      item !== null &&
      typeof (item as { agentId?: unknown }).agentId === "string"
    ) {
      out.push({
        agentId: (item as { agentId: string }).agentId,
        costUsd: toFiniteNumber((item as { costUsd?: unknown }).costUsd),
      });
    }
  }
  return out;
}

/**
 * Resolves the total cost for one audit entry, preferring the new
 * `totalCostUsd` field and falling back to the legacy flat `costUsd` field
 * for older entries that predate this change — both default to 0 when
 * absent rather than inventing a number.
 */
function toEntryCostUsd(record: Record<string, unknown>): number {
  if (typeof record.totalCostUsd === "number") {
    return toFiniteNumber(record.totalCostUsd);
  }
  return toFiniteNumber(record.costUsd);
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
  const agentBuckets = new Map<string, { totalUsd: number; runCount: number }>();
  let totalUsd = 0;
  let runCount = 0;
  let dispatchCount = 0;

  for (const raw of entries) {
    const record = raw as Record<string, unknown>;
    const projectId = toProjectKey(record.projectId);

    if (filterProjectId !== undefined && projectId !== filterProjectId) {
      continue;
    }

    // Prefers the new `totalCostUsd` field (see file-level comment);
    // falls back to a legacy flat `costUsd` field, then 0, for older
    // audit entries that predate this change — read defensively either way.
    const cost = toEntryCostUsd(record);
    const runs = toRunCount(record.runs);
    const runCosts = toRunCosts(record.runCosts);

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

    // Only entries carrying a real `runCosts` breakdown contribute to
    // byAgent — older entries have nothing per-agent to attribute (see
    // file-level comment), so they intentionally don't appear here.
    for (const run of runCosts) {
      const agentBucket = agentBuckets.get(run.agentId) ?? {
        totalUsd: 0,
        runCount: 0,
      };
      agentBucket.totalUsd += run.costUsd;
      agentBucket.runCount += 1;
      agentBuckets.set(run.agentId, agentBucket);
    }
  }

  const byProject: CostIntelligenceProjectBreakdown[] = [...buckets.entries()]
    .map(([projectId, v]) => ({
      projectId,
      totalUsd: Number(v.totalUsd.toFixed(4)),
      runCount: v.runCount,
      dispatchCount: v.dispatchCount,
    }))
    .sort((a, b) => b.totalUsd - a.totalUsd || b.runCount - a.runCount);

  const byAgent: CostIntelligenceAgentBreakdown[] = [...agentBuckets.entries()]
    .map(([agentId, v]) => ({
      agentId,
      totalUsd: Number(v.totalUsd.toFixed(4)),
      runCount: v.runCount,
    }))
    .sort((a, b) => b.totalUsd - a.totalUsd || b.runCount - a.runCount);

  return {
    totalUsd: Number(totalUsd.toFixed(4)),
    runCount,
    dispatchCount,
    byProject,
    byAgent,
    generatedAt: new Date().toISOString(),
    source: "osStore.listAudit() (type=agents.dispatch)",
    note:
      "costUsd is aggregated from totalCostUsd (falling back to a legacy " +
      "flat costUsd field, then 0) on each agents.dispatch audit entry. " +
      "Real specialist paths that never call an LLM provider " +
      "(security-sentinel-dispatch, legal-media-dispatch, the generic " +
      "dispatch stub) accurately report $0 — that is not a gap in this " +
      "aggregator, it is the real cost of those paths today. byAgent is " +
      "populated from the runCosts breakdown on entries that carry it.",
  };
}

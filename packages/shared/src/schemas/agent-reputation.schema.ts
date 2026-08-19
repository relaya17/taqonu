import { z } from "zod";
import { agentModeSchema } from "./agent-run.schema.js";
import { epistemicStateSchema, isoDateTimeSchema } from "./common.schema.js";

/**
 * Agent Reputation — read-only track-record aggregate computed from
 * EXISTING outcome data by `apps/api/src/services/agent-reputation.ts`.
 * No new persistence: this is a pure aggregation shape.
 *
 * IMPORTANT (data-source honesty, see the service's file-level comment for
 * the full investigation): this is grouped by `AgentRun.mode`
 * (agent-run.schema.ts — READ/ANALYZE/PLAN/APPROVE/WRITE/VERIFY), NOT by
 * fabric agent identity (the 14 `FABRIC_AGENT_IDS` in
 * agent-fabric.schema.ts / constants/agents.ts). `"agents.dispatch"` audit
 * entries (apps/api/src/routes/agent-fabric.ts) do persist real
 * per-fabric-agentId cost via a `runCosts` breakdown, but never a
 * per-fabric-agentId status — only one aggregate `failed` count for the
 * entire multi-agent dispatch — so a true per-fabric-agent-id success rate
 * cannot honestly be computed from anything durable today. `AgentRun`
 * (single-agent conversational runs from `agent.ts` / `conversation.ts`)
 * is the only durable source with a real per-outcome `status`, which is
 * why this ledger is keyed by `mode` instead. Surfacing that gap plainly
 * — not quietly aggregating over the wrong axis — is the point of this
 * comment; widening `agents.dispatch` audit entries to carry a real
 * per-run status is a separate, out-of-scope change.
 */
export const agentReputationSummarySchema = z.object({
  /** Grouping key — `AgentRun.mode`. Not a fabric agentId; see above. */
  mode: agentModeSchema,
  /** Every `AgentRun` seen for this mode, any status (including pending). */
  totalRuns: z.number().int().min(0),
  /**
   * Count of runs with a terminal SUCCEEDED/FAILED status — the
   * population `successRate` and `avgDurationMs` are computed over.
   * Critical for honesty: a `successRate` built from `sampleSize: 2`
   * must be visibly distinguishable from one built from `sampleSize: 200`
   * — callers must read this alongside `successRate`, never the rate alone.
   */
  sampleSize: z.number().int().min(0),
  succeededCount: z.number().int().min(0),
  failedCount: z.number().int().min(0),
  /** QUEUED/RUNNING/AWAITING_APPROVAL/CANCELLED — no terminal verdict yet. */
  pendingCount: z.number().int().min(0),
  /**
   * `succeededCount / sampleSize`. `null` (never a fabricated 0 or 1) when
   * `sampleSize` is 0 — see `epistemicState` below.
   */
  successRate: z.number().min(0).max(1).nullable(),
  /**
   * Always `null` today: `agentRunSchema` (agent-run.schema.ts) has no
   * `costUsd` field, so there is no real per-run cost in this data source
   * to average. Left in the shape (not omitted) so a future producer that
   * adds real per-run cost can populate it without a breaking change —
   * an honest "not tracked", not an invented 0.
   */
  avgCostUsd: z.number().min(0).nullable(),
  /**
   * Mean of `(completedAt - startedAt)` in ms across the `sampleSize`
   * terminal runs. Honest as computed, but currently near-0 for every
   * real run in practice: `apps/api/src/routes/agent.ts` and
   * `conversation.ts` both capture a single `now` timestamp and reuse it
   * for both `startedAt` and `completedAt` rather than measuring real
   * wall-clock elapsed time. That is a gap in the upstream producers this
   * aggregator surfaces, not a bug in the aggregation itself. `null` when
   * `sampleSize` is 0.
   */
  avgDurationMs: z.number().min(0).nullable(),
  /**
   * `INSUFFICIENT_EVIDENCE` when `sampleSize` is 0 (no terminal outcome to
   * judge yet) — matching this codebase's own "refuse confident
   * hallucination" epistemic-state philosophy (ADR-014). `OBSERVED`
   * otherwise: every contributing run is a real, already-recorded outcome.
   */
  epistemicState: epistemicStateSchema,
  generatedAt: isoDateTimeSchema,
});

export type AgentReputationSummary = z.infer<typeof agentReputationSummarySchema>;

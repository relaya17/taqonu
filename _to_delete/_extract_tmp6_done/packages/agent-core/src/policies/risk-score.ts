import type { ToolRisk } from "@atlas/shared";

/**
 * Continuous 0-100 action-risk scoring, mapped onto a 4-value execution
 * bucket. This is deliberately a *different* engine from:
 *
 *   - `./tool-policies.ts` / `./entity-policies.ts` — the categorical
 *     `ToolRisk` tier (`READ_ONLY | LOW_RISK_WRITE | HIGH_RISK_WRITE |
 *     DESTRUCTIVE`) used to gate *whether a tool/entity action is
 *     structurally permitted at all* in a given agent mode. This module
 *     takes that tier as one input among several, not the whole answer.
 *
 *   - `packages/code-intelligence/src/risk.ts` — the ADR-014 QA/regression
 *     risk engine (`computeRiskScore`), which multiplies five 1-5 factors
 *     into a score up to 3125 for ranking *what to test*. That engine is
 *     not used for gating individual agent actions; this module borrows
 *     its "missing evidence increases risk" spirit but is otherwise a
 *     separate, purpose-built formula for the different question "should
 *     this specific action be auto-run, logged, escalated for approval,
 *     or refused to automation entirely?".
 *
 * The output bucket is what a runtime/audit layer should actually act on:
 *
 *   - AUTO       — proceed silently, no human-visible trace required.
 *   - AUTO_LOG   — proceed, but record the action for later review.
 *   - APPROVAL   — hold for human sign-off (or a valid approval-token
 *                  automation) before executing.
 *   - HUMAN_ONLY — always requires a live human decision; never
 *                  auto-executable, even by approval-token automation.
 */

/** Execution bucket an action's numeric risk score maps onto. */
export type RiskBucket = "AUTO" | "AUTO_LOG" | "APPROVAL" | "HUMAN_ONLY";

/**
 * Inputs available at action-decision time. `confidence` and
 * `evidenceCount` mirror the shape of signals already produced elsewhere
 * in the kernel (e.g. `confidenceSchema` — a 0-1 float — and
 * `evidenceRefs`/`evidence` arrays in `@atlas/shared`'s decision/evidence
 * schemas and `judge/evaluate.ts`), but are optional here because not
 * every caller of this scorer will have run a full judge/evaluation pass
 * before needing a risk number (e.g. a lightweight pre-check ahead of a
 * single tool call).
 */
export interface RiskScoreInput {
  /** The categorical tier from `ToolPolicy`/`EntityPolicy` (`@atlas/shared`'s `ToolRisk`). */
  readonly baseTier: ToolRisk;
  /**
   * 0-1 confidence in the correctness/safety of the action, if known
   * (e.g. from a judge/evaluation pass). Absent means "we don't actually
   * know how confident to be" and is treated conservatively (see
   * `DEFAULT_CONFIDENCE`), not as full confidence.
   */
  readonly confidence?: number;
  /**
   * Count of distinct evidence items (e.g. `evidenceRefs`) backing the
   * decision to take this action, if known. Absent is treated as "no
   * evidence counted yet" (see `DEFAULT_EVIDENCE_COUNT`), not as
   * sufficient evidence.
   */
  readonly evidenceCount?: number;
  /**
   * Whether the underlying `ToolPolicy`/`EntityPolicy` already marks this
   * action as `requiresApproval`. When true, the policy layer has already
   * decided a human must sign off — this scorer must never contradict
   * that by producing a score low enough to land in AUTO or AUTO_LOG.
   */
  readonly requiresApproval?: boolean;
}

// ---------------------------------------------------------------------------
// Formula constants — documented here so the scoring logic stays defensible
// and reviewable in one place, rather than "tuned" ad hoc inline.
// ---------------------------------------------------------------------------

/**
 * Base score per categorical risk tier. These anchor the 0-100 scale to
 * the existing 4-tier vocabulary so the two systems stay conceptually
 * aligned: a READ_ONLY action starts near the AUTO end, a DESTRUCTIVE
 * action starts near the HUMAN_ONLY end, and LOW_RISK_WRITE /
 * HIGH_RISK_WRITE sit at the AUTO_LOG / APPROVAL midpoints respectively —
 * so that "confident, well-evidenced" instances of each tier land close
 * to that tier's natural bucket, while uncertainty pushes them up from
 * there (never down).
 */
const BASE_SCORE_BY_TIER: Readonly<Record<ToolRisk, number>> = {
  READ_ONLY: 5,
  LOW_RISK_WRITE: 25,
  HIGH_RISK_WRITE: 55,
  DESTRUCTIVE: 75,
};

/**
 * Conservative defaults used when `confidence` / `evidenceCount` are not
 * supplied. "Conservative" here means "assume less safety than a fully
 * informed caller would report", i.e. bias toward more scrutiny, never
 * less: unknown confidence is treated as a coin flip (not full trust),
 * and unknown evidence is treated as zero evidence gathered (not
 * sufficient evidence).
 */
const DEFAULT_CONFIDENCE = 0.5;
const DEFAULT_EVIDENCE_COUNT = 0;

/**
 * Maximum points added for total lack of confidence (confidence === 0).
 * Scales linearly down to 0 added points at confidence === 1. Chosen so
 * that even a maximally-uncertain READ_ONLY action (base 5) cannot alone
 * cross into APPROVAL (5 + 20 + 15 evidence penalty = 40, still
 * AUTO_LOG) — uncertainty alone should raise scrutiny, not manufacture a
 * false HIGH_RISK_WRITE-equivalent action out of a read.
 */
const MAX_CONFIDENCE_PENALTY = 20;

/**
 * Evidence count considered "sufficient" — at or above this, no evidence
 * penalty is applied. Below it, each missing unit adds
 * `PER_MISSING_EVIDENCE_POINT` points, capped at
 * `EVIDENCE_SUFFICIENCY_TARGET * PER_MISSING_EVIDENCE_POINT` total
 * (mirrors `code-intelligence/src/risk.ts`'s "missingEvidence" factor:
 * less evidence -> more risk, more evidence -> less/no added risk, and
 * evidence can never make the score *worse*).
 */
const EVIDENCE_SUFFICIENCY_TARGET = 3;
const PER_MISSING_EVIDENCE_POINT = 5;
const MAX_EVIDENCE_PENALTY = EVIDENCE_SUFFICIENCY_TARGET * PER_MISSING_EVIDENCE_POINT; // 15

/**
 * Floor applied when `requiresApproval` is true. 55 sits comfortably
 * inside the APPROVAL bucket (50-79, see thresholds below), not just at
 * its boundary, so that rounding or future constant tweaks can't
 * accidentally let a `requiresApproval: true` action slip into
 * AUTO_LOG (max 49). An action the policy layer has already flagged as
 * needing human sign-off must never be scored as trivially safe.
 */
const REQUIRES_APPROVAL_FLOOR = 55;

// ---------------------------------------------------------------------------
// Bucket thresholds
// ---------------------------------------------------------------------------

/**
 * Bucket boundaries (inclusive upper bounds), chosen to keep each of the
 * four `BASE_SCORE_BY_TIER` anchors inside its "natural" bucket when
 * confidence and evidence are both at their best (confidence=1,
 * evidence>=target, i.e. zero penalties added):
 *
 *   - 0-19  AUTO       — READ_ONLY base (5) plus modest uncertainty stays
 *                        here; this is the "safe to run silently" band.
 *   - 20-49 AUTO_LOG    — LOW_RISK_WRITE base (25) lands here; low-impact
 *                        writes proceed but leave an audit trail.
 *   - 50-79 APPROVAL   — HIGH_RISK_WRITE base (55) and a well-evidenced,
 *                        high-confidence DESTRUCTIVE base (75) both land
 *                        here: real human sign-off is required, but an
 *                        approval-token automation may act on it.
 *   - 80-100 HUMAN_ONLY — DESTRUCTIVE actions with any material
 *                        uncertainty (e.g. default confidence/evidence)
 *                        cross into this band, where no automation may
 *                        execute even with a standing approval token.
 */
const AUTO_MAX = 19;
const AUTO_LOG_MAX = 49;
const APPROVAL_MAX = 79;

export function bucketForRiskScore(score: number): RiskBucket {
  const clamped = clampScore(score);
  if (clamped <= AUTO_MAX) return "AUTO";
  if (clamped <= AUTO_LOG_MAX) return "AUTO_LOG";
  if (clamped <= APPROVAL_MAX) return "APPROVAL";
  return "HUMAN_ONLY";
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 100;
  return Math.min(100, Math.max(0, score));
}

function clampConfidence(confidence: number | undefined): number {
  if (confidence === undefined || !Number.isFinite(confidence)) {
    return DEFAULT_CONFIDENCE;
  }
  return Math.min(1, Math.max(0, confidence));
}

function clampEvidenceCount(evidenceCount: number | undefined): number {
  if (evidenceCount === undefined || !Number.isFinite(evidenceCount)) {
    return DEFAULT_EVIDENCE_COUNT;
  }
  return Math.max(0, evidenceCount);
}

interface RiskBreakdown {
  readonly score: number;
  readonly factors: string[];
}

/**
 * Shared computation used by both `computeActionRiskScore` and
 * `explainRiskScore`, so the numeric result and its human-readable
 * explanation can never drift apart.
 *
 * Formula, in order:
 *   1. `base`      = BASE_SCORE_BY_TIER[baseTier]
 *   2. `confPenalty` = round((1 - confidence) * MAX_CONFIDENCE_PENALTY),
 *      confidence defaulting to DEFAULT_CONFIDENCE (0.5) when absent.
 *      Monotonic non-increasing in confidence: more confidence never
 *      raises the score.
 *   3. `evidPenalty` = max(0, EVIDENCE_SUFFICIENCY_TARGET - min(evidenceCount, EVIDENCE_SUFFICIENCY_TARGET))
 *      * PER_MISSING_EVIDENCE_POINT, evidenceCount defaulting to
 *      DEFAULT_EVIDENCE_COUNT (0) when absent. Monotonic non-increasing
 *      in evidenceCount: more evidence never raises the score, and
 *      evidence at/above the sufficiency target contributes zero penalty
 *      (it cannot push the score below the base+confidence subtotal).
 *   4. `subtotal`  = base + confPenalty + evidPenalty
 *   5. If `requiresApproval` is true: `floored = max(subtotal, REQUIRES_APPROVAL_FLOOR)`,
 *      else `floored = subtotal`.
 *   6. `score` = clamp(floored, 0, 100).
 */
function computeBreakdown(input: RiskScoreInput): RiskBreakdown {
  const factors: string[] = [];

  const base = BASE_SCORE_BY_TIER[input.baseTier];
  factors.push(`base tier ${input.baseTier}: +${base}`);

  const confidence = clampConfidence(input.confidence);
  const confPenalty = Math.round((1 - confidence) * MAX_CONFIDENCE_PENALTY);
  if (input.confidence === undefined) {
    factors.push(
      `confidence not provided, defaulted to ${DEFAULT_CONFIDENCE}: +${confPenalty}`,
    );
  } else {
    factors.push(`confidence ${confidence.toFixed(2)}: +${confPenalty}`);
  }

  const evidenceCount = clampEvidenceCount(input.evidenceCount);
  const missingEvidenceUnits = Math.max(
    0,
    EVIDENCE_SUFFICIENCY_TARGET - Math.min(evidenceCount, EVIDENCE_SUFFICIENCY_TARGET),
  );
  const evidPenalty = missingEvidenceUnits * PER_MISSING_EVIDENCE_POINT;
  if (input.evidenceCount === undefined) {
    factors.push(
      `evidenceCount not provided, defaulted to ${DEFAULT_EVIDENCE_COUNT}: +${evidPenalty}`,
    );
  } else if (evidPenalty > 0) {
    factors.push(`evidenceCount ${evidenceCount} below sufficiency target ${EVIDENCE_SUFFICIENCY_TARGET}: +${evidPenalty}`);
  } else {
    factors.push(`evidenceCount ${evidenceCount} meets sufficiency target ${EVIDENCE_SUFFICIENCY_TARGET}: +0`);
  }

  const subtotal = base + confPenalty + evidPenalty;

  let floored = subtotal;
  if (input.requiresApproval === true && subtotal < REQUIRES_APPROVAL_FLOOR) {
    floored = REQUIRES_APPROVAL_FLOOR;
    factors.push(
      `requiresApproval floor applied: raised from ${subtotal} to ${REQUIRES_APPROVAL_FLOOR}`,
    );
  }

  const score = clampScore(floored);
  if (score !== floored) {
    factors.push(`clamped to [0, 100]: ${floored} -> ${score}`);
  }

  return { score, factors };
}

/**
 * Computes a 0-100 numeric risk score for a single action. See
 * `computeBreakdown` for the exact formula and `bucketForRiskScore` for
 * how the resulting score maps onto an execution bucket.
 */
export function computeActionRiskScore(input: RiskScoreInput): number {
  return computeBreakdown(input).score;
}

/**
 * Human-readable breakdown of a risk score, suitable for an audit-log
 * `reason` field: the numeric score, the bucket it lands in, and an
 * ordered list of the factors that produced it. Always computed via the
 * same `computeBreakdown` path as `computeActionRiskScore`, so the two
 * can never disagree on the numeric score for the same input.
 */
export function explainRiskScore(
  input: RiskScoreInput,
): { score: number; bucket: RiskBucket; factors: string[] } {
  const { score, factors } = computeBreakdown(input);
  return { score, bucket: bucketForRiskScore(score), factors };
}

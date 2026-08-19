/**
 * Generic statistical anomaly detection over an arbitrary numeric time
 * series — e.g. daily per-project LLM cost totals
 * (`apps/api/src/services/cost-intelligence.ts`), hourly counts of
 * `listUnifiedAuditEntries` grouped by `risk` tier
 * (`apps/api/src/services/audit-log.ts`), or event-bus `type` counts over
 * time (`packages/agent-core/src/events/event-bus.ts`).
 *
 * This is deliberately CLASSICAL STATISTICS, not ML: z-score against a
 * trailing baseline window, and IQR (Tukey fence) outlier detection. No
 * model is trained, nothing is fit offline, there is no notion of
 * "learning" beyond recomputing mean/stddev/quartiles from whatever window
 * of real data is passed in. That is the honest ceiling of what's buildable
 * today — a from-scratch ML anomaly detector would need a meaningful
 * volume of historical production data to validate against, which this
 * codebase does not yet have (see the file-level comments in
 * `apps/api/src/services/cost-intelligence.ts` on how new `costUsd` really
 * is). A classical detector needs no training corpus and is honest about
 * its own confidence via `INSUFFICIENT_DATA` (see `MIN_SAMPLE_SIZE` below)
 * instead of silently producing noise-driven false positives on a handful
 * of data points.
 *
 * IMPORTANT — expected real-world behavior right now: in a fresh or
 * lightly-used Atlas instance, most real series this runs against (e.g.
 * per-project daily cost totals) will have far fewer than
 * `MIN_SAMPLE_SIZE` points and will correctly return `INSUFFICIENT_DATA`.
 * That is NOT a bug or a placeholder — it is the statistically honest
 * answer to "is this one-week-old, three-data-point series anomalous?"
 * (no meaningful answer exists yet). Do not "fix" this by lowering
 * `MIN_SAMPLE_SIZE` to make demo data look more interesting; lower the bar
 * only if you have a documented statistical justification for a smaller
 * minimum. The unit tests in `anomaly-detection.test.ts` use clearly
 * synthetic, labeled-as-such series to prove the *math* is correct — they
 * are not standing in for real production volume.
 */

/** One point in a time-ordered numeric series. */
export interface AnomalySeriesPoint {
  readonly timestamp: string;
  readonly value: number;
}

/** Statistical method used to flag a point as anomalous. */
export type AnomalyMethod = "zscore" | "iqr";

/**
 * Severity tier for a flagged anomaly. This is intentionally a *separate*
 * vocabulary from `ToolRisk` (`READ_ONLY | LOW_RISK_WRITE |
 * HIGH_RISK_WRITE | DESTRUCTIVE`, see
 * `packages/agent-core/src/policies/risk-score.ts`): `ToolRisk` classifies
 * what *kind of action* a tool call is (a structural, categorical
 * property, known ahead of time from policy), whereas an anomaly severity
 * classifies *how far a numeric observation deviates from its own recent
 * baseline* (a continuous, data-dependent property, only knowable after
 * computing the statistic). Reusing `ToolRisk` here would conflate "this
 * is a destructive tool call" with "this cost spike is 6 standard
 * deviations above normal" — different questions, so a dedicated
 * LOW/MEDIUM/HIGH tier is used instead.
 */
export type AnomalySeverity = "LOW" | "MEDIUM" | "HIGH";

export interface AnomalyDetectionOptions {
  /** Statistical method to apply. Defaults to `"zscore"`. */
  readonly method?: AnomalyMethod;
  /**
   * z-score: flag points where `|z| > threshold`. Default `Z_SCORE_DEFAULT_THRESHOLD` (3).
   * IQR: fence multiplier, flag points outside `[Q1 - threshold*IQR, Q3 + threshold*IQR]`.
   * Default `IQR_DEFAULT_THRESHOLD` (1.5, the standard Tukey fence).
   */
  readonly threshold?: number;
  /**
   * z-score only: size of the trailing baseline window (prior points only,
   * never including the point being scored or any future point — this
   * keeps the detector causal/online-safe, usable on a live-growing
   * series without lookahead). Default `DEFAULT_WINDOW_SIZE` (14).
   */
  readonly windowSize?: number;
}

/**
 * Result of running `detectAnomalies` on one point, OR a single honest
 * "not enough data" verdict for the whole series (see `status`).
 *
 * `detectAnomalies` returns `AnomalyResult[]`:
 *   - too few points overall: a single-element array with
 *     `status: "INSUFFICIENT_DATA"` (never guesses from noise).
 *   - enough points, no anomalies found: `[]` (an explicitly "flagged
 *     nothing" empty array, indistinguishable in shape from "no data" only
 *     by the fact it's genuinely empty rather than a sentinel element).
 *   - enough points, some anomalies found: one `status: "ANOMALY"` element
 *     per flagged point, in series order.
 */
export type AnomalyResult =
  | {
      readonly status: "INSUFFICIENT_DATA";
      readonly method: AnomalyMethod;
      readonly sampleSize: number;
      readonly minSampleSize: number;
      readonly reason: string;
    }
  | {
      readonly status: "ANOMALY";
      readonly method: AnomalyMethod;
      readonly index: number;
      readonly point: AnomalySeriesPoint;
      /**
       * `|z|` for zscore, or `distance beyond Q1/Q3, in IQR units` for iqr
       * (a value > `threshold` means the point sits outside the standard
       * Tukey fence `[Q1 - threshold*IQR, Q3 + threshold*IQR]`).
       */
      readonly score: number;
      readonly threshold: number;
      readonly severity: AnomalySeverity;
      readonly sampleSize: number;
      readonly minSampleSize: number;
      readonly reason: string;
    };

// ---------------------------------------------------------------------------
// Tunable constants — documented here, not tuned ad hoc inline, mirroring
// the `risk-score.ts` convention of keeping formula constants reviewable
// in one place.
// ---------------------------------------------------------------------------

/**
 * Minimum series length required to compute anything other than
 * `INSUFFICIENT_DATA`. Below 7 points, a mean/stddev/quartile calculation
 * is dominated by sampling noise rather than signal — flagging a
 * deviation from a 3- or 4-point "baseline" would be manufacturing false
 * confidence, not detecting a real anomaly. 7 also aligns with a natural
 * weekly cadence for the kind of series this is meant to run over (daily
 * cost totals, daily/hourly audit-entry counts): it's "at least one full
 * baseline week" before this module will say anything about deviation.
 */
export const MIN_SAMPLE_SIZE = 7;

/** Default z-score baseline window (trailing points, causal). ~2 weeks of daily data. */
export const DEFAULT_WINDOW_SIZE = 14;

/** Minimum number of prior points needed inside the trailing window to trust a mean/stddev. Below this, the point is simply not scored (not flagged, not an error). */
const MIN_WINDOW_FOR_STATS = 3;

/** Default z-score threshold: flag |z| > 3 (~99.7th percentile for a normal baseline). */
export const Z_SCORE_DEFAULT_THRESHOLD = 3;

/** Default IQR fence multiplier: the standard Tukey outlier fence. */
export const IQR_DEFAULT_THRESHOLD = 1.5;

/**
 * Floor applied to a computed stddev/IQR of exactly 0 (a perfectly flat
 * baseline) before it's used as a divisor. Without this, any single
 * point that differs at all from a constant baseline would divide by
 * zero. The floor is scaled to the baseline's own magnitude (or a tiny
 * absolute floor for a baseline of 0) so the resulting z-score/IQR-ratio
 * stays finite while still being enormous for any real deviation from a
 * truly flat series — which is the statistically correct outcome: a
 * flat baseline makes *any* deviation maximally surprising.
 */
function nonZeroSpread(spread: number, referenceMagnitude: number): number {
  if (spread > 0) return spread;
  const scaled = Math.abs(referenceMagnitude) * 1e-6;
  return scaled > 0 ? scaled : 1e-9;
}

// ---------------------------------------------------------------------------
// Core statistics — small, pure, unit-testable in isolation.
// ---------------------------------------------------------------------------

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Sample standard deviation (n-1 denominator) — the window is a sample of a broader process, not the whole population. */
function sampleStdDev(values: readonly number[], avg: number): number {
  if (values.length < 2) return 0;
  const sumSquaredDiff = values.reduce((sum, v) => sum + (v - avg) ** 2, 0);
  return Math.sqrt(sumSquaredDiff / (values.length - 1));
}

function median(sorted: readonly number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Q1/Q3 via the classic "median of halves" (Tukey hinge) method: sort,
 * split at the overall median (excluding the median value itself when the
 * count is odd), take the median of each half. Simple, standard, and easy
 * to hand-verify in tests — deliberately not the linear-interpolation
 * ("R-7"/numpy-default) method, to keep the arithmetic auditable by hand.
 */
function quartiles(sorted: readonly number[]): { q1: number; q3: number } {
  const n = sorted.length;
  if (n === 0) return { q1: 0, q3: 0 };
  const mid = Math.floor(n / 2);
  const lowerHalf = sorted.slice(0, mid);
  const upperHalf = n % 2 === 0 ? sorted.slice(mid) : sorted.slice(mid + 1);
  return { q1: median(lowerHalf), q3: median(upperHalf) };
}

// ---------------------------------------------------------------------------
// Severity — computed from the same ratio used to build the `reason`
// string, so score/severity/reason can never drift apart (mirrors the
// `computeBreakdown` convention in `policies/risk-score.ts`, where
// `computeActionRiskScore` and `explainRiskScore` both read from one
// shared computation instead of duplicating the formula).
// ---------------------------------------------------------------------------

/**
 * Maps how far past `threshold` a score is onto LOW/MEDIUM/HIGH:
 *   - LOW:    threshold <= ratio < 1.5x threshold
 *   - MEDIUM: 1.5x <= ratio < 2.5x threshold
 *   - HIGH:   ratio >= 2.5x threshold
 * Chosen so a point that barely crosses the flagging line (LOW) reads
 * differently from one that's wildly off-baseline (HIGH), without a
 * separate/inconsistent set of magic numbers from the flagging threshold
 * itself.
 */
function severityForRatio(score: number, threshold: number): AnomalySeverity {
  if (score >= threshold * 2.5) return "HIGH";
  if (score >= threshold * 1.5) return "MEDIUM";
  return "LOW";
}

// ---------------------------------------------------------------------------
// z-score
// ---------------------------------------------------------------------------

interface ScoredPoint {
  readonly index: number;
  readonly point: AnomalySeriesPoint;
  readonly score: number;
  readonly reason: string;
}

function zScoreCandidates(
  series: readonly AnomalySeriesPoint[],
  windowSize: number,
): ScoredPoint[] {
  const out: ScoredPoint[] = [];
  for (let i = 0; i < series.length; i++) {
    const windowStart = Math.max(0, i - windowSize);
    const window = series.slice(windowStart, i).map((p) => p.value);
    if (window.length < MIN_WINDOW_FOR_STATS) {
      // Not enough trailing history yet to trust a baseline for this
      // point — deliberately not scored (not flagged as an anomaly, not
      // reported as an error either).
      continue;
    }
    const point = series[i]!;
    const avg = mean(window);
    const rawStdDev = sampleStdDev(window, avg);
    const effectiveStdDev = nonZeroSpread(rawStdDev, avg);
    const z = (point.value - avg) / effectiveStdDev;
    const flatBaselineNote =
      rawStdDev === 0
        ? ` (baseline window was perfectly flat at ${avg}, so any deviation is maximally significant)`
        : "";
    out.push({
      index: i,
      point,
      score: Math.abs(z),
      reason:
        `value ${point.value} is ${Math.abs(z).toFixed(2)} standard deviations ` +
        `${z >= 0 ? "above" : "below"} the trailing ${window.length}-point mean ` +
        `(${avg.toFixed(4)}, stddev ${rawStdDev.toFixed(4)})${flatBaselineNote}`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// IQR
// ---------------------------------------------------------------------------

/**
 * Score = how many IQRs a point sits beyond Q1 (below) or Q3 (above),
 * i.e. `(value - Q3) / IQR` or `(Q1 - value) / IQR`. The standard Tukey
 * rule — "outlier if outside [Q1 - 1.5*IQR, Q3 + 1.5*IQR]" — is exactly
 * "outlier if this ratio exceeds 1.5", so `detectAnomalies` flags
 * candidates here whose score exceeds `threshold` (default
 * `IQR_DEFAULT_THRESHOLD`, 1.5), without needing to know the threshold
 * at candidate-computation time.
 */
function iqrCandidates(series: readonly AnomalySeriesPoint[]): ScoredPoint[] {
  const sortedValues = [...series.map((p) => p.value)].sort((a, b) => a - b);
  const { q1, q3 } = quartiles(sortedValues);
  const rawIqr = q3 - q1;
  const effectiveIqr = nonZeroSpread(rawIqr, (q1 + q3) / 2);

  const out: ScoredPoint[] = [];
  for (let i = 0; i < series.length; i++) {
    const point = series[i]!;
    let distanceFromQuartile = 0;
    let side: "upper" | "lower" | null = null;
    if (point.value > q3) {
      distanceFromQuartile = point.value - q3;
      side = "upper";
    } else if (point.value < q1) {
      distanceFromQuartile = q1 - point.value;
      side = "lower";
    }
    if (side === null) continue;
    const ratio = distanceFromQuartile / effectiveIqr;
    const flatNote =
      rawIqr === 0
        ? ` (Q1 and Q3 were both ${q1}, a perfectly flat baseline, so any deviation is maximally significant)`
        : "";
    out.push({
      index: i,
      point,
      score: ratio,
      reason:
        `value ${point.value} is ${distanceFromQuartile.toFixed(4)} beyond ` +
        `${side === "upper" ? "Q3" : "Q1"} (Q1=${q1.toFixed(4)}, Q3=${q3.toFixed(4)}, ` +
        `IQR=${rawIqr.toFixed(4)}), i.e. ${ratio.toFixed(2)}x the IQR beyond the ` +
        `${side} quartile${flatNote}`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Flags points in a time-ordered numeric series that deviate significantly
 * from a recent statistical baseline, using either z-score (default) or
 * IQR fences. See the file-level comment for what this can/cannot honestly
 * detect, and `MIN_SAMPLE_SIZE` for why short series intentionally produce
 * `INSUFFICIENT_DATA` instead of a guess.
 */
export function detectAnomalies(
  series: readonly AnomalySeriesPoint[],
  options: AnomalyDetectionOptions = {},
): AnomalyResult[] {
  const method: AnomalyMethod = options.method ?? "zscore";
  const sampleSize = series.length;

  if (sampleSize < MIN_SAMPLE_SIZE) {
    return [
      {
        status: "INSUFFICIENT_DATA",
        method,
        sampleSize,
        minSampleSize: MIN_SAMPLE_SIZE,
        reason:
          `only ${sampleSize} data point${sampleSize === 1 ? "" : "s"} available, ` +
          `need at least ${MIN_SAMPLE_SIZE} to compute a statistically meaningful ` +
          `baseline — reporting no anomalies would be honest but reporting a ` +
          `verdict at all would overstate confidence, so this is reported ` +
          `explicitly instead of silently returning an empty result.`,
      },
    ];
  }

  const threshold =
    options.threshold ??
    (method === "zscore" ? Z_SCORE_DEFAULT_THRESHOLD : IQR_DEFAULT_THRESHOLD);
  const windowSize =
    method === "zscore" ? (options.windowSize ?? DEFAULT_WINDOW_SIZE) : 0;

  const candidates =
    method === "zscore"
      ? zScoreCandidates(series, windowSize)
      : iqrCandidates(series);

  const flagged = candidates.filter((c) => c.score > threshold);

  return flagged.map(
    (c): AnomalyResult => ({
      status: "ANOMALY",
      method,
      index: c.index,
      point: c.point,
      score: Number(c.score.toFixed(6)),
      threshold,
      severity: severityForRatio(c.score, threshold),
      sampleSize,
      minSampleSize: MIN_SAMPLE_SIZE,
      reason: c.reason,
    }),
  );
}

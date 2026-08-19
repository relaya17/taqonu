export type MetricName =
  | "agent_run_duration"
  | "tool_failure_rate"
  | "retrieval_hit_rate"
  | "memory_write_rate"
  | "web_verification_rate"
  | "citation_rate"
  | "hallucination_eval_rate"
  | "patch_apply_rate"
  | "github_webhook_rate"
  // Wall-clock HTTP request latency in ms, recorded for every request via
  // apps/api/src/middleware/request-timing.ts's onRequest/onResponse hooks
  // (added this round alongside the histogram/percentile rework below).
  | "http_request_duration_ms";

export interface MetricSample {
  readonly name: MetricName;
  readonly value: number;
  readonly tags?: Readonly<Record<string, string>>;
  readonly at: string;
}

/** Default in-process ring buffer capacity (ADR observability MVP). */
export const METRICS_RING_BUFFER_CAP = 2000;

function sanitizePrometheusName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

function sanitizeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

function labelsKey(tags?: Readonly<Record<string, string>>): string {
  if (!tags) return "";
  return Object.keys(tags)
    .sort()
    .map((k) => `${k}=${tags[k] ?? ""}`)
    .join(",");
}

function formatLabels(
  tags: Readonly<Record<string, string>> | undefined,
  extra?: Readonly<Record<string, string>>,
): string {
  const merged: Record<string, string> = { ...(tags ?? {}), ...(extra ?? {}) };
  const keys = Object.keys(merged);
  if (keys.length === 0) return "";
  const parts = keys
    .sort()
    .map((k) => `${sanitizePrometheusName(k)}="${sanitizeLabelValue(merged[k] ?? "")}"`);
  return `{${parts.join(",")}}`;
}

/**
 * Histogram bucket boundaries, in milliseconds, for duration-style metrics
 * (see `DURATION_METRIC_NAMES` below). Chosen to give reasonable
 * resolution across the range we actually see in practice: sub-frame
 * (10ms) latencies through multi-second agent-run tails (up to 10s), with
 * roughly geometric spacing so no single decade dominates the bucket count.
 */
export const DURATION_BUCKET_BOUNDARIES: readonly number[] = [
  10, 50, 100, 250, 500, 1000, 2500, 5000, 10000,
];

/**
 * Bucket boundaries for rate-style metrics (the remaining 8 metric names),
 * which are recorded as 0/1 success-indicator samples (see routes/*.ts
 * call sites, e.g. `atlasMetrics.record("retrieval_hit_rate", 1, ...)`).
 * A fine-grained histogram adds no information for a binary signal, so we
 * use a minimal two-boundary split (miss vs. hit) — count/sum already
 * gives the effective rate (sum / count), and the boundaries still let
 * `toPrometheusText()` emit spec-compliant `_bucket` lines.
 */
export const RATE_BUCKET_BOUNDARIES: readonly number[] = [0, 1];

/** Metric names that carry a millisecond-duration value rather than a 0/1 rate. */
const DURATION_METRIC_NAMES: ReadonlySet<string> = new Set<MetricName>([
  "agent_run_duration",
  "http_request_duration_ms",
]);

export function bucketBoundariesForMetric(name: MetricName): readonly number[] {
  return DURATION_METRIC_NAMES.has(name) ? DURATION_BUCKET_BOUNDARIES : RATE_BUCKET_BOUNDARIES;
}

export interface HistogramBucket {
  /** Upper bound (inclusive) for this bucket, or `Number.POSITIVE_INFINITY` for the overflow bucket. */
  readonly le: number;
  /** Cumulative count of observations with value <= `le` (standard Prometheus histogram semantics). */
  readonly count: number;
}

export interface MetricHistogram {
  readonly count: number;
  readonly sum: number;
  readonly min: number;
  readonly max: number;
  /** Cumulative bucket counts, ascending by `le`, always ending with a `+Inf` bucket. */
  readonly buckets: readonly HistogramBucket[];
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

/**
 * Nearest-rank percentile over an already-sorted-ascending array of values.
 *
 * Accuracy tradeoff: this is computed over whatever raw samples are still
 * retained (see `InMemoryMetrics`'s bounded ring buffer), not over the
 * metric's full lifetime history. That means percentiles reflect only the
 * most recent `METRICS_RING_BUFFER_CAP` samples *across all metric names
 * combined* (the ring buffer's cap is global, not per-series) rather than
 * an unbounded/duration-windowed accumulator. This keeps memory bounded
 * and reuses the buffer already relied on elsewhere (see
 * `apps/api/src/routes/metrics.ts`'s `recent` sample listing) without
 * introducing a second, divergent piece of state. The known tradeoff: a
 * high-volume metric can evict older samples belonging to a low-volume
 * metric sooner than that metric's own history would otherwise warrant,
 * which can widen or skew that metric's percentile estimate. Nearest-rank
 * (as opposed to interpolation between bucket boundaries) was chosen
 * because it is exact for the retained sample set and trivially testable
 * against a known dataset (e.g. values 1..100 -> p50=50, p95=95, p99=99).
 */
export function percentile(sortedAscending: readonly number[], p: number): number {
  if (sortedAscending.length === 0) return 0;
  const clampedP = Math.min(100, Math.max(0, p));
  const rank = Math.ceil((clampedP / 100) * sortedAscending.length);
  const index = Math.min(sortedAscending.length, Math.max(1, rank)) - 1;
  return sortedAscending[index]!;
}

/** Compute a full histogram (buckets + count/sum/min/max + percentiles) over a set of raw values. */
export function computeHistogram(
  values: readonly number[],
  boundaries: readonly number[],
): MetricHistogram {
  const sortedBoundaries = [...boundaries].sort((a, b) => a - b);
  const bucketCounts = sortedBoundaries.map(() => 0);
  let count = 0;
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const value of values) {
    count += 1;
    sum += value;
    if (value < min) min = value;
    if (value > max) max = value;
    for (let i = 0; i < sortedBoundaries.length; i += 1) {
      if (value <= sortedBoundaries[i]!) {
        bucketCounts[i] = (bucketCounts[i] ?? 0) + 1;
      }
    }
  }

  const buckets: HistogramBucket[] = sortedBoundaries.map((le, i) => ({
    le,
    count: bucketCounts[i]!,
  }));
  buckets.push({ le: Number.POSITIVE_INFINITY, count });

  const sorted = [...values].sort((a, b) => a - b);

  return {
    count,
    sum,
    min: count > 0 ? min : 0,
    max: count > 0 ? max : 0,
    buckets,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
}

/**
 * Export samples as Prometheus text exposition format.
 *
 * Per metric name (+ tag set) this emits a real Prometheus histogram
 * (`_bucket{le=...}` cumulative counts, `_sum`, `_count`) computed from the
 * retained raw samples, plus derived `_p50`/`_p95`/`_p99`/`_min`/`_max`
 * gauges for convenience (Prometheus histograms don't carry percentiles
 * directly — those are normally derived query-side via
 * `histogram_quantile()` — but call sites here want an at-a-glance value
 * without a query engine, so we compute and expose them directly).
 */
export function toPrometheusText(samples: readonly MetricSample[]): string {
  interface Group {
    readonly values: number[];
    readonly tags: Readonly<Record<string, string>> | undefined;
  }
  const byName = new Map<string, Map<string, Group>>();

  for (const sample of samples) {
    let labelMap = byName.get(sample.name);
    if (!labelMap) {
      labelMap = new Map();
      byName.set(sample.name, labelMap);
    }
    const key = labelsKey(sample.tags);
    let group = labelMap.get(key);
    if (!group) {
      group = { values: [], tags: sample.tags };
      labelMap.set(key, group);
    }
    group.values.push(sample.value);
  }

  const lines: string[] = [
    "# HELP atlas_metrics_samples Total samples retained in the ring buffer",
    "# TYPE atlas_metrics_samples gauge",
    `atlas_metrics_samples ${samples.length}`,
  ];

  const names = [...byName.keys()].sort();
  for (const name of names) {
    const labelMap = byName.get(name)!;
    const metricBase = `atlas_${sanitizePrometheusName(name)}`;
    const boundaries = bucketBoundariesForMetric(name as MetricName);
    const groups = [...labelMap.values()];
    const histograms = groups.map((group) => ({
      group,
      histogram: computeHistogram(group.values, boundaries),
    }));

    lines.push(`# HELP ${metricBase} Histogram of ${name}`);
    lines.push(`# TYPE ${metricBase} histogram`);
    for (const { group, histogram } of histograms) {
      for (const bucket of histogram.buckets) {
        const le = bucket.le === Number.POSITIVE_INFINITY ? "+Inf" : String(bucket.le);
        lines.push(`${metricBase}_bucket${formatLabels(group.tags, { le })} ${bucket.count}`);
      }
      lines.push(`${metricBase}_sum${formatLabels(group.tags)} ${histogram.sum}`);
      lines.push(`${metricBase}_count${formatLabels(group.tags)} ${histogram.count}`);
    }

    lines.push(`# HELP ${metricBase}_min Minimum observed value for ${name}`);
    lines.push(`# TYPE ${metricBase}_min gauge`);
    for (const { group, histogram } of histograms) {
      lines.push(`${metricBase}_min${formatLabels(group.tags)} ${histogram.min}`);
    }

    lines.push(`# HELP ${metricBase}_max Maximum observed value for ${name}`);
    lines.push(`# TYPE ${metricBase}_max gauge`);
    for (const { group, histogram } of histograms) {
      lines.push(`${metricBase}_max${formatLabels(group.tags)} ${histogram.max}`);
    }

    for (const q of ["p50", "p95", "p99"] as const) {
      lines.push(`# HELP ${metricBase}_${q} Approximate ${q} for ${name} (nearest-rank over retained samples)`);
      lines.push(`# TYPE ${metricBase}_${q} gauge`);
      for (const { group, histogram } of histograms) {
        lines.push(`${metricBase}_${q}${formatLabels(group.tags)} ${histogram[q]}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

export type MetricsRecordSink = (sample: MetricSample) => void;

export class InMemoryMetrics {
  private readonly samples: MetricSample[] = [];
  private readonly cap: number;
  private readonly onRecord: MetricsRecordSink | null;

  constructor(
    cap: number = METRICS_RING_BUFFER_CAP,
    options?: { readonly onRecord?: MetricsRecordSink },
  ) {
    this.cap = Math.max(1, cap);
    this.onRecord = options?.onRecord ?? null;
  }

  record(name: MetricName, value: number, tags?: Readonly<Record<string, string>>): void {
    const sample: MetricSample = {
      name,
      value,
      at: new Date().toISOString(),
      ...(tags !== undefined ? { tags } : {}),
    };
    this.samples.push(sample);
    if (this.samples.length > this.cap) {
      this.samples.splice(0, this.samples.length - this.cap);
    }
    this.onRecord?.(sample);
  }

  list(): readonly MetricSample[] {
    return this.samples;
  }

  /** Real histogram (count/sum/min/max/buckets/percentiles) for one metric name, optionally filtered by exact tag match. */
  histogram(name: MetricName, tags?: Readonly<Record<string, string>>): MetricHistogram {
    const filterKey = labelsKey(tags);
    const values = this.samples
      .filter((s) => s.name === name && labelsKey(s.tags) === filterKey)
      .map((s) => s.value);
    return computeHistogram(values, bucketBoundariesForMetric(name));
  }

  toPrometheusText(): string {
    return toPrometheusText(this.samples);
  }
}

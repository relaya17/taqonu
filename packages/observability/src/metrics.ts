export type MetricName =
  | "agent_run_duration"
  | "tool_failure_rate"
  | "retrieval_hit_rate"
  | "memory_write_rate"
  | "web_verification_rate"
  | "citation_rate"
  | "hallucination_eval_rate"
  | "patch_apply_rate"
  | "github_webhook_rate";

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

function formatLabels(tags?: Readonly<Record<string, string>>): string {
  if (!tags || Object.keys(tags).length === 0) return "";
  const parts = Object.keys(tags)
    .sort()
    .map((k) => `${sanitizePrometheusName(k)}="${sanitizeLabelValue(tags[k] ?? "")}"`);
  return `{${parts.join(",")}}`;
}

/**
 * Export samples as Prometheus text exposition format.
 * Per metric name (+ tags): a counter of sample count and a gauge of last value.
 */
export function toPrometheusText(samples: readonly MetricSample[]): string {
  type Agg = { count: number; last: number; tags?: Readonly<Record<string, string>> };
  const byName = new Map<string, Map<string, Agg>>();

  for (const sample of samples) {
    let labelMap = byName.get(sample.name);
    if (!labelMap) {
      labelMap = new Map();
      byName.set(sample.name, labelMap);
    }
    const key = labelsKey(sample.tags);
    const existing = labelMap.get(key);
    if (existing) {
      existing.count += 1;
      existing.last = sample.value;
    } else {
      labelMap.set(key, {
        count: 1,
        last: sample.value,
        ...(sample.tags !== undefined ? { tags: sample.tags } : {}),
      });
    }
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
    const counterName = `${metricBase}_samples_total`;
    const gaugeName = metricBase;

    lines.push(`# HELP ${counterName} Sample count for ${name}`);
    lines.push(`# TYPE ${counterName} counter`);
    for (const agg of labelMap.values()) {
      lines.push(`${counterName}${formatLabels(agg.tags)} ${agg.count}`);
    }

    lines.push(`# HELP ${gaugeName} Last recorded value for ${name}`);
    lines.push(`# TYPE ${gaugeName} gauge`);
    for (const agg of labelMap.values()) {
      lines.push(`${gaugeName}${formatLabels(agg.tags)} ${agg.last}`);
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

  toPrometheusText(): string {
    return toPrometheusText(this.samples);
  }
}

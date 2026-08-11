export type MetricName =
  | "agent_run_duration"
  | "tool_failure_rate"
  | "retrieval_hit_rate"
  | "memory_write_rate"
  | "web_verification_rate"
  | "citation_rate"
  | "hallucination_eval_rate"
  | "patch_apply_rate";

export interface MetricSample {
  readonly name: MetricName;
  readonly value: number;
  readonly tags?: Readonly<Record<string, string>>;
  readonly at: string;
}

export class InMemoryMetrics {
  private readonly samples: MetricSample[] = [];

  record(name: MetricName, value: number, tags?: Readonly<Record<string, string>>): void {
    const sample: MetricSample = {
      name,
      value,
      at: new Date().toISOString(),
      ...(tags !== undefined ? { tags } : {}),
    };
    this.samples.push(sample);
  }

  list(): readonly MetricSample[] {
    return this.samples;
  }
}

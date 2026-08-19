import { describe, expect, it } from "vitest";
import {
  DURATION_BUCKET_BOUNDARIES,
  InMemoryMetrics,
  METRICS_RING_BUFFER_CAP,
  RATE_BUCKET_BOUNDARIES,
  bucketBoundariesForMetric,
  computeHistogram,
  percentile,
  toPrometheusText,
} from "./metrics.js";

describe("InMemoryMetrics ring buffer", () => {
  it("caps samples at the configured capacity", () => {
    const m = new InMemoryMetrics(3);
    m.record("memory_write_rate", 1);
    m.record("memory_write_rate", 2);
    m.record("memory_write_rate", 3);
    m.record("memory_write_rate", 4);
    expect(m.list()).toHaveLength(3);
    expect(m.list().map((s) => s.value)).toEqual([2, 3, 4]);
  });

  it("defaults to METRICS_RING_BUFFER_CAP", () => {
    expect(METRICS_RING_BUFFER_CAP).toBe(2000);
  });
});

describe("bucketBoundariesForMetric", () => {
  it("uses duration buckets for agent_run_duration and http_request_duration_ms", () => {
    expect(bucketBoundariesForMetric("agent_run_duration")).toBe(DURATION_BUCKET_BOUNDARIES);
    expect(bucketBoundariesForMetric("http_request_duration_ms")).toBe(DURATION_BUCKET_BOUNDARIES);
  });

  it("uses rate buckets for the other 8 metric names", () => {
    const rateNames = [
      "tool_failure_rate",
      "retrieval_hit_rate",
      "memory_write_rate",
      "web_verification_rate",
      "citation_rate",
      "hallucination_eval_rate",
      "patch_apply_rate",
      "github_webhook_rate",
    ] as const;
    for (const name of rateNames) {
      expect(bucketBoundariesForMetric(name)).toBe(RATE_BUCKET_BOUNDARIES);
    }
  });
});

describe("computeHistogram", () => {
  it("assigns known inputs to the correct cumulative buckets", () => {
    const values = [5, 15, 60, 300, 1200, 6000, 20000];
    const h = computeHistogram(values, DURATION_BUCKET_BOUNDARIES);

    expect(h.count).toBe(7);
    expect(h.sum).toBe(5 + 15 + 60 + 300 + 1200 + 6000 + 20000);
    expect(h.min).toBe(5);
    expect(h.max).toBe(20000);

    const byLe = new Map(h.buckets.map((b) => [b.le, b.count]));
    // <=10: just 5
    expect(byLe.get(10)).toBe(1);
    // <=50: 5, 15
    expect(byLe.get(50)).toBe(2);
    // <=100: 5, 15, 60
    expect(byLe.get(100)).toBe(3);
    // <=250: unchanged (300 > 250)
    expect(byLe.get(250)).toBe(3);
    // <=500: + 300
    expect(byLe.get(500)).toBe(4);
    // <=1000: unchanged (1200 > 1000)
    expect(byLe.get(1000)).toBe(4);
    // <=2500: + 1200
    expect(byLe.get(2500)).toBe(5);
    // <=5000: unchanged (6000 > 5000)
    expect(byLe.get(5000)).toBe(5);
    // <=10000: + 6000
    expect(byLe.get(10000)).toBe(6);
    // +Inf: all 7
    expect(byLe.get(Number.POSITIVE_INFINITY)).toBe(7);
  });

  it("returns zeroed stats for an empty value set", () => {
    const h = computeHistogram([], DURATION_BUCKET_BOUNDARIES);
    expect(h.count).toBe(0);
    expect(h.sum).toBe(0);
    expect(h.min).toBe(0);
    expect(h.max).toBe(0);
    expect(h.p50).toBe(0);
    expect(h.p95).toBe(0);
    expect(h.p99).toBe(0);
  });
});

describe("percentile", () => {
  it("computes p50/p95/p99 exactly for values 1..100 (nearest-rank)", () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(percentile(sorted, 50)).toBe(50);
    expect(percentile(sorted, 95)).toBe(95);
    expect(percentile(sorted, 99)).toBe(99);
  });

  it("computes p50/p95/p99 via computeHistogram end-to-end for values 1..100", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    const h = computeHistogram(values, DURATION_BUCKET_BOUNDARIES);
    expect(h.p50).toBe(50);
    expect(h.p95).toBe(95);
    expect(h.p99).toBe(99);
  });

  it("clamps and handles a single-value dataset", () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 99)).toBe(42);
  });

  it("returns 0 for an empty dataset", () => {
    expect(percentile([], 50)).toBe(0);
  });
});

describe("toPrometheusText", () => {
  it("exports real histogram bucket/sum/count lines, not a synthesized single gauge", () => {
    const text = toPrometheusText([
      {
        name: "agent_run_duration",
        value: 10,
        tags: { kind: "qa" },
        at: "2026-01-01T00:00:00.000Z",
      },
      {
        name: "agent_run_duration",
        value: 20,
        tags: { kind: "qa" },
        at: "2026-01-01T00:00:01.000Z",
      },
      {
        name: "patch_apply_rate",
        value: 1,
        at: "2026-01-01T00:00:02.000Z",
      },
    ]);

    expect(text).toContain("# TYPE atlas_metrics_samples gauge");
    expect(text).toContain("atlas_metrics_samples 3");

    // Real histogram, not the old "_samples_total counter + bare gauge" shape.
    expect(text).toContain("# TYPE atlas_agent_run_duration histogram");
    expect(text).toContain('atlas_agent_run_duration_bucket{kind="qa",le="10"} 1');
    expect(text).toContain('atlas_agent_run_duration_bucket{kind="qa",le="50"} 2');
    expect(text).toContain('atlas_agent_run_duration_bucket{kind="qa",le="+Inf"} 2');
    expect(text).toContain('atlas_agent_run_duration_sum{kind="qa"} 30');
    expect(text).toContain('atlas_agent_run_duration_count{kind="qa"} 2');
    expect(text).toContain('atlas_agent_run_duration_p50{kind="qa"} 10');

    expect(text).toContain("# TYPE atlas_patch_apply_rate histogram");
    expect(text).toContain('atlas_patch_apply_rate_bucket{le="0"} 0');
    expect(text).toContain('atlas_patch_apply_rate_bucket{le="1"} 1');
    expect(text).toContain("atlas_patch_apply_rate_sum 1");
    expect(text).toContain("atlas_patch_apply_rate_count 1");

    expect(text).not.toContain("_samples_total");
  });

  it("escapes label values", () => {
    const text = toPrometheusText([
      {
        name: "retrieval_hit_rate",
        value: 1,
        tags: { event: 'push"x' },
        at: "2026-01-01T00:00:00.000Z",
      },
    ]);
    expect(text).toContain('event="push\\"x"');
  });

  it("matches class method output", () => {
    const m = new InMemoryMetrics();
    m.record("citation_rate", 0.5, { source: "test" });
    expect(m.toPrometheusText()).toBe(toPrometheusText(m.list()));
  });
});

describe("InMemoryMetrics.histogram", () => {
  it("computes real percentiles across recorded samples for a metric", () => {
    const m = new InMemoryMetrics();
    for (let i = 1; i <= 100; i += 1) {
      m.record("agent_run_duration", i, { kind: "qa" });
    }
    const h = m.histogram("agent_run_duration", { kind: "qa" });
    expect(h.count).toBe(100);
    expect(h.p50).toBe(50);
    expect(h.p95).toBe(95);
    expect(h.p99).toBe(99);
    expect(h.min).toBe(1);
    expect(h.max).toBe(100);
  });

  it("filters by exact tag match, excluding samples with different tags", () => {
    const m = new InMemoryMetrics();
    m.record("agent_run_duration", 5, { kind: "qa" });
    m.record("agent_run_duration", 500, { kind: "other" });
    const h = m.histogram("agent_run_duration", { kind: "qa" });
    expect(h.count).toBe(1);
    expect(h.max).toBe(5);
  });
});

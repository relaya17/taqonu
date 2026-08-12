import { describe, expect, it } from "vitest";
import {
  InMemoryMetrics,
  METRICS_RING_BUFFER_CAP,
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

describe("toPrometheusText", () => {
  it("exports counters and gauges from samples", () => {
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
    expect(text).toContain("# TYPE atlas_agent_run_duration_samples_total counter");
    expect(text).toContain('atlas_agent_run_duration_samples_total{kind="qa"} 2');
    expect(text).toContain("# TYPE atlas_agent_run_duration gauge");
    expect(text).toContain('atlas_agent_run_duration{kind="qa"} 20');
    expect(text).toContain("atlas_patch_apply_rate_samples_total 1");
    expect(text).toContain("atlas_patch_apply_rate 1");
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

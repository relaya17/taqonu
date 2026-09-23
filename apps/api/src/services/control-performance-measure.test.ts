import { describe, expect, it } from "vitest";
import {
  collectSyncSamples,
  percentile,
  summarizeTimings,
} from "./control-performance-measure.js";

describe("R13 measurement helper", () => {
  it("computes distribution from supplied samples only", () => {
    const summary = summarizeTimings({
      path: "helper",
      measurementClass: "unit_test_local_process",
      warmup: 2,
      samplesMs: [10, 20, 30, 40, 50],
    });
    expect(summary.n).toBe(5);
    expect(summary.minMs).toBe(10);
    expect(summary.maxMs).toBe(50);
    expect(summary.meanMs).toBe(30);
    expect(summary.p50Ms).toBe(30);
    expect(summary.p95Ms).toBe(50);
    expect(summary.samplesMs).toEqual([10, 20, 30, 40, 50]);
  });

  it("rejects empty or invented-looking samples", () => {
    expect(() => percentile([], 50)).toThrow(/at least one sample/);
    expect(() =>
      summarizeTimings({
        path: "bad",
        measurementClass: "production",
        warmup: 0,
        samplesMs: [1, Number.NaN],
      }),
    ).toThrow(/non-finite/);
  });

  it("collects warmup-then-sample sync timings without fabricating values", () => {
    let calls = 0;
    const samples = collectSyncSamples({
      warmup: 2,
      n: 4,
      run: () => {
        calls += 1;
      },
    });
    expect(calls).toBe(6);
    expect(samples).toHaveLength(4);
    expect(samples.every((ms) => Number.isFinite(ms) && ms >= 0)).toBe(true);
  });
});

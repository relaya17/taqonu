import { describe, expect, it } from "vitest";
import {
  DEFAULT_WINDOW_SIZE,
  MIN_SAMPLE_SIZE,
  Z_SCORE_DEFAULT_THRESHOLD,
  detectAnomalies,
  type AnomalySeriesPoint,
} from "./anomaly-detection.js";

/**
 * All series below are clearly-synthetic, hand-computable numbers chosen
 * to prove the underlying arithmetic is correct — they do not stand in
 * for real production data (see the file-level comment in
 * anomaly-detection.ts for the honest statement on real data volume).
 */

function points(values: number[]): AnomalySeriesPoint[] {
  return values.map((value, i) => ({
    timestamp: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
    value,
  }));
}

describe("detectAnomalies — INSUFFICIENT_DATA", () => {
  it("returns a single INSUFFICIENT_DATA result when the series has fewer than MIN_SAMPLE_SIZE points", () => {
    expect(MIN_SAMPLE_SIZE).toBe(7);
    const series = points([1, 2, 3, 4, 5]); // 5 < 7
    const result = detectAnomalies(series);
    expect(result).toHaveLength(1);
    expect(result[0]!.status).toBe("INSUFFICIENT_DATA");
    if (result[0]!.status === "INSUFFICIENT_DATA") {
      expect(result[0]!.sampleSize).toBe(5);
      expect(result[0]!.minSampleSize).toBe(7);
      expect(result[0]!.reason).toContain("5 data points");
    }
  });

  it("does not return INSUFFICIENT_DATA once the series reaches exactly MIN_SAMPLE_SIZE points", () => {
    const series = points([10, 10, 10, 10, 10, 10, 10]); // exactly 7
    const result = detectAnomalies(series);
    // Flat series with enough points: a real (empty) verdict, not a refusal.
    expect(result).not.toEqual([
      expect.objectContaining({ status: "INSUFFICIENT_DATA" }),
    ]);
  });
});

describe("detectAnomalies — z-score, flat series", () => {
  it("flags nothing for a perfectly flat series (no deviation from baseline at all)", () => {
    const series = points([50, 50, 50, 50, 50, 50, 50, 50, 50, 50]);
    const result = detectAnomalies(series, { method: "zscore" });
    expect(result).toEqual([]);
  });
});

describe("detectAnomalies — z-score, exact hand-computed z", () => {
  // Baseline window [10, 20, 30]: mean = 20, sample stddev = sqrt(((10-20)^2 + (20-20)^2 + (30-20)^2) / (3-1))
  //   = sqrt((100 + 0 + 100) / 2) = sqrt(100) = 10.
  // The point immediately after this 3-point window is scored against
  // exactly this baseline (windowStart = max(0, 3-14) = 0).

  it("flags a point at z = 3.5 (just above default threshold 3) as LOW severity", () => {
    // z = (55 - 20) / 10 = 3.5
    const series = points([10, 20, 30, 55, 10, 10, 10]);
    const result = detectAnomalies(series, { method: "zscore" });
    expect(result).toHaveLength(1);
    const flag = result[0]!;
    expect(flag.status).toBe("ANOMALY");
    if (flag.status === "ANOMALY") {
      expect(flag.index).toBe(3);
      expect(flag.point.value).toBe(55);
      expect(flag.score).toBeCloseTo(3.5, 6);
      expect(flag.severity).toBe("LOW");
      expect(flag.threshold).toBe(Z_SCORE_DEFAULT_THRESHOLD);
    }
  });

  it("flags a point at z = 6.0 (1.5x-2.5x threshold) as MEDIUM severity", () => {
    // z = (80 - 20) / 10 = 6.0
    const series = points([10, 20, 30, 80, 10, 10, 10]);
    const result = detectAnomalies(series, { method: "zscore" });
    expect(result).toHaveLength(1);
    const flag = result[0]!;
    if (flag.status === "ANOMALY") {
      expect(flag.index).toBe(3);
      expect(flag.score).toBeCloseTo(6.0, 6);
      expect(flag.severity).toBe("MEDIUM");
    }
  });

  it("flags a point at z = 10.0 (>= 2.5x threshold) as HIGH severity", () => {
    // z = (120 - 20) / 10 = 10.0
    const series = points([10, 20, 30, 120, 10, 10, 10]);
    const result = detectAnomalies(series, { method: "zscore" });
    expect(result).toHaveLength(1);
    const flag = result[0]!;
    if (flag.status === "ANOMALY") {
      expect(flag.index).toBe(3);
      expect(flag.score).toBeCloseTo(10.0, 6);
      expect(flag.severity).toBe("HIGH");
      expect(flag.reason).toContain("standard deviations");
    }
  });

  it("does not flag a point exactly at the threshold (strict > comparison)", () => {
    // z = (50 - 20) / 10 = 3.0, exactly at default threshold 3 — must NOT flag.
    const series = points([10, 20, 30, 50, 10, 10, 10]);
    const result = detectAnomalies(series, { method: "zscore" });
    expect(result).toEqual([]);
  });

  it("flags exactly one obvious outlier in an otherwise flat longer series", () => {
    const values = new Array(15).fill(100);
    values[15 - 1] = 100; // keep last flat point too
    const withSpike = [
      ...new Array(15).fill(100),
      1000, // index 15: obvious spike
      ...new Array(9).fill(100),
    ];
    const series = points(withSpike);
    const result = detectAnomalies(series, {
      method: "zscore",
      windowSize: DEFAULT_WINDOW_SIZE,
    });
    expect(result).toHaveLength(1);
    const flag = result[0]!;
    if (flag.status === "ANOMALY") {
      expect(flag.index).toBe(15);
      expect(flag.point.value).toBe(1000);
      expect(flag.severity).toBe("HIGH");
    }
  });

  it("uses a floored, finite z-score (not Infinity) when the baseline window is perfectly flat", () => {
    const series = points([
      100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 200,
    ]);
    const result = detectAnomalies(series, { method: "zscore" });
    expect(result).toHaveLength(1);
    const flag = result[0]!;
    if (flag.status === "ANOMALY") {
      expect(Number.isFinite(flag.score)).toBe(true);
      expect(flag.score).toBeGreaterThan(Z_SCORE_DEFAULT_THRESHOLD);
      expect(flag.severity).toBe("HIGH");
      expect(flag.reason).toContain("perfectly flat");
    }
  });
});

describe("detectAnomalies — IQR", () => {
  it("flags nothing for a perfectly flat series", () => {
    const series = points([50, 50, 50, 50, 50, 50, 50, 50, 50]);
    const result = detectAnomalies(series, { method: "iqr" });
    expect(result).toEqual([]);
  });

  it("flags exactly the one obvious outlier, with hand-computed Q1/Q3/IQR", () => {
    // sorted: [10, 11, 11, 12, 12, 13, 13, 14, 100]  (n = 9)
    // mid = floor(9/2) = 4; lowerHalf = [10,11,11,12] -> median = (11+11)/2 = 11 = Q1
    // upperHalf (odd n, skip median) = [13,13,14,100] -> median = (13+14)/2 = 13.5 = Q3
    // IQR = 2.5; score = (100 - Q3) / IQR = (100 - 13.5) / 2.5 = 86.5 / 2.5 = 34.6
    // 34.6 > default threshold 1.5, so it's flagged (34.6 > 1.5 is exactly
    // equivalent to 100 > Q3 + 1.5*IQR = 17.25, the standard Tukey fence).
    const series = points([10, 12, 11, 13, 12, 14, 11, 13, 100]);
    const result = detectAnomalies(series, { method: "iqr" });
    expect(result).toHaveLength(1);
    const flag = result[0]!;
    expect(flag.status).toBe("ANOMALY");
    if (flag.status === "ANOMALY") {
      expect(flag.point.value).toBe(100);
      expect(flag.score).toBeCloseTo(34.6, 4);
      expect(flag.severity).toBe("HIGH");
      expect(flag.reason).toContain("Q1=11");
      expect(flag.reason).toContain("Q3=13.5");
    }
  });

  it("does not flag points inside the Tukey fences", () => {
    const series = points([10, 12, 11, 13, 12, 14, 11, 13, 15]);
    const result = detectAnomalies(series, { method: "iqr" });
    expect(result).toEqual([]);
  });
});

describe("detectAnomalies — general contract", () => {
  it("defaults to the zscore method when none is specified", () => {
    const series = points([10, 20, 30, 120, 10, 10, 10]);
    const withDefault = detectAnomalies(series);
    const withExplicit = detectAnomalies(series, { method: "zscore" });
    expect(withDefault).toEqual(withExplicit);
  });

  it("respects a custom threshold", () => {
    // z = 3.5 for index 3, as in the earlier hand-computed case.
    const series = points([10, 20, 30, 55, 10, 10, 10]);
    const strict = detectAnomalies(series, { method: "zscore", threshold: 4 });
    expect(strict).toEqual([]); // 3.5 does not exceed 4
    const lenient = detectAnomalies(series, {
      method: "zscore",
      threshold: 3,
    });
    expect(lenient).toHaveLength(1);
  });
});

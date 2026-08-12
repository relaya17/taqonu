import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendMetricsLogLine,
  countMetricsLogLines,
  readMetricsLogTail,
  setMetricsLogPathForTests,
} from "./metrics-log.js";

describe("metrics-log", () => {
  afterEach(() => {
    setMetricsLogPathForTests(null);
    delete process.env.ATLAS_SKIP_METRICS_LOG;
  });

  it("appends durable NDJSON samples", () => {
    const dir = mkdtempSync(join(tmpdir(), "atlas-metrics-"));
    const file = join(dir, "metrics.ndjson");
    setMetricsLogPathForTests(file);
    appendMetricsLogLine({
      name: "memory_write_rate",
      value: 1,
      at: "2026-08-12T00:00:00.000Z",
    });
    appendMetricsLogLine({
      name: "retrieval_hit_rate",
      value: 0,
      at: "2026-08-12T00:00:01.000Z",
      tags: { surface: "memory" },
    });
    expect(countMetricsLogLines()).toBe(2);
    const tail = readMetricsLogTail(10);
    expect(tail).toHaveLength(2);
    expect(tail[1]?.name).toBe("retrieval_hit_rate");
    const raw = readFileSync(file, "utf8");
    expect(raw.trim().split("\n")).toHaveLength(2);
  });

  it("skips write when ATLAS_SKIP_METRICS_LOG=1", () => {
    const dir = mkdtempSync(join(tmpdir(), "atlas-metrics-skip-"));
    const file = join(dir, "metrics.ndjson");
    setMetricsLogPathForTests(file);
    process.env.ATLAS_SKIP_METRICS_LOG = "1";
    appendMetricsLogLine({
      name: "citation_rate",
      value: 1,
      at: "2026-08-12T00:00:00.000Z",
    });
    expect(countMetricsLogLines()).toBe(0);
  });
});

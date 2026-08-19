import { beforeEach, describe, expect, it } from "vitest";
import {
  ERROR_AGGREGATOR_SAMPLE_CAP,
  ErrorAggregator,
  buildErrorKey,
  defaultErrorAggregator,
  getErrorAggregateSummary,
  normalizeErrorMessage,
} from "./error-aggregator.js";

describe("normalizeErrorMessage / buildErrorKey", () => {
  it("strips ids/uuids/numbers so the same logical error dedups", () => {
    const a = buildErrorKey("NOT_FOUND", "project abc-123 not found (id 4821)");
    const b = buildErrorKey("NOT_FOUND", "project abc-123 not found (id 9002)");
    // Different bare numbers embedded in otherwise-identical messages should
    // still collapse to the same key.
    expect(normalizeErrorMessage("id 4821")).toBe("id <id>");
    expect(a).toBe(b);
  });

  it("normalizes uuids to a placeholder", () => {
    const a = buildErrorKey(
      "NOT_FOUND",
      "resource 3fa85f64-5717-4562-b3fc-2c963f66afa6 not found",
    );
    const b = buildErrorKey(
      "NOT_FOUND",
      "resource 11111111-2222-3333-4444-555555555555 not found",
    );
    expect(a).toBe(b);
  });

  it("does not dedup across different error codes even with identical messages", () => {
    const a = buildErrorKey("NOT_FOUND", "boom");
    const b = buildErrorKey("VALIDATION_ERROR", "boom");
    expect(a).not.toBe(b);
  });

  it("does not dedup genuinely distinct messages under the same code", () => {
    const a = buildErrorKey("INTERNAL_ERROR", "database connection refused");
    const b = buildErrorKey("INTERNAL_ERROR", "upstream provider timeout");
    expect(a).not.toBe(b);
  });
});

describe("ErrorAggregator", () => {
  it("dedups by (code, normalized message) key, not by full message", () => {
    const agg = new ErrorAggregator();
    agg.record("NOT_FOUND", "project abc123 not found");
    agg.record("NOT_FOUND", "project def456 not found");
    agg.record("NOT_FOUND", "project ghi789 not found");

    const summary = agg.summary();
    expect(summary.totalUniqueErrors).toBe(1);
    expect(summary.totalOccurrences).toBe(3);
    expect(summary.entries[0]?.count).toBe(3);
  });

  it("tracks first-seen, last-seen, and count correctly", () => {
    const agg = new ErrorAggregator();
    const first = agg.record("CONFLICT", "duplicate entry 1");
    const second = agg.record("CONFLICT", "duplicate entry 2");

    expect(first.count).toBe(1);
    expect(second.count).toBe(2);
    expect(second.firstSeen).toBe(first.firstSeen);
    expect(new Date(second.lastSeen).getTime()).toBeGreaterThanOrEqual(
      new Date(first.firstSeen).getTime(),
    );
  });

  it("caps retained samples at the configured limit without dropping the running count", () => {
    const agg = new ErrorAggregator(5);
    for (let i = 0; i < 20; i += 1) {
      agg.record("INTERNAL_ERROR", `failure ${i}`);
    }
    const entry = agg.list()[0]!;
    expect(entry.count).toBe(20);
    expect(entry.samples).toHaveLength(5);
    // Keeps the most recent samples, not the oldest.
    expect(entry.samples[entry.samples.length - 1]?.message).toBe("failure 19");
  });

  it("defaults the sample cap to ERROR_AGGREGATOR_SAMPLE_CAP", () => {
    const agg = new ErrorAggregator();
    for (let i = 0; i < ERROR_AGGREGATOR_SAMPLE_CAP + 10; i += 1) {
      agg.record("INTERNAL_ERROR", `failure ${i}`);
    }
    expect(agg.list()[0]?.samples).toHaveLength(ERROR_AGGREGATOR_SAMPLE_CAP);
  });

  it("separates distinct error keys into distinct entries", () => {
    const agg = new ErrorAggregator();
    agg.record("NOT_FOUND", "project missing");
    agg.record("VALIDATION_ERROR", "bad input");
    expect(agg.list()).toHaveLength(2);
  });

  it("sorts list() by occurrence count descending", () => {
    const agg = new ErrorAggregator();
    agg.record("A", "rare");
    agg.record("B", "common");
    agg.record("B", "common");
    agg.record("B", "common");
    const list = agg.list();
    expect(list[0]?.code).toBe("B");
    expect(list[0]?.count).toBe(3);
  });

  it("get() returns undefined for an unknown key", () => {
    const agg = new ErrorAggregator();
    expect(agg.get("nope::nope")).toBeUndefined();
  });

  it("reset() clears all entries", () => {
    const agg = new ErrorAggregator();
    agg.record("A", "boom");
    agg.reset();
    expect(agg.summary().totalUniqueErrors).toBe(0);
  });

  it("records optional requestId/context on samples", () => {
    const agg = new ErrorAggregator();
    const entry = agg.record("A", "boom", { requestId: "req-1", context: { route: "/x" } });
    expect(entry.samples[0]?.requestId).toBe("req-1");
    expect(entry.samples[0]?.context).toEqual({ route: "/x" });
  });
});

describe("defaultErrorAggregator / getErrorAggregateSummary", () => {
  beforeEach(() => {
    defaultErrorAggregator.reset();
  });

  it("getErrorAggregateSummary reads the shared default aggregator", () => {
    defaultErrorAggregator.record("INTERNAL_ERROR", "boom");
    const summary = getErrorAggregateSummary();
    expect(summary.totalOccurrences).toBe(1);
    expect(summary.entries[0]?.code).toBe("INTERNAL_ERROR");
  });
});

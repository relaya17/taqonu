import { describe, expect, it, vi } from "vitest";
import {
  applyFilters,
  applyFiltersAny,
  describeFilters,
  getByPath,
  matchesCriterion,
  ROADMAP_EXAMPLE_FILTER,
  type FilterCriterion,
} from "./universal-filter.js";

describe("getByPath", () => {
  it("reads simple and nested dot-paths", () => {
    const obj = { a: 1, nested: { b: 2, deeper: { c: 3 } } };
    expect(getByPath(obj, "a")).toBe(1);
    expect(getByPath(obj, "nested.b")).toBe(2);
    expect(getByPath(obj, "nested.deeper.c")).toBe(3);
  });

  it("returns undefined for missing paths without throwing", () => {
    const obj = { a: 1 };
    expect(getByPath(obj, "missing")).toBeUndefined();
    expect(getByPath(obj, "a.b.c")).toBeUndefined();
    expect(getByPath(null, "a")).toBeUndefined();
    expect(getByPath(undefined, "a")).toBeUndefined();
    expect(getByPath(obj, "")).toBeUndefined();
  });

  it("refuses prototype-pollution-prone segments", () => {
    const obj = { a: 1 };
    expect(getByPath(obj, "__proto__.polluted")).toBeUndefined();
    expect(getByPath(obj, "constructor.prototype")).toBeUndefined();
  });
});

describe("matchesCriterion: eq / neq", () => {
  it("eq matches exact value", () => {
    expect(matchesCriterion({ riskLevel: "HIGH" }, { field: "riskLevel", op: "eq", value: "HIGH" })).toBe(true);
    expect(matchesCriterion({ riskLevel: "LOW" }, { field: "riskLevel", op: "eq", value: "HIGH" })).toBe(false);
  });

  it("neq matches non-equal value", () => {
    expect(matchesCriterion({ riskLevel: "LOW" }, { field: "riskLevel", op: "neq", value: "HIGH" })).toBe(true);
    expect(matchesCriterion({ riskLevel: "HIGH" }, { field: "riskLevel", op: "neq", value: "HIGH" })).toBe(false);
  });
});

describe("matchesCriterion: gt / gte / lt / lte", () => {
  it("compares numbers", () => {
    expect(matchesCriterion({ n: 5 }, { field: "n", op: "gt", value: 4 })).toBe(true);
    expect(matchesCriterion({ n: 5 }, { field: "n", op: "gt", value: 5 })).toBe(false);
    expect(matchesCriterion({ n: 5 }, { field: "n", op: "gte", value: 5 })).toBe(true);
    expect(matchesCriterion({ n: 5 }, { field: "n", op: "lt", value: 6 })).toBe(true);
    expect(matchesCriterion({ n: 5 }, { field: "n", op: "lt", value: 5 })).toBe(false);
    expect(matchesCriterion({ n: 5 }, { field: "n", op: "lte", value: 5 })).toBe(true);
  });

  it("compares strings lexicographically", () => {
    expect(matchesCriterion({ s: "b" }, { field: "s", op: "gt", value: "a" })).toBe(true);
    expect(matchesCriterion({ s: "a" }, { field: "s", op: "lt", value: "b" })).toBe(true);
  });

  it("fails (does not throw) when types are not comparable", () => {
    expect(matchesCriterion({ n: "x" }, { field: "n", op: "gt", value: 1 })).toBe(false);
    expect(matchesCriterion({}, { field: "n", op: "gt", value: 1 })).toBe(false);
  });
});

describe("matchesCriterion: in / notIn", () => {
  it("in matches membership", () => {
    expect(matchesCriterion({ t: "a" }, { field: "t", op: "in", value: ["a", "b"] })).toBe(true);
    expect(matchesCriterion({ t: "c" }, { field: "t", op: "in", value: ["a", "b"] })).toBe(false);
  });

  it("in with an empty array never matches", () => {
    expect(matchesCriterion({ t: "a" }, { field: "t", op: "in", value: [] })).toBe(false);
  });

  it("notIn matches non-membership", () => {
    expect(matchesCriterion({ t: "c" }, { field: "t", op: "notIn", value: ["a", "b"] })).toBe(true);
    expect(matchesCriterion({ t: "a" }, { field: "t", op: "notIn", value: ["a", "b"] })).toBe(false);
  });

  it("notIn with an empty array always matches (vacuously) when field present", () => {
    expect(matchesCriterion({ t: "a" }, { field: "t", op: "notIn", value: [] })).toBe(true);
  });

  it("in/notIn fail gracefully on missing field", () => {
    expect(matchesCriterion({}, { field: "t", op: "in", value: ["a"] })).toBe(false);
    expect(matchesCriterion({}, { field: "t", op: "notIn", value: ["a"] })).toBe(false);
  });
});

describe("matchesCriterion: contains", () => {
  it("matches substrings", () => {
    expect(matchesCriterion({ s: "hello world" }, { field: "s", op: "contains", value: "world" })).toBe(true);
    expect(matchesCriterion({ s: "hello world" }, { field: "s", op: "contains", value: "xyz" })).toBe(false);
  });

  it("matches array membership", () => {
    expect(matchesCriterion({ tags: ["a", "b"] }, { field: "tags", op: "contains", value: "b" })).toBe(true);
    expect(matchesCriterion({ tags: ["a", "b"] }, { field: "tags", op: "contains", value: "c" })).toBe(false);
  });

  it("never matches other field types", () => {
    expect(matchesCriterion({ n: 5 }, { field: "n", op: "contains", value: 5 })).toBe(false);
    expect(matchesCriterion({}, { field: "missing", op: "contains", value: "x" })).toBe(false);
  });
});

describe("matchesCriterion: since", () => {
  it("matches a timestamp clearly within the window", () => {
    const recent = new Date(Date.now() - 1000).toISOString();
    expect(
      matchesCriterion({ updatedAt: recent }, { field: "updatedAt", op: "since", value: 24 * 60 * 60 * 1000 }),
    ).toBe(true);
  });

  it("excludes a timestamp clearly outside the window", () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    expect(
      matchesCriterion({ updatedAt: old }, { field: "updatedAt", op: "since", value: 24 * 60 * 60 * 1000 }),
    ).toBe(false);
  });

  it("handles the exact boundary as inclusive (>=)", () => {
    // `matchesCriterion`'s "since" branch computes its cutoff as
    // `Date.now() - value` — it reads the clock ITSELF, at call time. An
    // earlier version of this test captured `Date.now()` into a local `now`
    // and passed `value: now - parsedBoundary`, which made the assertion
    // reduce to `0 >= Date.now() - now` — i.e. it only held when the clock
    // did not tick between capturing `now` and the call. That is a real
    // race, not a flake to retry: it passed on a fast machine and failed in
    // CI (packages/agent-core/src/filter/universal-filter.test.ts#L139),
    // because the boundary case is exactly where a 1ms drift flips the
    // result. The production semantics ("within the last N ms, measured
    // from now") are correct and are deliberately left unchanged.
    //
    // Freezing the clock is what actually makes the boundary testable: with
    // `Date.now()` pinned, `cutoff` is exactly `parsedBoundary`, so this
    // asserts the real property under test — that `fieldTime === cutoff`
    // (the exact boundary) counts as inside the window, i.e. `>=` not `>`.
    vi.useFakeTimers();
    try {
      const now = new Date("2026-01-01T00:00:00.000Z").getTime();
      vi.setSystemTime(now);

      const windowMs = 24 * 60 * 60 * 1000;
      const boundaryIso = new Date(now - windowMs).toISOString();
      const parsedBoundary = Date.parse(boundaryIso);

      // The boundary instant itself is inside the window (inclusive >=).
      expect(
        matchesCriterion(
          { updatedAt: boundaryIso },
          { field: "updatedAt", op: "since", value: windowMs },
        ),
      ).toBe(true);

      // One millisecond older than the boundary is outside it — this is the
      // half of the boundary property the old test never actually checked.
      expect(
        matchesCriterion(
          { updatedAt: new Date(parsedBoundary - 1).toISOString() },
          { field: "updatedAt", op: "since", value: windowMs },
        ),
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails gracefully on missing field, non-string field, or non-numeric value", () => {
    expect(matchesCriterion({}, { field: "updatedAt", op: "since", value: 1000 })).toBe(false);
    expect(matchesCriterion({ updatedAt: 12345 }, { field: "updatedAt", op: "since", value: 1000 })).toBe(false);
    expect(
      matchesCriterion({ updatedAt: new Date().toISOString() }, { field: "updatedAt", op: "since", value: "1000" }),
    ).toBe(false);
  });

  it("fails gracefully on an unparseable ISO string", () => {
    expect(
      matchesCriterion({ updatedAt: "not-a-date" }, { field: "updatedAt", op: "since", value: 1000 }),
    ).toBe(false);
  });
});

describe("missing fields never throw", () => {
  it.each<FilterCriterion["op"]>(["eq", "neq", "gt", "gte", "lt", "lte", "in", "notIn", "contains", "since"])(
    "op=%s on a missing field returns false instead of throwing",
    (op) => {
      const criterion: FilterCriterion = { field: "nope.deeply.nested", op, value: "x" };
      expect(() => matchesCriterion({}, criterion)).not.toThrow();
      // eq/neq are the only ops where "missing !== value" can legitimately
      // be true (neq) or false (eq) without a "missing field" special case.
      if (op !== "neq") {
        expect(matchesCriterion({}, criterion)).toBe(false);
      }
    },
  );
});

describe("applyFilters (AND) vs applyFiltersAny (OR)", () => {
  const items = [
    { name: "a", risk: "HIGH", score: 10 },
    { name: "b", risk: "HIGH", score: 1 },
    { name: "c", risk: "LOW", score: 10 },
    { name: "d", risk: "LOW", score: 1 },
  ];

  const criteria: FilterCriterion[] = [
    { field: "risk", op: "eq", value: "HIGH" },
    { field: "score", op: "gte", value: 10 },
  ];

  it("AND-composition requires every criterion to match", () => {
    const result = applyFilters(items, criteria);
    expect(result.map((i) => i.name)).toEqual(["a"]);
  });

  it("OR-composition requires at least one criterion to match", () => {
    const result = applyFiltersAny(items, criteria);
    expect(result.map((i) => i.name).sort()).toEqual(["a", "b", "c"]);
  });

  it("applyFilters with no criteria returns all items (copy)", () => {
    const result = applyFilters(items, []);
    expect(result).toEqual(items);
    expect(result).not.toBe(items);
  });

  it("applyFiltersAny with no criteria returns no items", () => {
    expect(applyFiltersAny(items, [])).toEqual([]);
  });
});

describe("nested field dot-paths", () => {
  const items = [
    { id: 1, metadata: { riskLevel: "HIGH" } },
    { id: 2, metadata: { riskLevel: "LOW" } },
    { id: 3, metadata: {} },
  ];

  it("filters on a nested path", () => {
    const result = applyFilters(items, [{ field: "metadata.riskLevel", op: "eq", value: "HIGH" }]);
    expect(result.map((i) => i.id)).toEqual([1]);
  });
});

describe("describeFilters", () => {
  it("produces a human-readable one-line summary", () => {
    const criteria: FilterCriterion[] = [
      { field: "riskLevel", op: "eq", value: "HIGH" },
      { field: "updatedAt", op: "since", value: 24 * 60 * 60 * 1000 },
      { field: "confidence", op: "lt", value: 0.9 },
    ];
    expect(describeFilters(criteria)).toBe(
      "riskLevel = HIGH AND updatedAt within last 24h AND confidence < 0.9",
    );
  });

  it("handles an empty criteria list", () => {
    expect(describeFilters([])).toBe("(no filters)");
  });
});

describe("end-to-end: roadmap flagship query (HIGH RISK + changed-24h + confidence<90%)", () => {
  const now = Date.now();
  const hoursAgo = (h: number) => new Date(now - h * 60 * 60 * 1000).toISOString();

  // Realistic small fixture resembling e.g. QA findings / claims.
  const fixture = [
    {
      id: "match-1",
      riskLevel: "HIGH",
      confidence: 0.5,
      updatedAt: hoursAgo(1), // within 24h
    },
    {
      id: "stale-high-risk",
      riskLevel: "HIGH",
      confidence: 0.2,
      updatedAt: hoursAgo(48), // outside 24h window -> excluded
    },
    {
      id: "low-risk-recent",
      riskLevel: "LOW",
      confidence: 0.1,
      updatedAt: hoursAgo(1), // wrong risk level -> excluded
    },
    {
      id: "high-confidence-recent",
      riskLevel: "HIGH",
      confidence: 0.95, // confidence too high -> excluded
      updatedAt: hoursAgo(2),
    },
    {
      id: "match-2",
      riskLevel: "HIGH",
      confidence: 0.89,
      updatedAt: hoursAgo(23),
    },
  ];

  it("returns exactly the expected matching subset via ROADMAP_EXAMPLE_FILTER", () => {
    const result = applyFilters(fixture, ROADMAP_EXAMPLE_FILTER);
    expect(result.map((i) => i.id).sort()).toEqual(["match-1", "match-2"]);
  });

  it("describeFilters explains the ROADMAP_EXAMPLE_FILTER query", () => {
    expect(describeFilters(ROADMAP_EXAMPLE_FILTER)).toBe(
      "riskLevel = HIGH AND updatedAt within last 24h AND confidence < 0.9",
    );
  });
});

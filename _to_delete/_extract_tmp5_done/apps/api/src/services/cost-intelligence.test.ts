import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Same isolation pattern as apps/api/src/routes/admin-ops.test.ts — a
// per-file temp store path plus skip-persist/skip-audit-log flags, set
// before osStore (or anything importing it) is first loaded, so this file's
// audit ring never touches a real .atlas/ directory or another test file's
// in-memory state.
const tmpDir = mkdtempSync(join(tmpdir(), "atlas-cost-intelligence-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";

const { osStore } = await import("../store/os-store.js");
const { computeCostIntelligenceSummary } = await import(
  "./cost-intelligence.js"
);

afterAll(() => {
  delete process.env.ATLAS_STORE_PATH;
  delete process.env.ATLAS_SKIP_STORE_PERSIST;
  delete process.env.ATLAS_SKIP_AUDIT_LOG;
});

const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_B = "22222222-2222-4222-8222-222222222222";

function seedDispatchAudit(entry: {
  projectId: string | null;
  costUsd?: number;
  runs: number;
  failed?: number;
}): void {
  osStore.appendAudit({
    type: "agents.dispatch",
    id: crypto.randomUUID(),
    traceId: `trace_${crypto.randomUUID().slice(0, 8)}`,
    projectId: entry.projectId,
    judge: "APPROVE",
    runs: entry.runs,
    failed: entry.failed ?? 0,
    ...(entry.costUsd !== undefined ? { costUsd: entry.costUsd } : {}),
    at: new Date().toISOString(),
  });
}

describe("computeCostIntelligenceSummary", () => {
  beforeEach(() => {
    // Reset in-memory store state (audit ring included) between tests
    // without touching disk — next ensureLoaded() re-reads the (still
    // nonexistent) temp store.json, which resolves to an empty store.
    osStore.unloadForTests();
  });

  it("returns a well-formed zero-value summary when there is no audit data", () => {
    const summary = computeCostIntelligenceSummary();
    expect(summary.totalUsd).toBe(0);
    expect(summary.runCount).toBe(0);
    expect(summary.dispatchCount).toBe(0);
    expect(summary.byProject).toEqual([]);
    expect(typeof summary.generatedAt).toBe("string");
    expect(new Date(summary.generatedAt).toString()).not.toBe("Invalid Date");
  });

  it("does not throw and stays well-formed when unrelated audit entries exist", () => {
    osStore.appendAudit({
      type: "some.other.event",
      id: crypto.randomUUID(),
      costUsd: 999,
      at: new Date().toISOString(),
    });
    const summary = computeCostIntelligenceSummary();
    expect(summary.totalUsd).toBe(0);
    expect(summary.dispatchCount).toBe(0);
  });

  it("aggregates totalUsd and per-project breakdowns across several real dispatch audit entries", () => {
    seedDispatchAudit({ projectId: PROJECT_A, costUsd: 0.05, runs: 3 });
    seedDispatchAudit({ projectId: PROJECT_A, costUsd: 0.02, runs: 2 });
    seedDispatchAudit({ projectId: PROJECT_B, costUsd: 0.1, runs: 4 });

    const summary = computeCostIntelligenceSummary();
    expect(summary.totalUsd).toBeCloseTo(0.17, 6);
    expect(summary.runCount).toBe(9);
    expect(summary.dispatchCount).toBe(3);

    expect(summary.byProject).toHaveLength(2);
    const byId = new Map(summary.byProject.map((p) => [p.projectId, p]));
    expect(byId.get(PROJECT_A)?.totalUsd).toBeCloseTo(0.07, 6);
    expect(byId.get(PROJECT_A)?.runCount).toBe(5);
    expect(byId.get(PROJECT_A)?.dispatchCount).toBe(2);
    expect(byId.get(PROJECT_B)?.totalUsd).toBeCloseTo(0.1, 6);
    expect(byId.get(PROJECT_B)?.runCount).toBe(4);
    expect(byId.get(PROJECT_B)?.dispatchCount).toBe(1);

    // Highest-spend project sorts first.
    expect(summary.byProject[0]?.projectId).toBe(PROJECT_B);
  });

  it("treats a missing costUsd on a real dispatch entry as 0 without throwing", () => {
    seedDispatchAudit({ projectId: PROJECT_A, runs: 2 });
    const summary = computeCostIntelligenceSummary();
    expect(summary.totalUsd).toBe(0);
    expect(summary.runCount).toBe(2);
    expect(summary.dispatchCount).toBe(1);
    expect(summary.byProject[0]?.totalUsd).toBe(0);
  });

  it("filters to a single project when projectId is provided", () => {
    seedDispatchAudit({ projectId: PROJECT_A, costUsd: 0.03, runs: 1 });
    seedDispatchAudit({ projectId: PROJECT_B, costUsd: 0.2, runs: 5 });

    const filtered = computeCostIntelligenceSummary({ projectId: PROJECT_A });
    expect(filtered.totalUsd).toBeCloseTo(0.03, 6);
    expect(filtered.dispatchCount).toBe(1);
    expect(filtered.byProject).toEqual([
      { projectId: PROJECT_A, totalUsd: 0.03, runCount: 1, dispatchCount: 1 },
    ]);

    const unfiltered = computeCostIntelligenceSummary();
    expect(unfiltered.totalUsd).toBeCloseTo(0.23, 6);
    expect(unfiltered.byProject).toHaveLength(2);
  });
});

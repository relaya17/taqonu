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

/** Legacy shape — a flat `costUsd` field, no `runCosts` breakdown. Simulates
 * an audit entry written before totalCostUsd/runCosts existed. */
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

/** Current shape — matches exactly what apps/api/src/routes/agent-fabric.ts
 * now persists: totalCostUsd + a per-run runCosts breakdown. */
function seedDispatchAuditWithRunCosts(entry: {
  projectId: string | null;
  runCosts: Array<{ agentId: string; costUsd: number }>;
  failed?: number;
}): void {
  const totalCostUsd = Number(
    entry.runCosts.reduce((sum, r) => sum + r.costUsd, 0).toFixed(6),
  );
  osStore.appendAudit({
    type: "agents.dispatch",
    id: crypto.randomUUID(),
    traceId: `trace_${crypto.randomUUID().slice(0, 8)}`,
    projectId: entry.projectId,
    judge: "APPROVE",
    runs: entry.runCosts.length,
    failed: entry.failed ?? 0,
    totalCostUsd,
    runCosts: entry.runCosts,
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
    expect(summary.byAgent).toEqual([]);
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

  it("reads totalCostUsd + runCosts (the shape agent-fabric.ts now persists) and builds a real byAgent breakdown", () => {
    seedDispatchAuditWithRunCosts({
      projectId: PROJECT_A,
      runCosts: [
        { agentId: "SECURITY", costUsd: 0.01 },
        { agentId: "ARCHITECT", costUsd: 0.02 },
      ],
    });
    seedDispatchAuditWithRunCosts({
      projectId: PROJECT_B,
      runCosts: [{ agentId: "SECURITY", costUsd: 0.05 }],
    });

    const summary = computeCostIntelligenceSummary();
    expect(summary.totalUsd).toBeCloseTo(0.08, 6);
    expect(summary.runCount).toBe(3);
    expect(summary.dispatchCount).toBe(2);

    const byAgentId = new Map(summary.byAgent.map((a) => [a.agentId, a]));
    expect(byAgentId.get("SECURITY")?.totalUsd).toBeCloseTo(0.06, 6);
    expect(byAgentId.get("SECURITY")?.runCount).toBe(2);
    expect(byAgentId.get("ARCHITECT")?.totalUsd).toBeCloseTo(0.02, 6);
    expect(byAgentId.get("ARCHITECT")?.runCount).toBe(1);
    // Highest-spend agent sorts first.
    expect(summary.byAgent[0]?.agentId).toBe("SECURITY");

    const byProjectId = new Map(summary.byProject.map((p) => [p.projectId, p]));
    expect(byProjectId.get(PROJECT_A)?.totalUsd).toBeCloseTo(0.03, 6);
    expect(byProjectId.get(PROJECT_B)?.totalUsd).toBeCloseTo(0.05, 6);
  });

  it("prefers totalCostUsd over a legacy flat costUsd field when both are somehow present", () => {
    osStore.appendAudit({
      type: "agents.dispatch",
      id: crypto.randomUUID(),
      traceId: "trace_prefer",
      projectId: PROJECT_A,
      judge: "APPROVE",
      runs: 1,
      failed: 0,
      costUsd: 999, // stale/legacy field — must be ignored when totalCostUsd is present
      totalCostUsd: 0.04,
      runCosts: [{ agentId: "SECURITY", costUsd: 0.04 }],
      at: new Date().toISOString(),
    });
    const summary = computeCostIntelligenceSummary();
    expect(summary.totalUsd).toBeCloseTo(0.04, 6);
  });

  it("does not fabricate a byAgent breakdown for older entries that predate runCosts, even though they still contribute to totals", () => {
    seedDispatchAudit({ projectId: PROJECT_A, costUsd: 0.05, runs: 3 }); // legacy shape, no runCosts
    seedDispatchAuditWithRunCosts({
      projectId: PROJECT_B,
      runCosts: [{ agentId: "SECURITY", costUsd: 0.02 }],
    });

    const summary = computeCostIntelligenceSummary();
    expect(summary.totalUsd).toBeCloseTo(0.07, 6);
    expect(summary.dispatchCount).toBe(2);
    // Only the entry with a real runCosts breakdown contributes to byAgent.
    expect(summary.byAgent).toEqual([
      { agentId: "SECURITY", totalUsd: 0.02, runCount: 1 },
    ]);
  });
});

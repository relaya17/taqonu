import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRun } from "@atlas/shared";

// Same isolation pattern as apps/api/src/services/cost-intelligence.test.ts —
// a per-file temp store path plus skip-persist/skip-audit-log flags, set
// before osStore (or anything importing it) is first loaded, so this file's
// agentRuns list never touches a real .atlas/ directory or another test
// file's in-memory state.
const tmpDir = mkdtempSync(join(tmpdir(), "atlas-agent-reputation-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";

const { osStore } = await import("../store/os-store.js");
const { computeAgentReputation } = await import("./agent-reputation.js");

afterAll(() => {
  delete process.env.ATLAS_STORE_PATH;
  delete process.env.ATLAS_SKIP_STORE_PERSIST;
  delete process.env.ATLAS_SKIP_AUDIT_LOG;
});

const PROJECT = "11111111-1111-4111-8111-111111111111";

function seedRun(entry: {
  mode: AgentRun["mode"];
  status: AgentRun["status"];
  startedAt: string;
  completedAt: string | null;
}): void {
  const run: AgentRun = {
    id: crypto.randomUUID(),
    projectId: PROJECT,
    mode: entry.mode,
    status: entry.status,
    userRequest: "seed request",
    answer: entry.status === "SUCCEEDED" ? "seed answer" : null,
    epistemicState: entry.status === "SUCCEEDED" ? "OBSERVED" : null,
    startedAt: entry.startedAt,
    completedAt: entry.completedAt,
    createdBy: "user",
  };
  osStore.addAgentRun(run);
}

describe("computeAgentReputation", () => {
  beforeEach(() => {
    // Reset in-memory store state (agentRuns included) between tests
    // without touching disk — next ensureLoaded() re-reads the (still
    // nonexistent) temp store.json, which resolves to an empty store.
    osStore.unloadForTests();
  });

  it("returns an INSUFFICIENT_EVIDENCE entry per mode, never a fabricated rate, with zero historical runs", () => {
    const summaries = computeAgentReputation();
    expect(summaries.length).toBeGreaterThan(0);
    for (const summary of summaries) {
      expect(summary.totalRuns).toBe(0);
      expect(summary.sampleSize).toBe(0);
      expect(summary.succeededCount).toBe(0);
      expect(summary.failedCount).toBe(0);
      expect(summary.pendingCount).toBe(0);
      expect(summary.successRate).toBeNull();
      expect(summary.avgCostUsd).toBeNull();
      expect(summary.avgDurationMs).toBeNull();
      expect(summary.epistemicState).toBe("INSUFFICIENT_EVIDENCE");
    }
  });

  it("restricts to the requested modes only, when provided", () => {
    const summaries = computeAgentReputation({ modes: ["READ", "PLAN"] });
    expect(summaries.map((s) => s.mode)).toEqual(["READ", "PLAN"]);
  });

  it("computes a correct success rate and sampleSize over a small synthetic set of terminal runs", () => {
    seedRun({
      mode: "READ",
      status: "SUCCEEDED",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:00.100Z",
    });
    seedRun({
      mode: "READ",
      status: "SUCCEEDED",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:00.300Z",
    });
    seedRun({
      mode: "READ",
      status: "FAILED",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:00.200Z",
    });

    const summaries = computeAgentReputation();
    const read = summaries.find((s) => s.mode === "READ");
    expect(read).toBeDefined();
    expect(read?.totalRuns).toBe(3);
    expect(read?.sampleSize).toBe(3);
    expect(read?.succeededCount).toBe(2);
    expect(read?.failedCount).toBe(1);
    expect(read?.pendingCount).toBe(0);
    expect(read?.successRate).toBeCloseTo(2 / 3, 6);
    // (100 + 300 + 200) / 3 = 200ms
    expect(read?.avgDurationMs).toBeCloseTo(200, 6);
    expect(read?.avgCostUsd).toBeNull();
    expect(read?.epistemicState).toBe("OBSERVED");
  });

  it("excludes pending (non-terminal) statuses from sampleSize and successRate but still counts them in totalRuns/pendingCount", () => {
    seedRun({
      mode: "PLAN",
      status: "SUCCEEDED",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:00.100Z",
    });
    seedRun({
      mode: "PLAN",
      status: "AWAITING_APPROVAL",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:00.100Z",
    });
    seedRun({
      mode: "PLAN",
      status: "QUEUED",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: null,
    });

    const summaries = computeAgentReputation();
    const plan = summaries.find((s) => s.mode === "PLAN");
    expect(plan?.totalRuns).toBe(3);
    expect(plan?.sampleSize).toBe(1);
    expect(plan?.succeededCount).toBe(1);
    expect(plan?.pendingCount).toBe(2);
    expect(plan?.successRate).toBe(1);
    expect(plan?.epistemicState).toBe("OBSERVED");
  });

  it("keeps runs from different modes in separate buckets", () => {
    seedRun({
      mode: "READ",
      status: "SUCCEEDED",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:00.050Z",
    });
    seedRun({
      mode: "ANALYZE",
      status: "FAILED",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:00.050Z",
    });

    const summaries = computeAgentReputation();
    const read = summaries.find((s) => s.mode === "READ");
    const analyze = summaries.find((s) => s.mode === "ANALYZE");
    const plan = summaries.find((s) => s.mode === "PLAN");
    expect(read?.successRate).toBe(1);
    expect(analyze?.successRate).toBe(0);
    // Untouched mode stays insufficient-evidence, unaffected by other modes.
    expect(plan?.sampleSize).toBe(0);
    expect(plan?.epistemicState).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("is read-only: does not add, remove, or mutate any AgentRun in the store", () => {
    seedRun({
      mode: "READ",
      status: "SUCCEEDED",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:00.050Z",
    });
    const before = osStore.listAgentRuns().length;
    computeAgentReputation();
    computeAgentReputation();
    expect(osStore.listAgentRuns().length).toBe(before);
  });
});

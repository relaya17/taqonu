import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WatchdogReport } from "./platform-watchdog.js";

// Isolation gap fix: `buildOracleActionQueue` internally calls
// `osStore.setMeta(...)` (see admin-oracle-queue.ts) even though this test
// file never imports osStore directly — found while auditing test
// isolation by bisecting which test files actually mutate the REAL
// `.atlas/store.json` at the repo root (grepping test files for the
// literal string "osStore" missed this transitive case entirely). Env vars
// must be set BEFORE `admin-oracle-queue.js` (and therefore os-store.js) is
// ever imported, same pattern as the route test files' "isolate before
// import" comment.
const tmpDir = mkdtempSync(join(tmpdir(), "atlas-admin-oracle-queue-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";

const { buildOracleActionQueue } = await import("./admin-oracle-queue.js");

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function emptyReport(alerts: WatchdogReport["alerts"] = []): WatchdogReport {
  return {
    generatedAt: new Date().toISOString(),
    platformVersion: "0.1.0",
    storagePolicyVersion: "2",
    alertCount: alerts.length,
    criticalCount: alerts.filter((a) => a.severity === "critical").length,
    highCount: alerts.filter((a) => a.severity === "high").length,
    alerts,
    knowledge: {
      projects: 0,
      evidenceRecords: 0,
      claims: 0,
      memories: 0,
      decisions: 0,
      patches: 0,
      agentRuns: 0,
      processAuditsToday: 0,
      linkedWorkspaces: 0,
      byoCloudConnected: 0,
      epistemicUnknownProjects: 0,
    },
    automation: {
      lastWatchdogAt: null,
      lastPortfolioHealthAt: null,
      lastProcessAuditAt: null,
      recommendedIntervalMinutes: 60,
      overdue: true,
    },
    score: 70,
  };
}

describe("buildOracleActionQueue", () => {
  it("ranks critical investigate actions first", () => {
    const queue = buildOracleActionQueue(
      emptyReport([
        {
          id: "watch-info",
          severity: "info",
          code: "WATCHDOG_OVERDUE",
          title: "Overdue",
          detail: "late",
          remediation: "run",
          detectedAt: new Date().toISOString(),
        },
        {
          id: "watch-crit",
          severity: "critical",
          code: "NO_WORKSPACE_ROOTS",
          title: "No roots",
          detail: "blocked",
          remediation: "link folder",
          detectedAt: new Date().toISOString(),
        },
      ]),
    );
    expect(queue.total).toBeGreaterThanOrEqual(2);
    expect(queue.top[0]?.severity).toBe("critical");
    expect(queue.top[0]?.kind).toBe("investigate");
    expect(queue.note.toLowerCase()).toContain("no silent apply");
  });
});

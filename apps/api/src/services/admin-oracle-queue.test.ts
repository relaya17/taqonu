import { describe, expect, it } from "vitest";
import { buildOracleActionQueue } from "./admin-oracle-queue.js";
import type { WatchdogReport } from "./platform-watchdog.js";

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

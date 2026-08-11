import type {
  AtlasEvalResult,
  AtlasEvalSuiteRun,
  RegressionReport,
} from "@atlas/shared";
import { regressionReportSchema } from "@atlas/shared";

/** Compare two suite runs — BLOCK if pass rate drops. */
export function compareSuiteRuns(
  previous: AtlasEvalSuiteRun,
  current: AtlasEvalSuiteRun,
): RegressionReport {
  const prevMap = new Map(previous.results.map((r) => [r.taskId, r]));
  const regressions: RegressionReport["regressions"] = [];

  for (const cur of current.results) {
    const prev = prevMap.get(cur.taskId);
    if (!prev) continue;
    if (prev.status === "PASS" && cur.status !== "PASS") {
      regressions.push({
        taskId: cur.taskId,
        previous: prev.status,
        current: cur.status,
      });
    }
  }

  const delta = current.passRate - previous.passRate;
  let status: RegressionReport["status"] = "PASS";
  if (regressions.length > 0 || delta < -0.01) status = "BLOCKED";
  else if (delta > 0.01) status = "IMPROVED";

  const summary =
    status === "BLOCKED"
      ? `BLOCKED: passRate ${pct(previous.passRate)} → ${pct(current.passRate)} (${regressions.length} task regression(s)).`
      : status === "IMPROVED"
        ? `IMPROVED: passRate ${pct(previous.passRate)} → ${pct(current.passRate)}.`
        : `PASS: passRate stable at ${pct(current.passRate)}.`;

  return regressionReportSchema.parse({
    id: crypto.randomUUID(),
    previousSuiteId: previous.id,
    currentSuiteId: current.id,
    previousPassRate: previous.passRate,
    currentPassRate: current.passRate,
    delta,
    status,
    regressions,
    plainLanguageSummary: summary,
    createdAt: new Date().toISOString(),
  });
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function summarizeProofMetrics(results: readonly AtlasEvalResult[]): {
  truth: number;
  engineeringSuccess: number;
  qaAccuracy: number;
  autonomy: number;
} {
  const n = results.length || 1;
  const passed = results.filter((r) => r.status === "PASS").length;
  const withEvidence = results.filter((r) => r.evidenceCount > 0).length;
  const unauthorized = results.filter((r) => r.unauthorizedWrite).length;
  const withPatchOk = results.filter(
    (r) => !r.patchProposed || r.status === "PASS",
  ).length;

  return {
    truth: withEvidence / n,
    engineeringSuccess: passed / n,
    qaAccuracy: withPatchOk / n,
    autonomy: Math.max(0, (passed - unauthorized) / n),
  };
}

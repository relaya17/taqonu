export type StudioProblemSource = "sentinel" | "gate" | "test";
export type StudioProblemSeverity =
  | "CRITICAL"
  | "HIGH"
  | "MEDIUM"
  | "LOW"
  | "INFO";

export interface StudioProblem {
  readonly id: string;
  readonly source: StudioProblemSource;
  readonly severity: StudioProblemSeverity;
  readonly message: string;
  readonly file: string | null;
  readonly line: number | null;
  readonly column: null;
  readonly code: string | null;
}

export interface SentinelFindingLike {
  readonly id: string;
  readonly title?: string;
  readonly detail?: string;
  readonly severity?: string;
  readonly kind?: string;
  readonly path?: string;
  readonly line?: number;
}

export interface GateNodeLike {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly blockerReason: string | null;
}

function asSeverity(value: string | undefined): StudioProblemSeverity {
  switch (value) {
    case "CRITICAL":
    case "HIGH":
    case "MEDIUM":
    case "LOW":
      return value;
    default:
      return "INFO";
  }
}

/** Map Sentinel findings. Location is copied only when the finding has path/line. */
export function problemsFromSentinelFindings(
  findings: readonly SentinelFindingLike[] | undefined,
): StudioProblem[] {
  if (!findings) return [];
  return findings.map((finding) => ({
    id: `sentinel:${finding.id}`,
    source: "sentinel" as const,
    severity: asSeverity(finding.severity),
    message: finding.detail?.trim() || finding.title || finding.id,
    file: finding.path ?? null,
    line: typeof finding.line === "number" ? finding.line : null,
    column: null,
    code: finding.kind ?? null,
  }));
}

/**
 * Map Quality Gate nodes that are not PASS/WAIVED.
 * Gates have no file/line — never invent locations.
 */
export function problemsFromGateNodes(
  nodes: readonly GateNodeLike[] | undefined,
): StudioProblem[] {
  if (!nodes) return [];
  const problems: StudioProblem[] = [];
  for (const node of nodes) {
    if (node.status === "PASS" || node.status === "WAIVED") continue;
    const severity: StudioProblemSeverity =
      node.status === "FAIL" || node.status === "BLOCKED" ? "HIGH" : "INFO";
    problems.push({
      id: `gate:${node.id}`,
      source: "gate",
      severity,
      message: node.blockerReason?.trim() || `${node.title}: ${node.status}`,
      file: null,
      line: null,
      column: null,
      code: node.status,
    });
  }
  return problems;
}

export interface TestRunLike {
  readonly status?: string;
  readonly commandId?: string | null;
  readonly passed?: boolean | null;
  readonly denial?: string;
  readonly reason?: string;
  readonly exitCode?: number | null;
}

/**
 * Map last governed test run. UNAVAILABLE and failures become Problems.
 * A missing run is not PASS. A passing run is not a Problem.
 */
export function problemsFromTestRun(
  run: TestRunLike | null | undefined,
  projectId: string,
): StudioProblem[] {
  if (!run?.commandId) return [];
  if (run.status === "UNAVAILABLE" || run.denial === "UNAVAILABLE") {
    return [
      {
        id: `test:${projectId}:${run.commandId}:unavailable`,
        source: "test",
        severity: "INFO",
        message: run.reason?.trim() ?? "",
        file: null,
        line: null,
        column: null,
        code: run.status ?? "UNAVAILABLE",
      },
    ];
  }
  if (run.passed === false || (typeof run.exitCode === "number" && run.exitCode !== 0)) {
    return [
      {
        id: `test:${projectId}:${run.commandId}:fail`,
        source: "test",
        severity: "HIGH",
        message: run.reason?.trim() ?? "",
        file: null,
        line: null,
        column: null,
        code: run.status ?? "FAILED",
      },
    ];
  }
  return [];
}

export function studioProblemCanOpenFile(problem: {
  readonly file: string | null;
}): boolean {
  return Boolean(problem.file);
}

/**
 * Sentinel problem ids are `sentinel:{findingId}`. Only those bind Propose.
 * Gates and tests never become a silent findingId.
 */
export function studioProblemRemediationId(
  problem: StudioProblem,
): string | null {
  if (problem.source !== "sentinel") return null;
  const raw = problem.id.startsWith("sentinel:")
    ? problem.id.slice("sentinel:".length)
    : problem.id;
  return raw.trim() || null;
}

export function mergeStudioProblems(
  ...groups: readonly (readonly StudioProblem[])[]
): StudioProblem[] {
  const seen = new Set<string>();
  const merged: StudioProblem[] = [];
  for (const group of groups) {
    for (const problem of group) {
      if (seen.has(problem.id)) continue;
      seen.add(problem.id);
      merged.push(problem);
    }
  }
  return merged;
}

/**
 * API/reason text wins. Missing reason uses i18n keys — never English-only fallbacks.
 */
export function studioProblemMessageKey(
  problem: StudioProblem,
): "message" | "testUnavailable" | "testFailed" {
  if (problem.message.trim()) return "message";
  if (problem.source === "test" && problem.code === "UNAVAILABLE") {
    return "testUnavailable";
  }
  if (problem.source === "test") return "testFailed";
  return "message";
}

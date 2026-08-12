import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type {
  CreateQaRun,
  QaFinding,
  QaPortfolioPattern,
  QaRegressionRule,
  QaReport,
  QaRun,
} from "@atlas/shared";
import { qaFindingSchema, qaRunSchema } from "@atlas/shared";
import { planQaRun } from "./planner/plan.js";
import {
  accumulatePortfolioPatterns,
  extractPatternSeedsFromFindings,
  formatPatternLessonsForContext,
  patternIdFromKey,
  retrieveRelevantPortfolioPatterns,
} from "./portfolio/patterns.js";

export interface OrchestrateQaInput {
  readonly request: CreateQaRun;
  readonly resolvedProjectIds: readonly string[];
  readonly changedPaths?: readonly string[] | undefined;
  readonly workspaceRoots?: Readonly<Record<string, string>> | undefined;
  /** Explicit LEARN keys suppressed on subsequent runs (not auto-emitted). */
  readonly priorLearnedPatternKeys?: readonly string[] | undefined;
  /** Portfolio-scoped patterns from prior runs (cross-project LEARN memory). */
  readonly priorPortfolioPatterns?: readonly QaPortfolioPattern[] | undefined;
  /** Max prior patterns to inject into this run's context. */
  readonly patternContextBudget?: number | undefined;
}

export type OrchestrateQaResult = QaReport & {
  /** Active explicit LEARN set used for suppression this run. */
  readonly learnedPatternKeys: readonly string[];
  /** Pattern keys emitted as OPEN findings this run (not auto-learned). */
  readonly emittedPatternKeys: readonly string[];
  /** Durable patterns from this run (1+ projects) for portfolio persist. */
  readonly durablePatterns: readonly QaPortfolioPattern[];
  /** Prior portfolio lessons retrieved into this run (budgeted). */
  readonly contextPatterns: readonly QaPortfolioPattern[];
  /** Compact INFERRED lessons for memoryContext / agent handoff. */
  readonly patternLessons: readonly string[];
};

function listTopFiles(root: string, max = 80): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (out.length >= max || depth > 3) return;
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (
        name === "node_modules" ||
        name === ".git" ||
        name === "dist" ||
        name === ".next"
      ) {
        continue;
      }
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full, depth + 1);
      else out.push(full.slice(root.length + 1).replace(/\\/g, "/"));
    }
  };
  walk(root, 0);
  return out;
}

function executeStaticDomain(input: {
  runId: string;
  projectId: string;
  domain: string;
  workspaceRoot: string | undefined;
  now: string;
  suppressedPatternKeys: ReadonlySet<string>;
}): {
  findings: QaFinding[];
  patternKeys: string[];
  regressionRules: QaRegressionRule[];
} {
  const findings: QaFinding[] = [];
  const patternKeys: string[] = [];
  const regressionRules: QaRegressionRule[] = [];
  const root = input.workspaceRoot;

  const pushOpen = (opts: {
    patternKey: string;
    title: string;
    summary: string;
    severity: QaFinding["severity"];
    rootCause: string;
    recommendedFix: string;
    evidenceIds: string[];
    riskClass: string | null;
  }) => {
    if (input.suppressedPatternKeys.has(opts.patternKey)) {
      regressionRules.push({
        id: patternIdFromKey(`regression:${opts.patternKey}`),
        projectId: input.projectId,
        patternKey: opts.patternKey,
        title: opts.title,
        originFindingId: null,
        preventingTestIds: [],
        timesSeen: 1,
        projectIdsSeen: [input.projectId],
        lastSeenAt: input.now,
        createdAt: input.now,
      });
      return;
    }
    patternKeys.push(opts.patternKey);
    findings.push(
      qaFindingSchema.parse({
        id: crypto.randomUUID(),
        runId: input.runId,
        projectId: input.projectId,
        domain: input.domain,
        severity: opts.severity,
        status: "OPEN",
        title: opts.title,
        summary: `${opts.summary} [pattern:${opts.patternKey}] refs:${opts.evidenceIds.join(",")}`,
        epistemicState: "OBSERVED",
        riskClass: opts.riskClass,
        component: null,
        evidenceIds: [],
        rootCause: opts.rootCause,
        recommendedFix: opts.recommendedFix,
        relatedHistoricalFindingIds: [],
        portfolioPatternId: patternIdFromKey(opts.patternKey),
        createdAt: input.now,
        updatedAt: input.now,
      }),
    );
  };

  if (!root || !existsSync(root)) {
    findings.push(
      qaFindingSchema.parse({
        id: crypto.randomUUID(),
        runId: input.runId,
        projectId: input.projectId,
        domain: input.domain,
        severity: "MEDIUM",
        status: "OPEN",
        title: `${input.domain}: workspace root missing`,
        summary:
          "No workspaceRoot evidence — cannot run static executor. Status UNKNOWN.",
        epistemicState: "UNKNOWN",
        riskClass: null,
        component: null,
        evidenceIds: [],
        rootCause: "missing_workspace_root",
        recommendedFix: "Pass workspaceRoot or set ATLAS_GOLDEN_PROJECT_ROOT.",
        relatedHistoricalFindingIds: [],
        portfolioPatternId: null,
        createdAt: input.now,
        updatedAt: input.now,
      }),
    );
    return { findings, patternKeys, regressionRules };
  }

  const files = listTopFiles(root);
  const hasPackage = files.some(
    (f) => f === "package.json" || f.endsWith("/package.json"),
  );
  const hasTests = files.some(
    (f) =>
      /(^|\/)(test|tests|__tests__|e2e|spec)(\/|$)/i.test(f) ||
      /\.(test|spec)\.(t|j)sx?$/i.test(f),
  );
  const hasCi = files.some(
    (f) =>
      f.includes(".github/workflows") ||
      f.endsWith("vercel.json") ||
      f.includes(".gitlab-ci"),
  );
  const hasEnvExample = files.some((f) => /env\.example|\.env\.example/i.test(f));

  if (input.domain === "ARCHITECTURE" || input.domain === "FUNCTIONAL") {
    if (!hasPackage) {
      pushOpen({
        patternKey: `domain:${input.domain}:no-package-json`,
        title: "No package.json observed at workspace root tree",
        summary: `Static scan of ${files.length} paths found no package.json.`,
        severity: "HIGH",
        rootCause: "missing_package_manifest",
        recommendedFix: "Confirm workspaceRoot points at the app repo.",
        evidenceIds: [`fs:${root}`],
        riskClass: "DEPENDENCY",
      });
    } else {
      findings.push(
        qaFindingSchema.parse({
          id: crypto.randomUUID(),
          runId: input.runId,
          projectId: input.projectId,
          domain: input.domain,
          severity: "LOW",
          status: "FIXED",
          title: "package.json observed",
          summary: `Static scan observed package manifest among ${files.length} paths.`,
          epistemicState: "OBSERVED",
          riskClass: null,
          component: null,
          evidenceIds: [],
          rootCause: null,
          recommendedFix: null,
          relatedHistoricalFindingIds: [],
          portfolioPatternId: null,
          createdAt: input.now,
          updatedAt: input.now,
        }),
      );
    }
  }

  if (input.domain === "UNIT" || input.domain === "REGRESSION" || input.domain === "E2E") {
    if (!hasTests) {
      pushOpen({
        patternKey: `domain:${input.domain}:missing-tests`,
        title: "No test files or test directories observed",
        summary:
          "Static executor found no *.test.* / *.spec.* / tests directories in shallow scan.",
        severity: "HIGH",
        rootCause: "missing_tests",
        recommendedFix: "Add critical-path tests; mark false positives via LEARN.",
        evidenceIds: [`fs-scan:${files.length}`],
        riskClass: "API_CONTRACT",
      });
    } else {
      findings.push(
        qaFindingSchema.parse({
          id: crypto.randomUUID(),
          runId: input.runId,
          projectId: input.projectId,
          domain: input.domain,
          severity: "LOW",
          status: "FIXED",
          title: "Test artifacts observed",
          summary: `Static scan found test paths — executor did not run them yet. sample:${files.filter((f) => /test|spec/i.test(f)).slice(0, 5).join(",")}`,
          epistemicState: "OBSERVED",
          riskClass: null,
          component: null,
          evidenceIds: [],
          rootCause: null,
          recommendedFix: null,
          relatedHistoricalFindingIds: [],
          portfolioPatternId: null,
          createdAt: input.now,
          updatedAt: input.now,
        }),
      );
    }
  }

  if (input.domain === "SECURITY" || input.domain === "DATABASE") {
    if (!hasEnvExample) {
      pushOpen({
        patternKey: `domain:${input.domain}:no-env-example`,
        title: "No .env.example observed",
        summary:
          "Config/security static check: missing env example increases config drift risk.",
        severity: "MEDIUM",
        rootCause: "missing_env_example",
        recommendedFix: "Add .env.example without secrets.",
        evidenceIds: [`fs-scan:${files.length}`],
        riskClass: "SECURITY_CONFIG",
      });
    }
  }

  if (input.domain === "DEPLOYMENT") {
    if (!hasCi) {
      pushOpen({
        patternKey: `domain:${input.domain}:no-ci`,
        title: "No CI workflow observed in shallow scan",
        summary: "No .github/workflows (or similar) found.",
        severity: "MEDIUM",
        rootCause: "missing_ci",
        recommendedFix: "Add CI pipeline with health checks.",
        evidenceIds: [`fs-scan:${files.length}`],
        riskClass: "DEPLOYMENT",
      });
    }
  }

  if (findings.length === 0) {
    findings.push(
      qaFindingSchema.parse({
        id: crypto.randomUUID(),
        runId: input.runId,
        projectId: input.projectId,
        domain: input.domain,
        severity: "LOW",
        status: "OPEN",
        title: `${input.domain}: static scan completed`,
        summary: `Scanned ${files.length} paths under workspace. No domain-specific gap matched heuristics.`,
        epistemicState: "OBSERVED",
        riskClass: null,
        component: null,
        evidenceIds: [],
        rootCause: null,
        recommendedFix: null,
        relatedHistoricalFindingIds: [],
        portfolioPatternId: null,
        createdAt: input.now,
        updatedAt: input.now,
      }),
    );
  }

  return { findings, patternKeys, regressionRules };
}

/**
 * Plans domains, runs static filesystem executor, applies LEARN suppressions.
 */
export function orchestrateQaAnalyze(
  input: OrchestrateQaInput,
): OrchestrateQaResult {
  const now = new Date().toISOString();
  const plan = planQaRun({
    scope: input.request.scope,
    profile: input.request.profile,
    environment: input.request.environment,
    projectIds: input.resolvedProjectIds,
    ...(input.changedPaths !== undefined
      ? { changedPaths: input.changedPaths }
      : {}),
    ...(input.request.userRequest !== undefined
      ? { userRequest: input.request.userRequest }
      : {}),
  });

  const runId = crypto.randomUUID();
  const findings: QaFinding[] = [];
  const emittedKeys: string[] = [];
  const regressionRulesTriggered: QaRegressionRule[] = [];
  const suppressed = new Set(input.priorLearnedPatternKeys ?? []);
  const explicitLearned = [...suppressed];
  const priorPatterns = input.priorPortfolioPatterns ?? [];
  const primaryProjectId = input.resolvedProjectIds[0] ?? null;
  const contextPatterns = retrieveRelevantPortfolioPatterns({
    patterns: priorPatterns,
    projectId: primaryProjectId,
    budget: input.patternContextBudget ?? 8,
    ...(input.request.userRequest !== undefined
      ? { query: input.request.userRequest }
      : {}),
    crossProjectOnly: true,
  });
  const priorByKey = new Map(
    priorPatterns.map((p) => [p.patternKey, p] as const),
  );

  for (const projectId of input.resolvedProjectIds) {
    const workspaceRoot = input.workspaceRoots?.[projectId];
    for (const domain of plan.domains.slice(0, 6)) {
      const result = executeStaticDomain({
        runId,
        projectId,
        domain,
        workspaceRoot,
        now,
        suppressedPatternKeys: suppressed,
      });
      findings.push(...result.findings);
      emittedKeys.push(...result.patternKeys);
      regressionRulesTriggered.push(...result.regressionRules);
    }
  }

  // Link OPEN findings to prior portfolio lessons (evidence ids only — no invented patterns).
  for (let i = 0; i < findings.length; i++) {
    const f = findings[i]!;
    const match = /\[pattern:([^\]]+)\]/.exec(f.summary);
    const prior = match?.[1] ? priorByKey.get(match[1]) : undefined;
    if (!prior || prior.projectIds.length < 2) continue;
    findings[i] = {
      ...f,
      portfolioPatternId: prior.id,
      relatedHistoricalFindingIds: [
        ...new Set([
          ...f.relatedHistoricalFindingIds,
          ...prior.findingIds.slice(0, 8),
        ]),
      ].slice(0, 12),
    };
  }

  const seeds = extractPatternSeedsFromFindings(findings);
  const accumulated = accumulatePortfolioPatterns(priorPatterns, seeds, now);
  // Report surface: cross-project after merge (includes prior + this run).
  const portfolioPatterns = accumulated.crossProject.filter((p) =>
    seeds.some((s) => s.patternKey === p.patternKey) ||
    input.request.scope === "ENTIRE_PORTFOLIO" ||
    input.request.profile === "PORTFOLIO",
  );

  const learnedPatternIds = [
    ...new Set([
      ...explicitLearned.map((k) => patternIdFromKey(k)),
      ...accumulated.merged.map((p) => p.id),
      ...findings
        .map((f) => f.portfolioPatternId)
        .filter((x): x is string => Boolean(x)),
    ]),
  ];

  const openFindings = findings.filter((f) => f.status === "OPEN");
  const severityCounts = {
    CRITICAL: openFindings.filter((f) => f.severity === "CRITICAL").length,
    HIGH: openFindings.filter((f) => f.severity === "HIGH").length,
    MEDIUM: openFindings.filter((f) => f.severity === "MEDIUM").length,
    LOW: openFindings.filter((f) => f.severity === "LOW").length,
  };

  const observed = findings.filter((f) => f.epistemicState === "OBSERVED").length;
  const unknown = findings.filter((f) => f.epistemicState === "UNKNOWN").length;
  const patternLessons = formatPatternLessonsForContext(contextPatterns);
  const topRiskTitles = [
    ...patternLessons.slice(0, 3),
    ...plan.riskHints.map((h) => `${h.riskClass}: ${h.reason}`),
  ].slice(0, 8);

  const run: QaRun = qaRunSchema.parse({
    id: runId,
    scope: input.request.scope,
    profile: input.request.profile,
    environment: input.request.environment,
    status: "SUCCEEDED",
    projectIds: [...input.resolvedProjectIds],
    domainsPlanned: [...plan.domains],
    userRequest: input.request.userRequest ?? null,
    scorecard: {
      testCoveragePercent: null,
      criticalPathsTestedPercent: null,
      securityReadinessPercent: null,
      productionReadinessPercent: null,
      evidenceSignalCount: observed,
      inferredSignalCount: unknown + contextPatterns.length,
    },
    severityCounts,
    topRiskTitles,
    findingIds: findings.map((f) => f.id),
    learnedPatternIds,
    writeGateLocked: true,
    startedAt: now,
    completedAt: now,
    createdAt: now,
  });

  return {
    run,
    findings,
    portfolioPatterns,
    regressionRulesTriggered,
    learnedPatternKeys: explicitLearned,
    emittedPatternKeys: [...new Set(emittedKeys)],
    durablePatterns: accumulated.durableFromRun,
    contextPatterns,
    patternLessons,
  };
}

export * from "./planner/plan.js";
export * from "./portfolio/patterns.js";

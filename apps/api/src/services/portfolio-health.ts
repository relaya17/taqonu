import {
  portfolioHealthReportSchema,
  type PortfolioHealthProjectItem,
  type PortfolioHealthReport,
  type PortfolioVerdictHint,
  type SystemHealthReport,
} from "@atlas/shared";

export const PORTFOLIO_HEALTH_META_KEY = "portfolio.lastHealth";

const VERDICT_RANK: Record<PortfolioVerdictHint, number> = {
  UNKNOWN: 0,
  READY: 1,
  CONDITIONAL: 2,
  BLOCKED: 3,
};

const SEV_RANK: Record<PortfolioIssueSeed["severity"], number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

export type PortfolioIssueSeed = {
  title: string;
  category: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  projectId: string;
};

/** Normalize issue titles so the same gap across repos shares one pattern key. */
export function normalizeIssuePatternKey(
  category: string,
  title: string,
): string {
  const normalized = title
    .replace(/\b[\w./\\-]+\.(ts|tsx|js|jsx|json|yml|yaml|env|md)\b/gi, "<file>")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 140);
  return `${category.toUpperCase()}:${normalized}`;
}

export function inferProjectVerdictHint(input: {
  overallScore: number | null;
  criticalIssues: number;
  highRisk: number;
  constitutionScore: number | null;
  audited: boolean;
}): PortfolioVerdictHint {
  if (!input.audited || input.overallScore == null) return "UNKNOWN";
  if (input.criticalIssues > 0) return "BLOCKED";
  if (
    input.highRisk > 0 ||
    (input.constitutionScore != null && input.constitutionScore < 70) ||
    input.overallScore < 70
  ) {
    return "CONDITIONAL";
  }
  return "READY";
}

export function worstVerdict(
  hints: readonly PortfolioVerdictHint[],
): PortfolioVerdictHint {
  let worst: PortfolioVerdictHint = "UNKNOWN";
  for (const hint of hints) {
    if (VERDICT_RANK[hint] > VERDICT_RANK[worst]) worst = hint;
  }
  return worst;
}

export function detectSharedIssuePatterns(
  seeds: readonly PortfolioIssueSeed[],
): PortfolioHealthReport["aggregate"]["sharedPatterns"] {
  const byKey = new Map<
    string,
    {
      title: string;
      category: string;
      severity: PortfolioIssueSeed["severity"];
      projectIds: Set<string>;
      count: number;
    }
  >();

  for (const seed of seeds) {
    if (seed.severity === "LOW") continue;
    const key = normalizeIssuePatternKey(seed.category, seed.title);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, {
        title: seed.title.replace(
          /\b[\w./\\-]+\.(ts|tsx|js|jsx|json|yml|yaml|env|md)\b/gi,
          "<file>",
        ),
        category: seed.category,
        severity: seed.severity,
        projectIds: new Set([seed.projectId]),
        count: 1,
      });
      continue;
    }
    prev.projectIds.add(seed.projectId);
    prev.count += 1;
    if (SEV_RANK[seed.severity] > SEV_RANK[prev.severity]) {
      prev.severity = seed.severity;
    }
  }

  return [...byKey.entries()]
    .filter(([, g]) => g.projectIds.size >= 2)
    .map(([key, g]) => ({
      key,
      title: g.title,
      category: g.category,
      severity: g.severity,
      projectIds: [...g.projectIds],
      projectCount: g.projectIds.size,
      occurrenceCount: g.count,
    }))
    .sort((a, b) => {
      const sev = SEV_RANK[b.severity] - SEV_RANK[a.severity];
      if (sev !== 0) return sev;
      return b.projectCount - a.projectCount;
    })
    .slice(0, 12);
}

export function summarizeSystemHealthReport(
  report: SystemHealthReport,
  meta: {
    slug: string;
    name: string;
    workspaceRoot: string | null;
    notes?: string;
  },
): {
  item: PortfolioHealthProjectItem;
  issueSeeds: PortfolioIssueSeed[];
} {
  const blockers = report.issues
    .filter((i) => i.severity === "CRITICAL" || i.severity === "HIGH")
    .slice(0, 8)
    .map((i) => ({
      title: i.title,
      severity: i.severity as "CRITICAL" | "HIGH",
      category: i.category,
    }));

  const verdictHint = inferProjectVerdictHint({
    overallScore: report.overallScore,
    criticalIssues: report.criticalIssues,
    highRisk: report.highRisk,
    constitutionScore: report.constitution?.overallScore ?? null,
    audited: true,
  });

  const item: PortfolioHealthProjectItem = {
    projectId: report.projectId ?? "00000000-0000-4000-8000-000000000099",
    slug: meta.slug,
    name: meta.name,
    workspaceRoot: meta.workspaceRoot,
    overallScore: report.overallScore,
    criticalIssues: report.criticalIssues,
    highRisk: report.highRisk,
    constitutionScore: report.constitution?.overallScore ?? null,
    architectureDriftScore: report.architectureDriftScore,
    dimensions: report.dimensions.map((d) => ({
      key: d.key,
      score: d.score,
    })),
    blockers,
    driftCount: report.driftFindings.length,
    verdictHint,
    epistemicState: "OBSERVED",
    notes:
      meta.notes ??
      `drift ${report.driftFindings.length} · issues ${report.issues.length} · constitution ${report.constitution?.overallScore ?? "—"}`,
  };

  const issueSeeds: PortfolioIssueSeed[] = report.issues
    .filter(() => Boolean(report.projectId))
    .map((issue) => ({
      title: issue.title,
      category: issue.category,
      severity: issue.severity,
      projectId: report.projectId!,
    }));

  // Drift as an explicit cross-portfolio pattern seed
  if (report.driftFindings.length > 0 && report.projectId) {
    issueSeeds.push({
      title: "Architecture drift: Frontend → Database",
      category: "ARCHITECTURE",
      severity: "CRITICAL",
      projectId: report.projectId,
    });
  }

  return { item, issueSeeds };
}

export function skippedPortfolioItem(input: {
  projectId: string;
  slug: string;
  name: string;
  workspaceRoot: string | null;
  notes: string;
}): PortfolioHealthProjectItem {
  return {
    projectId: input.projectId,
    slug: input.slug,
    name: input.name,
    workspaceRoot: input.workspaceRoot,
    overallScore: null,
    criticalIssues: 0,
    highRisk: 0,
    constitutionScore: null,
    architectureDriftScore: null,
    dimensions: [],
    blockers: [],
    driftCount: 0,
    verdictHint: "UNKNOWN",
    epistemicState: "UNKNOWN",
    notes: input.notes,
  };
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

export function rollupPortfolioHealth(input: {
  items: PortfolioHealthProjectItem[];
  issueSeeds: PortfolioIssueSeed[];
  projectCount: number;
  asOf: string;
  note: string;
  persisted?: boolean;
}): PortfolioHealthReport {
  const scored = input.items.filter((i) => i.overallScore != null);
  const overalls = scored.map((i) => i.overallScore as number);
  const constitutions = scored
    .map((i) => i.constitutionScore)
    .filter((n): n is number => n != null);

  const criticalTotal = input.items.reduce((a, b) => a + b.criticalIssues, 0);
  const highTotal = input.items.reduce((a, b) => a + b.highRisk, 0);
  const openBlockers = input.items.reduce((a, b) => a + b.blockers.length, 0);

  const dimKeys = [
    "architecture",
    "security",
    "dependencies",
    "codeQuality",
    "testing",
    "performance",
    "observability",
  ] as const;

  const worstDimensions = dimKeys
    .map((key) => {
      let worstScore = 101;
      let worstProject: PortfolioHealthProjectItem | null = null;
      const scores: number[] = [];
      for (const item of scored) {
        const dim = item.dimensions.find((d) => d.key === key);
        if (!dim) continue;
        scores.push(dim.score);
        if (dim.score < worstScore) {
          worstScore = dim.score;
          worstProject = item;
        }
      }
      if (!worstProject || scores.length === 0) return null;
      return {
        key,
        worstScore,
        averageScore: avg(scores) ?? worstScore,
        projectId: worstProject.projectId,
        projectName: worstProject.name,
      };
    })
    .filter((d): d is NonNullable<typeof d> => d != null)
    .sort((a, b) => a.worstScore - b.worstScore)
    .slice(0, 5);

  const sharedPatterns = detectSharedIssuePatterns(input.issueSeeds);
  const portfolioVerdict = worstVerdict(
    scored.map((i) => i.verdictHint ?? "UNKNOWN"),
  );

  const averageScore = avg(overalls);
  const worstOfScore =
    overalls.length === 0 ? null : Math.min(...overalls);

  const verdictSpread = {
    READY: 0,
    CONDITIONAL: 0,
    BLOCKED: 0,
    UNKNOWN: 0,
  };
  for (const item of input.items) {
    const hint = item.verdictHint ?? "UNKNOWN";
    verdictSpread[hint] += 1;
  }

  const constitutionPassRate =
    constitutions.length === 0
      ? null
      : constitutions.filter((c) => c >= 70).length / constitutions.length;

  const missingWorkspaceRoot = input.items.filter(
    (i) => !i.workspaceRoot,
  ).length;

  return portfolioHealthReportSchema.parse({
    projectCount: input.projectCount,
    audited: scored.length,
    skipped: input.items.length - scored.length,
    averageScore,
    criticalTotal,
    aggregate: {
      averageScore,
      worstOfScore,
      criticalTotal,
      highTotal,
      constitutionWorst:
        constitutions.length === 0 ? null : Math.min(...constitutions),
      constitutionAverage: avg(constitutions),
      openBlockers,
      worstDimensions,
      sharedPatterns,
      portfolioVerdict: scored.length === 0 ? "UNKNOWN" : portfolioVerdict,
      verdictSpread,
      constitutionPassRate,
      missingWorkspaceRoot,
    },
    items: input.items,
    epistemicState: scored.length > 0 ? "OBSERVED" : "UNKNOWN",
    asOf: input.asOf,
    note: input.note,
    ...(input.persisted != null ? { persisted: input.persisted } : {}),
  });
}

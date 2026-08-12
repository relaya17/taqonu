import { describe, expect, it } from "vitest";
import {
  detectSharedIssuePatterns,
  inferProjectVerdictHint,
  normalizeIssuePatternKey,
  rollupPortfolioHealth,
  skippedPortfolioItem,
  worstVerdict,
} from "./portfolio-health.js";
import type { PortfolioHealthProjectItem } from "@atlas/shared";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const NOW = "2026-08-12T00:00:00.000Z";

function auditedItem(
  partial: Partial<PortfolioHealthProjectItem> &
    Pick<PortfolioHealthProjectItem, "projectId" | "slug" | "name">,
): PortfolioHealthProjectItem {
  return {
    workspaceRoot: "/tmp/x",
    overallScore: 80,
    criticalIssues: 0,
    highRisk: 0,
    constitutionScore: 85,
    architectureDriftScore: 90,
    dimensions: [
      { key: "architecture", score: 90 },
      { key: "security", score: 70 },
      { key: "dependencies", score: 80 },
      { key: "codeQuality", score: 75 },
      { key: "testing", score: 60 },
      { key: "performance", score: 88 },
      { key: "observability", score: 70 },
    ],
    blockers: [],
    driftCount: 0,
    verdictHint: "READY",
    epistemicState: "OBSERVED",
    notes: "ok",
    ...partial,
  };
}

describe("portfolio health rollup", () => {
  it("normalizes file paths so the same issue shares a pattern key", () => {
    const a = normalizeIssuePatternKey(
      "SECURITY",
      "Possible secret material in apps/api/src/foo.ts",
    );
    const b = normalizeIssuePatternKey(
      "SECURITY",
      "Possible secret material in packages/web/bar.ts",
    );
    expect(a).toBe(b);
  });

  it("infers verdict hints from critical / constitution / score", () => {
    expect(
      inferProjectVerdictHint({
        overallScore: 90,
        criticalIssues: 1,
        highRisk: 0,
        constitutionScore: 90,
        audited: true,
      }),
    ).toBe("BLOCKED");
    expect(
      inferProjectVerdictHint({
        overallScore: 65,
        criticalIssues: 0,
        highRisk: 0,
        constitutionScore: 80,
        audited: true,
      }),
    ).toBe("CONDITIONAL");
    expect(
      inferProjectVerdictHint({
        overallScore: 88,
        criticalIssues: 0,
        highRisk: 0,
        constitutionScore: 90,
        audited: true,
      }),
    ).toBe("READY");
    expect(
      inferProjectVerdictHint({
        overallScore: null,
        criticalIssues: 0,
        highRisk: 0,
        constitutionScore: null,
        audited: false,
      }),
    ).toBe("UNKNOWN");
  });

  it("detects shared patterns only across ≥2 projects", () => {
    const patterns = detectSharedIssuePatterns([
      {
        title: "No lockfile detected",
        category: "DEPENDENCY",
        severity: "HIGH",
        projectId: A,
      },
      {
        title: "No lockfile detected",
        category: "DEPENDENCY",
        severity: "HIGH",
        projectId: B,
      },
      {
        title: "Floating version range in package.json",
        category: "VERSIONS",
        severity: "MEDIUM",
        projectId: A,
      },
    ]);
    expect(patterns).toHaveLength(1);
    expect(patterns[0]?.projectCount).toBe(2);
    expect(patterns[0]?.key).toContain("DEPENDENCY");
  });

  it("rolls up worst-of, constitution, blockers, and worst dimensions", () => {
    const items = [
      auditedItem({
        projectId: A,
        slug: "alpha",
        name: "Alpha",
        overallScore: 82,
        constitutionScore: 88,
        verdictHint: "READY",
        dimensions: [
          { key: "architecture", score: 95 },
          { key: "security", score: 80 },
          { key: "dependencies", score: 80 },
          { key: "codeQuality", score: 80 },
          { key: "testing", score: 55 },
          { key: "performance", score: 90 },
          { key: "observability", score: 80 },
        ],
      }),
      auditedItem({
        projectId: B,
        slug: "beta",
        name: "Beta",
        overallScore: 55,
        criticalIssues: 2,
        highRisk: 3,
        constitutionScore: 40,
        verdictHint: "BLOCKED",
        blockers: [
          {
            title: "Possible secret material in <file>",
            severity: "CRITICAL",
            category: "SECURITY",
          },
        ],
        dimensions: [
          { key: "architecture", score: 40 },
          { key: "security", score: 30 },
          { key: "dependencies", score: 50 },
          { key: "codeQuality", score: 60 },
          { key: "testing", score: 70 },
          { key: "performance", score: 80 },
          { key: "observability", score: 60 },
        ],
      }),
      skippedPortfolioItem({
        projectId: C,
        slug: "gamma",
        name: "Gamma",
        workspaceRoot: null,
        notes: "No explicit workspaceRoot",
      }),
    ];

    const report = rollupPortfolioHealth({
      items,
      issueSeeds: [
        {
          title: "Architecture drift: Frontend → Database",
          category: "ARCHITECTURE",
          severity: "CRITICAL",
          projectId: A,
        },
        {
          title: "Architecture drift: Frontend → Database",
          category: "ARCHITECTURE",
          severity: "CRITICAL",
          projectId: B,
        },
      ],
      projectCount: 3,
      asOf: NOW,
      note: "test",
    });

    expect(report.audited).toBe(2);
    expect(report.skipped).toBe(1);
    expect(report.aggregate.averageScore).toBe(69);
    expect(report.aggregate.worstOfScore).toBe(55);
    expect(report.aggregate.criticalTotal).toBe(2);
    expect(report.aggregate.constitutionWorst).toBe(40);
    expect(report.aggregate.portfolioVerdict).toBe("BLOCKED");
    expect(report.aggregate.openBlockers).toBe(1);
    expect(report.aggregate.sharedPatterns).toHaveLength(1);
    expect(report.aggregate.worstDimensions[0]?.key).toBe("security");
    expect(report.aggregate.worstDimensions[0]?.worstScore).toBe(30);
    expect(report.aggregate.worstDimensions[0]?.projectName).toBe("Beta");
  });

  it("worstVerdict picks the most severe hint", () => {
    expect(worstVerdict(["READY", "CONDITIONAL", "UNKNOWN"])).toBe(
      "CONDITIONAL",
    );
    expect(worstVerdict(["READY", "BLOCKED"])).toBe("BLOCKED");
  });
});

import { describe, expect, it } from "vitest";
import { qaFindingSchema, type QaFinding } from "@atlas/shared";
import {
  accumulatePortfolioPatterns,
  durablePatternsFromSeeds,
  extractPatternSeedsFromFindings,
  filterPortfolioPatterns,
  mergePatternRecords,
  patternIdFromKey,
  retrieveRelevantPortfolioPatterns,
} from "./patterns.js";

const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_B = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-08-12T00:00:00.000Z";

function openFinding(opts: {
  projectId: string;
  patternKey: string;
  domain?: QaFinding["domain"];
  severity?: QaFinding["severity"];
}): QaFinding {
  return qaFindingSchema.parse({
    id: crypto.randomUUID(),
    runId: crypto.randomUUID(),
    projectId: opts.projectId,
    domain: opts.domain ?? "ARCHITECTURE",
    severity: opts.severity ?? "HIGH",
    status: "OPEN",
    title: `Gap: ${opts.patternKey}`,
    summary: `Observed gap [pattern:${opts.patternKey}] refs:fs:scan`,
    epistemicState: "OBSERVED",
    riskClass: "DEPENDENCY",
    component: null,
    evidenceIds: [],
    rootCause: "static_scan",
    recommendedFix: "Fix and LEARN if false positive",
    relatedHistoricalFindingIds: [],
    portfolioPatternId: patternIdFromKey(opts.patternKey),
    createdAt: NOW,
    updatedAt: NOW,
  });
}

describe("QA LEARN portfolio patterns", () => {
  it("extracts seeds only from OBSERVED OPEN findings with pattern tags", () => {
    const findings = [
      openFinding({
        projectId: PROJECT_A,
        patternKey: "domain:ARCHITECTURE:no-package-json",
      }),
      qaFindingSchema.parse({
        ...openFinding({
          projectId: PROJECT_A,
          patternKey: "ignored",
        }),
        epistemicState: "UNKNOWN",
        summary: "No pattern tag — workspace missing",
        portfolioPatternId: null,
      }),
    ];
    const seeds = extractPatternSeedsFromFindings(findings);
    expect(seeds).toHaveLength(1);
    expect(seeds[0]?.patternKey).toBe("domain:ARCHITECTURE:no-package-json");
  });

  it("persists single-project durable patterns then retrieves cross-project after second project", () => {
    const key = "domain:UNIT:missing-tests";
    const stableId = patternIdFromKey(key);

    const runASeeds = extractPatternSeedsFromFindings([
      openFinding({ projectId: PROJECT_A, patternKey: key, domain: "UNIT" }),
    ]);
    const runA = accumulatePortfolioPatterns([], runASeeds, NOW);
    expect(runA.durableFromRun).toHaveLength(1);
    expect(runA.durableFromRun[0]?.projectIds).toEqual([PROJECT_A]);
    expect(runA.crossProject).toHaveLength(0);

    // Simulate portfolio store persist
    let store = mergePatternRecords([], runA.durableFromRun);
    expect(store).toHaveLength(1);
    expect(store[0]?.id).toBe(stableId);

    const runBSeeds = extractPatternSeedsFromFindings([
      openFinding({ projectId: PROJECT_B, patternKey: key, domain: "UNIT" }),
    ]);
    const runB = accumulatePortfolioPatterns(store, runBSeeds, NOW);
    expect(runB.crossProject).toHaveLength(1);
    expect(runB.crossProject[0]?.id).toBe(stableId);
    expect(runB.crossProject[0]?.projectIds.sort()).toEqual(
      [PROJECT_A, PROJECT_B].sort(),
    );

    store = mergePatternRecords(store, runB.durableFromRun);
    expect(store[0]?.projectIds).toHaveLength(2);

    const forProjectB = retrieveRelevantPortfolioPatterns({
      patterns: store,
      projectId: PROJECT_B,
      budget: 4,
      crossProjectOnly: true,
    });
    expect(forProjectB).toHaveLength(1);
    expect(forProjectB[0]?.patternKey).toBe(key);

    const forProjectA = filterPortfolioPatterns({
      patterns: store,
      projectId: PROJECT_A,
      portfolioOnly: true,
    });
    expect(forProjectA).toHaveLength(1);
  });

  it("keeps pattern IDs stable across projects and runs", () => {
    const key = "domain:SECURITY:no-env-example";
    const a = durablePatternsFromSeeds(
      extractPatternSeedsFromFindings([
        openFinding({ projectId: PROJECT_A, patternKey: key, domain: "SECURITY" }),
      ]),
      NOW,
    );
    const b = durablePatternsFromSeeds(
      extractPatternSeedsFromFindings([
        openFinding({ projectId: PROJECT_B, patternKey: key, domain: "SECURITY" }),
      ]),
      NOW,
    );
    expect(a[0]?.id).toBe(b[0]?.id);
    expect(a[0]?.id).toBe(patternIdFromKey(key));
  });

  it("budgets retrieval and prefers cross-project lessons", () => {
    const patterns = [
      ...durablePatternsFromSeeds(
        extractPatternSeedsFromFindings([
          openFinding({
            projectId: PROJECT_A,
            patternKey: "domain:DEPLOYMENT:no-ci",
            domain: "DEPLOYMENT",
            severity: "MEDIUM",
          }),
        ]),
        NOW,
      ),
      ...accumulatePortfolioPatterns(
        durablePatternsFromSeeds(
          extractPatternSeedsFromFindings([
            openFinding({
              projectId: PROJECT_A,
              patternKey: "domain:FUNCTIONAL:no-package-json",
              domain: "FUNCTIONAL",
              severity: "HIGH",
            }),
          ]),
          NOW,
        ),
        extractPatternSeedsFromFindings([
          openFinding({
            projectId: PROJECT_B,
            patternKey: "domain:FUNCTIONAL:no-package-json",
            domain: "FUNCTIONAL",
            severity: "HIGH",
          }),
        ]),
        NOW,
      ).merged,
    ];

    const retrieved = retrieveRelevantPortfolioPatterns({
      patterns,
      projectId: PROJECT_B,
      budget: 1,
      crossProjectOnly: true,
    });
    expect(retrieved).toHaveLength(1);
    expect(retrieved[0]?.patternKey).toBe("domain:FUNCTIONAL:no-package-json");
    expect(retrieved[0]?.projectIds.length).toBeGreaterThanOrEqual(2);
  });
});

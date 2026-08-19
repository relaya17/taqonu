import { describe, expect, it } from "vitest";
import { buildPortfolioContextBlocks } from "./portfolio.js";

/**
 * Fixture aliases derived from the function's own parameter type, so these
 * tests stay pinned to the real contract instead of `any`. The fixtures
 * below are deliberately partial — each test only populates the fields the
 * assertion actually depends on — so they go through an explicit
 * `as unknown as T` rather than pretending to be complete records. That
 * keeps the cast visible and narrow (and lint-clean) instead of erasing the
 * type entirely with `any`, which is what these previously did.
 */
type PortfolioContextInput = Parameters<typeof buildPortfolioContextBlocks>[0];
type PortfolioProject = PortfolioContextInput["projects"][number];
type PortfolioDecision = PortfolioContextInput["decisions"][number];
type PortfolioEvidence = PortfolioContextInput["evidence"][number];

describe("buildPortfolioContextBlocks", () => {
  it("marks the portfolio registry UNKNOWN when there are no projects", () => {
    const blocks = buildPortfolioContextBlocks({
      projects: [],
      projectId: null,
      snapshot: null,
      decisions: [],
      memories: [],
      evidence: [],
    });
    const registry = blocks.find((b) => b.title === "Portfolio registry");
    expect(registry?.epistemicState).toBe("UNKNOWN");
  });

  it("marks the portfolio registry FACT when projects exist and lists them", () => {
    const blocks = buildPortfolioContextBlocks({
      projects: [
        {
          id: "1",
          slug: "p1",
          name: "Project One",
          status: "ACTIVE",
        } as unknown as PortfolioProject,
      ],
      projectId: null,
      snapshot: null,
      decisions: [],
      memories: [],
      evidence: [],
    });
    const registry = blocks.find((b) => b.title === "Portfolio registry");
    expect(registry?.epistemicState).toBe("FACT");
    expect(registry?.content).toContain("Project One");
  });

  it("flags an UNKNOWN 'no reconciled snapshot' block when a project is selected but has no snapshot", () => {
    const blocks = buildPortfolioContextBlocks({
      projects: [],
      projectId: "proj-1",
      snapshot: null,
      decisions: [],
      memories: [],
      evidence: [],
    });
    const current = blocks.find((b) => b.title === "Current State");
    expect(current?.epistemicState).toBe("UNKNOWN");
  });

  it("only surfaces ACTIVE decisions, and caps at the last 8", () => {
    const decisions = Array.from({ length: 10 }, (_, i) => ({
      id: `d${i}`,
      decision: `decision ${i}`,
      status: i % 2 === 0 ? "ACTIVE" : "SUPERSEDED",
      epistemicState: "FACT",
    })) as unknown as PortfolioDecision[];
    const blocks = buildPortfolioContextBlocks({
      projects: [],
      projectId: null,
      snapshot: null,
      decisions,
      memories: [],
      evidence: [],
    });
    const decisionBlocks = blocks.filter((b) => b.category === "DECISION_MEMORY");

    // The previous assertion here was tautological: it ignored its own `b`
    // parameter (which is why lint flagged `b` as unused) and its inner
    // predicate — "does ANY decision have status ACTIVE" — was a constant
    // `true` for this fixture regardless of what the blocks contained. It
    // could never have failed, so it never actually tested the "only
    // surfaces ACTIVE decisions" claim in this test's own name. These
    // assertions test that claim for real: every SUPERSEDED decision's text
    // must be absent, and every surfaced block must carry an ACTIVE one.
    const surfaced = decisionBlocks.map((b) => b.content).join("\n");
    for (const d of decisions) {
      if (d.status === "SUPERSEDED") {
        expect(surfaced).not.toContain(d.decision);
      }
    }
    expect(surfaced).toContain("decision 0");
    expect(decisionBlocks.length).toBeLessThanOrEqual(8);
  });

  it("adds an evidence-inventory block only when evidence records exist", () => {
    const withEvidence = buildPortfolioContextBlocks({
      projects: [],
      projectId: null,
      snapshot: null,
      decisions: [],
      memories: [],
      evidence: [{ id: "e1" } as unknown as PortfolioEvidence],
    });
    expect(withEvidence.some((b) => b.title === "Evidence inventory")).toBe(true);

    const withoutEvidence = buildPortfolioContextBlocks({
      projects: [],
      projectId: null,
      snapshot: null,
      decisions: [],
      memories: [],
      evidence: [],
    });
    expect(withoutEvidence.some((b) => b.title === "Evidence inventory")).toBe(false);
  });
});

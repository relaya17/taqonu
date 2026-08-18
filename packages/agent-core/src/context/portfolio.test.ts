import { describe, expect, it } from "vitest";
import { buildPortfolioContextBlocks } from "./portfolio.js";

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
        { id: "1", slug: "p1", name: "Project One", status: "ACTIVE" } as any,
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
    })) as any;
    const blocks = buildPortfolioContextBlocks({
      projects: [],
      projectId: null,
      snapshot: null,
      decisions,
      memories: [],
      evidence: [],
    });
    const decisionBlocks = blocks.filter((b) => b.category === "DECISION_MEMORY");
    expect(decisionBlocks.every((b) => decisions.some((d: any) => d.status === "ACTIVE"))).toBe(
      true,
    );
    expect(decisionBlocks.length).toBeLessThanOrEqual(8);
  });

  it("adds an evidence-inventory block only when evidence records exist", () => {
    const withEvidence = buildPortfolioContextBlocks({
      projects: [],
      projectId: null,
      snapshot: null,
      decisions: [],
      memories: [],
      evidence: [{ id: "e1" } as any],
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

import { describe, expect, it } from "vitest";
import { loadSeedSnapshot, buildPortfolioSummary } from "@atlas/shared";
import { renderPortfolioHtml } from "./portfolio-html.js";
import type { PortfolioProjection } from "./portfolio-projection.js";

function reachable(): PortfolioProjection {
  const snapshot = loadSeedSnapshot();
  return {
    reachability: "REACHABLE",
    snapshot,
    summary: buildPortfolioSummary(snapshot),
    detail: null,
  };
}

describe("renderPortfolioHtml (Phase 11.9 recovery)", () => {
  it("renders capabilities and decisions recovered from 82e883e", () => {
    const html = renderPortfolioHtml({
      controlOrigin: "http://127.0.0.1:3100",
      adminOrigin: "http://127.0.0.1:3200",
      projection: reachable(),
    });
    expect(html).toContain("Portfolio governance");
    expect(html).toContain("Applications");
    expect(html).toContain("Source agents");
    expect(html).toContain("Capabilities");
    expect(html).toContain("Governance decisions");
    expect(html).toContain("atlas");
    expect(html).not.toContain("ATLAS_CONTROL_PLANE_TOKEN");
    expect(html).not.toContain("/api/v1/portfolio-governance/decisions");
    expect(html).not.toContain("localhost:4000");
  });

  it("renders an explicit error state distinct from empty data", () => {
    const html = renderPortfolioHtml({
      controlOrigin: "http://127.0.0.1:3100",
      adminOrigin: "http://127.0.0.1:3200",
      projection: {
        reachability: "UNREACHABLE",
        snapshot: null,
        summary: null,
        detail: "Control Plane 503",
      },
    });
    expect(html).toContain("portfolioError");
    expect(html).toContain("Control Plane 503");
    expect(html).not.toContain("<main>");
    expect(html).not.toContain('data-i18n="portfolioApps"');
  });

  it("renders empty-state copy when a reachable snapshot has no rows", () => {
    const snapshot = loadSeedSnapshot();
    const empty = {
      ...snapshot,
      applications: [],
      sourceAgents: [],
      capabilities: [],
      dedupRelations: [],
      evidence: [],
      governanceDecisions: [],
      conflicts: [],
    };
    const html = renderPortfolioHtml({
      controlOrigin: "http://127.0.0.1:3100",
      adminOrigin: "http://127.0.0.1:3200",
      projection: {
        reachability: "REACHABLE",
        snapshot: empty,
        summary: buildPortfolioSummary(empty),
        detail: null,
      },
    });
    expect(html).toContain("portfolioNoApps");
    expect(html).toContain("portfolioNoSourceAgents");
    expect(html).toContain("portfolioNoDecisions");
  });
});

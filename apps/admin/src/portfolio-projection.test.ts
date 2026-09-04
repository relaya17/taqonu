import { describe, expect, it } from "vitest";
import { loadSeedSnapshot, buildPortfolioSummary } from "@atlas/shared";
import { loadPortfolioProjection } from "./portfolio-projection.js";

describe("loadPortfolioProjection (Phase 11.9 Option A)", () => {
  it("reads only the Control Plane portfolio path", async () => {
    const snapshot = loadSeedSnapshot();
    const summary = buildPortfolioSummary(snapshot);
    const urls: string[] = [];
    const projection = await loadPortfolioProjection({
      controlOrigin: "http://127.0.0.1:3100",
      fetchJson: async (url) => {
        urls.push(url);
        return { snapshot, summary, observational: true, writeAuthority: "ATLAS_API" };
      },
    });
    expect(urls).toEqual(["http://127.0.0.1:3100/api/v1/portfolio-governance"]);
    expect(projection.reachability).toBe("REACHABLE");
    expect(projection.snapshot?.applications.length).toBe(7);
    expect(projection.summary?.executionRegistry).toBe("FABRIC_AGENT_CATALOG");
  });

  it("does not invent state when Control Plane is unreachable", async () => {
    const projection = await loadPortfolioProjection({
      controlOrigin: "http://127.0.0.1:3100",
      fetchJson: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(projection.reachability).toBe("UNREACHABLE");
    expect(projection.snapshot).toBeNull();
    expect(projection.summary).toBeNull();
    expect(projection.detail).toBe("ECONNREFUSED");
  });

  it("rejects an unexpected payload instead of fabricating a snapshot", async () => {
    const projection = await loadPortfolioProjection({
      controlOrigin: "http://127.0.0.1:3100",
      fetchJson: async () => ({ ok: true }),
    });
    expect(projection.reachability).toBe("UNREACHABLE");
    expect(projection.detail).toMatch(/unexpected payload/);
  });

  it("stays unread when no fetch helper is supplied", async () => {
    const projection = await loadPortfolioProjection({
      controlOrigin: "http://127.0.0.1:3100",
    });
    expect(projection.reachability).toBe("UNREACHABLE");
    expect(projection.detail).toMatch(/not fetched/);
  });
});

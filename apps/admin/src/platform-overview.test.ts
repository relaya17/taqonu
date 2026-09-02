import { describe, expect, it } from "vitest";
import {
  composePlatformOverview,
  configuredStudioSnapshot,
} from "./platform-overview.js";

describe("composePlatformOverview", () => {
  it("uses the Control supervision contract and does not invent Studio connectivity", async () => {
    const overview = await composePlatformOverview({
      adminOrigin: "http://127.0.0.1:3200",
      controlOrigin: "http://127.0.0.1:3100",
      studioOrigin: "http://localhost:3000",
      fetchJson: async (url) => {
        if (url.endsWith("/api/v1/supervision")) {
          return {
            surface: "CONTROL",
            parentSurface: "ADMIN",
            role: "operational_supervision",
            runtime: "apps/control-plane",
            origin: "http://127.0.0.1:3100",
            reachability: "REACHABLE",
            health: "healthy",
            generatedAt: "2026-09-02T00:00:00.000Z",
            metrics: { registeredApplications: 1, oversightAgents: 9 },
            notes: ["Operational supervision layer. Not Atlas Admin. Not Studio."],
          };
        }
        throw new Error(`unexpected ${url}`);
      },
    });

    expect(overview.hierarchy.adminSupervises).toEqual(["CONTROL", "STUDIO"]);
    expect(overview.admin.surface).toBe("ADMIN");
    expect(overview.control.reachability).toBe("REACHABLE");
    expect(overview.control.metrics["oversightAgents"]).toBe(9);
    expect(overview.studio.reachability).toBe("CONFIGURED");
    expect(overview.studio.metrics).toEqual({});
  });

  it("marks Control unreachable without fabricating applications", async () => {
    const overview = await composePlatformOverview({
      adminOrigin: "http://127.0.0.1:3200",
      controlOrigin: "http://127.0.0.1:3100",
      studioOrigin: "http://localhost:3000",
      fetchJson: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(overview.control.reachability).toBe("UNREACHABLE");
    expect(overview.control.health).toBe("down");
    expect(overview.control.metrics).toEqual({});
    expect(overview.studio.reachability).toBe(
      configuredStudioSnapshot("http://localhost:3000").reachability,
    );
    expect(overview.studio.metrics).toEqual({});
  });
});

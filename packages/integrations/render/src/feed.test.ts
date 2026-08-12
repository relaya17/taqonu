import { describe, expect, it } from "vitest";
import { summarizeRenderFeed } from "./feed.js";

describe("summarizeRenderFeed", () => {
  it("summarizes a live production observation", () => {
    const summary = summarizeRenderFeed({
      projectId: "11111111-1111-4111-8111-111111111111",
      serviceName: "atlas-api",
      serviceUrl: "https://atlas-api.onrender.com",
      environment: "production",
      status: "live",
      commitSha: "def5678",
    });
    expect(summary.summary).toContain("live");
    expect(summary.url).toBe("https://atlas-api.onrender.com");
  });
});

import { describe, expect, it } from "vitest";
import { summarizeVercelFeed } from "./feed.js";

describe("summarizeVercelFeed", () => {
  it("summarizes a production READY observation", () => {
    const summary = summarizeVercelFeed({
      projectId: "11111111-1111-4111-8111-111111111111",
      projectName: "taqonu-api",
      deploymentUrl: "https://taqonu-api.vercel.app",
      environment: "production",
      readyState: "READY",
      commitSha: "abc1234",
    });
    expect(summary.summary).toContain("READY");
    expect(summary.url).toBe("https://taqonu-api.vercel.app");
  });
});

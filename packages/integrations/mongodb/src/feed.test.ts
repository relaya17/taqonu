import { describe, expect, it } from "vitest";
import { mongoFeedInputSchema, summarizeMongoFeed } from "./feed.js";

describe("mongodb feed (customer observation, not Atlas DB)", () => {
  it("summarizes collection metadata only", () => {
    const input = mongoFeedInputSchema.parse({
      projectId: "11111111-1111-4111-8111-111111111111",
      hostLabel: "cluster0.example",
      databaseName: "app",
      collections: ["users", "events"],
      indexCount: 4,
    });
    const summary = summarizeMongoFeed(input);
    expect(summary.collectionCount).toBe(2);
    expect(summary.summary).toContain("MongoDB/app");
  });
});

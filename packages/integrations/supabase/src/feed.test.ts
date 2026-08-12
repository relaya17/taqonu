import { describe, expect, it } from "vitest";
import { summarizeSupabaseFeed, supabaseFeedInputSchema } from "./feed.js";

describe("supabase feed (customer observation, not Atlas DB)", () => {
  it("summarizes metadata without accepting secrets", () => {
    const input = supabaseFeedInputSchema.parse({
      projectId: "11111111-1111-4111-8111-111111111111",
      hostLabel: "xyz.supabase.co",
      tables: ["profiles", "projects"],
      rlsEnabled: true,
    });
    const summary = summarizeSupabaseFeed(input);
    expect(summary.tableCount).toBe(2);
    expect(summary.summary).toContain("xyz.supabase.co");
    expect(JSON.stringify(input)).not.toMatch(/service_role|password|secret/i);
  });
});

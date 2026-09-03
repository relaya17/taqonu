import { describe, expect, it } from "vitest";
import { retrieveGovernedKnowledge } from "./governed-knowledge-retrieval.js";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "replace-me",
};

describe("governed knowledge retrieval", () => {
  it("fails closed when session owner does not match requested owner scope", async () => {
    const result = await retrieveGovernedKnowledge({
      env,
      sessionOwnerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      scope: {
        ownerId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        tenantId: "tenant-test",
        projectId: "22222222-2222-4222-8222-222222222222",
        applicationId: "app-test",
        requestingAgentId: "RESEARCHER",
      },
      query: "webhook idempotency",
      requestId: "req-1",
      routeLabel: "knowledge.search",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/owner scope/);
    }
  });
});

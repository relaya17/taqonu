import { describe, expect, it } from "vitest";
import { isLiveKnowledgeStore } from "./knowledge-persist.js";
import { isLiveSupabase } from "./persist.js";

describe("isLiveKnowledgeStore", () => {
  it("mirrors isLiveSupabase (placeholder keys = offline)", () => {
    const env = {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "replace-me",
      DATABASE_URL: "postgresql://postgres:postgres@localhost:54322/postgres",
    };
    expect(isLiveSupabase(env)).toBe(false);
    expect(isLiveKnowledgeStore(env)).toBe(false);
  });

  it("is live when service role looks real", () => {
    const env = {
      SUPABASE_URL: "https://xyz.supabase.co",
      SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key-longer-than-twenty",
    };
    expect(isLiveKnowledgeStore(env)).toBe(true);
  });
});

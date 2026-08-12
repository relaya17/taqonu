import { describe, expect, it } from "vitest";
import { isLiveSupabase } from "./persist.js";
import { tryPersistDecisionToSupabase } from "./decision-persist.js";
import { tryPersistAccountPlanToSupabase } from "./account-plan-persist.js";
import { tryFetchCloudDurabilityBundle } from "./cloud-hydrate.js";
import type { Decision } from "@atlas/shared";

const offlineEnv = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "replace-me",
};

const sampleDecision: Decision = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  projectId: null,
  decision: "Prefer atomic JSON store writes",
  reason: ["durability"],
  alternatives: [],
  tradeOffs: [],
  evidence: [],
  status: "ACTIVE",
  confidence: 1,
  epistemicState: "CONFIRMED",
  supersededBy: null,
  adrPath: null,
  decidedAt: "2026-08-12T00:00:00.000Z",
  createdAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:00.000Z",
};

describe("durability dual-write helpers (offline)", () => {
  it("isLiveSupabase is false for placeholder service role", () => {
    expect(isLiveSupabase(offlineEnv)).toBe(false);
  });

  it("tryPersistDecisionToSupabase returns null when offline", async () => {
    const result = await tryPersistDecisionToSupabase(
      offlineEnv,
      sampleDecision,
      "00000000-0000-4000-8000-000000000001",
    );
    expect(result).toBeNull();
  });

  it("tryPersistAccountPlanToSupabase returns null when offline", async () => {
    const result = await tryPersistAccountPlanToSupabase(offlineEnv, {
      ownerId: "00000000-0000-4000-8000-000000000001",
      tier: "free",
      cloudProjectLimit: 3,
      updatedAt: "2026-08-12T00:00:00.000Z",
    });
    expect(result).toBeNull();
  });

  it("tryFetchCloudDurabilityBundle returns null when offline", async () => {
    const result = await tryFetchCloudDurabilityBundle(offlineEnv);
    expect(result).toBeNull();
  });
});

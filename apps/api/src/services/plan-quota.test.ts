import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PLAN_CLOUD_LIMITS, STUB_OWNER_ID } from "@atlas/shared";
import {
  hasRemainingCloudSlots,
  resolveOwnerId,
  resolveTier,
  upsertTenantSubscription,
} from "./plan-quota.js";
import { osStore } from "../store/os-store.js";

// Isolation gap fix: this previously left `ATLAS_STORE_PATH` unset, so
// `upsertTenantSubscription`'s osStore writes hit the REAL
// `.atlas/store.json` at the repo root — SKIP_STORE_PERSIST alone
// suppresses persistence but not the initial `ensureLoaded()` read of real
// accumulated tenant-subscription state.
const tmpDir = mkdtempSync(join(tmpdir(), "atlas-plan-quota-test-"));

beforeAll(() => {
  process.env.ATLAS_SKIP_STORE_PERSIST = "1";
  process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
});

afterAll(() => {
  delete process.env.ATLAS_SKIP_STORE_PERSIST;
  delete process.env.ATLAS_STORE_PATH;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("resolveOwnerId", () => {
  it("prefers the signed-in user's own id over any env fallback", () => {
    expect(
      resolveOwnerId({ ATLAS_OWNER_ID: "env-owner" } as never, "user-123"),
    ).toBe("user-123");
  });

  it("falls back to ATLAS_OWNER_ID when no request identity is present", () => {
    expect(resolveOwnerId({ ATLAS_OWNER_ID: "env-owner" } as never)).toBe(
      "env-owner",
    );
    expect(
      resolveOwnerId({ ATLAS_OWNER_ID: "env-owner" } as never, null),
    ).toBe("env-owner");
  });

  it("falls back to the legacy stub owner when nothing else is configured", () => {
    expect(resolveOwnerId({} as never)).toBe(STUB_OWNER_ID);
    expect(resolveOwnerId({ ATLAS_OWNER_ID: undefined } as never, null)).toBe(
      STUB_OWNER_ID,
    );
  });
});

describe("tenant plan resolution + quota", () => {
  const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  afterEach(() => {
    osStore.resetBillingStateForTests();
  });

  it("resolves tier from tenant subscription when env plan unset", () => {
    upsertTenantSubscription({
      ownerId,
      tier: "pro",
      status: "active",
      cloudSlotLimit: PLAN_CLOUD_LIMITS.pro,
    });
    const resolved = resolveTier({} as never, ownerId);
    expect(resolved.tier).toBe("pro");
    expect(resolved.source).toBe("tenant");
    expect(resolved.cloudSlotLimit).toBe(PLAN_CLOUD_LIMITS.pro);
  });

  it("env ATLAS_PLAN still overrides tenant store", () => {
    upsertTenantSubscription({
      ownerId,
      tier: "pro",
      status: "active",
    });
    const resolved = resolveTier(
      { ATLAS_PLAN: "free" } as never,
      ownerId,
    );
    expect(resolved.tier).toBe("free");
    expect(resolved.source).toBe("env");
  });

  it("enforces freemium slot math — free has zero Atlas mirror slots", () => {
    expect(
      hasRemainingCloudSlots({
        tier: "free",
        cloudProjectCount: 0,
      }),
    ).toBe(false);
    expect(
      hasRemainingCloudSlots({
        tier: "pro",
        cloudProjectCount: 3,
      }),
    ).toBe(true);
  });
});

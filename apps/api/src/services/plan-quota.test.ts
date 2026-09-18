import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PLAN_CLOUD_LIMITS, PLAN_AXIS_LIMITS, STUB_OWNER_ID, AtlasError } from "@atlas/shared";
import {
  hasRemainingCloudSlots,
  resolveOwnerId,
  resolveTier,
  upsertTenantSubscription,
  countOwnedCloudLinks,
  assertEvalQuota,
  recordEvalRunUsage,
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

describe("countOwnedCloudLinks", () => {
  it("counts only cloud links for projects bound to that owner", async () => {
    const { bindProjectOwner } = await import("./project-access.js");
    osStore.resetInMemoryForTests();
    const ownerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const ownerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const now = new Date().toISOString();
    const projectA = crypto.randomUUID();
    const projectB = crypto.randomUUID();
    osStore.upsertProject({
      id: projectA,
      slug: "proj-a",
      name: "A",
      description: null,
      status: "ACTIVE",
      techStack: [],
      createdAt: now,
      updatedAt: now,
    });
    osStore.upsertProject({
      id: projectB,
      slug: "proj-b",
      name: "B",
      description: null,
      status: "ACTIVE",
      techStack: [],
      createdAt: now,
      updatedAt: now,
    });
    bindProjectOwner(projectA, ownerA, "bound_on_create");
    bindProjectOwner(projectB, ownerB, "bound_on_create");
    osStore.setCloudLink(projectA, { cloudProjectId: "cloud-a", syncedAt: now });
    osStore.setCloudLink(projectB, { cloudProjectId: "cloud-b", syncedAt: now });
    expect(countOwnedCloudLinks(ownerA)).toBe(1);
    expect(countOwnedCloudLinks(ownerB)).toBe(1);
    expect(osStore.countCloudLinkedProjects()).toBe(2);
  });
});

describe("owner-scoped daily usage meters", () => {
  const ownerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const ownerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  beforeEach(() => {
    osStore.resetInMemoryForTests();
  });

  it("does not count owner A eval usage against owner B", () => {
    const env = { ATLAS_PLAN: "free" } as never;
    const limit = PLAN_AXIS_LIMITS.free.evalRunsPerDay;
    for (let i = 0; i < limit; i += 1) {
      recordEvalRunUsage(ownerA);
    }
    expect(() => assertEvalQuota(env, ownerA)).toThrow(AtlasError);
    expect(() => assertEvalQuota(env, ownerB)).not.toThrow();
    recordEvalRunUsage(ownerB);
    const today = new Date().toISOString().slice(0, 10);
    expect(osStore.getEvalRunsToday(today, ownerB)).toBe(1);
    expect(osStore.getEvalRunsToday(today)).toBe(limit + 1);
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PLAN_CLOUD_LIMITS } from "@atlas/shared";
import {
  createLocalUser,
  findUserByEmail,
  findUserById,
  rekeyLocalUserId,
  upsertOAuthUser,
} from "./auth-store.js";
import {
  finalizeIdentityReconciliation,
  readAccessTokenClaims,
  readAccessTokenSubject,
} from "./identity-reconcile.js";
import { osStore } from "../store/os-store.js";
import { upsertTenantSubscription } from "./plan-quota.js";

const authDir = mkdtempSync(join(tmpdir(), "atlas-auth-reconcile-"));
const authPath = join(authDir, "users.json");

beforeAll(() => {
  process.env.ATLAS_AUTH_PATH = authPath;
  process.env.ATLAS_SKIP_STORE_PERSIST = "1";
  // Isolation gap fix: this previously left `ATLAS_STORE_PATH` unset, so
  // `osStore.ensureLoaded()` loaded the REAL `.atlas/store.json` at the
  // repo root (only writes were suppressed by SKIP_STORE_PERSIST, not
  // reads) — real accumulated project/subscription data could leak into
  // this file's `osStore.resetBillingStateForTests()`-scoped tests.
  process.env.ATLAS_STORE_PATH = join(authDir, "store.json");
});

afterAll(() => {
  delete process.env.ATLAS_AUTH_PATH;
  delete process.env.ATLAS_SKIP_STORE_PERSIST;
  delete process.env.ATLAS_STORE_PATH;
  rmSync(authDir, { recursive: true, force: true });
});

beforeEach(() => {
  mkdirSync(authDir, { recursive: true });
  writeFileSync(authPath, JSON.stringify({ users: [] }), "utf8");
  osStore.resetBillingStateForTests();
});

afterEach(() => {
  osStore.resetBillingStateForTests();
});

function fakeJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
    "base64url",
  );
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${payload}.sig`;
}

describe("readAccessTokenClaims + subject", () => {
  it("extracts sub, email, atlas_role, and profile fields", () => {
    const token = fakeJwt({
      sub: "oauth-user-1",
      email: "o@example.com",
      exp: 1_800_000_000,
      app_metadata: { atlas_role: "admin", provider: "github" },
      user_metadata: { full_name: "O Auth", locale: "he", avatar_url: "https://cdn.example/a.png" },
    });
    expect(readAccessTokenClaims(token)).toEqual({
      sub: "oauth-user-1",
      email: "o@example.com",
      atlasRole: "admin",
      displayName: "O Auth",
      avatarUrl: "https://cdn.example/a.png",
      provider: "github",
      locale: "he",
      expiresAt: 1_800_000_000_000,
    });
    expect(readAccessTokenSubject(token)).toBe("oauth-user-1");
  });

  it("returns null atlasRole when missing; null for garbage tokens", () => {
    expect(readAccessTokenClaims(fakeJwt({ sub: "x" }))?.atlasRole).toBeNull();
    expect(readAccessTokenSubject("not-a-jwt")).toBeNull();
    expect(readAccessTokenSubject("a.b")).toBeNull();
  });
});

describe("readAccessTokenSubject (compat)", () => {
  it("extracts sub from a JWT-shaped access token", () => {
    expect(readAccessTokenSubject(fakeJwt({ sub: "oauth-user-1" }))).toBe("oauth-user-1");
  });
});

describe("OAuth id mismatch → reconcile", () => {
  it("rewrites a pre-existing local user id to the OAuth/Supabase id", () => {
    const local = createLocalUser({
      email: "linker@example.com",
      password: "correct-horse-battery",
      displayName: "Linker",
    });
    expect(local.id).not.toBe("11111111-1111-4111-8111-111111111111");

    const { user, reconciledFromId } = upsertOAuthUser({
      email: "linker@example.com",
      provider: "github",
      id: "11111111-1111-4111-8111-111111111111",
      displayName: "Linker GH",
    });

    expect(reconciledFromId).toBe(local.id);
    expect(user.id).toBe("11111111-1111-4111-8111-111111111111");
    expect(user.provider).toBe("github");
    expect(findUserById(local.id)).toBeUndefined();
    expect(findUserByEmail("linker@example.com")?.id).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
  });

  it("does not report reconciliation when ids already match", () => {
    const oauthId = "22222222-2222-4222-8222-222222222222";
    const { user: first } = upsertOAuthUser({
      email: "fresh@example.com",
      provider: "google",
      id: oauthId,
    });
    expect(first.id).toBe(oauthId);

    const { user, reconciledFromId } = upsertOAuthUser({
      email: "fresh@example.com",
      provider: "google",
      id: oauthId,
    });
    expect(reconciledFromId).toBeNull();
    expect(user.id).toBe(oauthId);
  });

  it("rekeys tenant subscription owner_id alongside the local user", async () => {
    const local = createLocalUser({
      email: "billed@example.com",
      password: "correct-horse-battery",
    });
    upsertTenantSubscription({
      ownerId: local.id,
      tier: "pro",
      status: "active",
      cloudSlotLimit: PLAN_CLOUD_LIMITS.pro,
      stripeCustomerId: "cus_test",
    });
    expect(osStore.getTenantSubscription(local.id)?.tier).toBe("pro");

    const oauthId = "33333333-3333-4333-8333-333333333333";
    const { user, reconciledFromId } = upsertOAuthUser({
      email: "billed@example.com",
      provider: "github",
      id: oauthId,
    });
    expect(reconciledFromId).toBe(local.id);

    const result = await finalizeIdentityReconciliation({
      env: {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_ANON_KEY: "anon",
        SUPABASE_SERVICE_ROLE_KEY: "replace-me", // not live → skip cloud
      },
      fromId: reconciledFromId!,
      toId: user.id,
    });

    expect(result.tenantRekeyed).toBe(true);
    expect(result.cloudTablesUpdated).toEqual([]);
    expect(osStore.getTenantSubscription(local.id)).toBeNull();
    expect(osStore.getTenantSubscription(oauthId)?.stripeCustomerId).toBe("cus_test");
    expect(osStore.getTenantSubscription(oauthId)?.ownerId).toBe(oauthId);
  });

  it("rekeyLocalUserId supports login-time drift repair", () => {
    const local = createLocalUser({
      email: "drift@example.com",
      password: "correct-horse-battery",
    });
    const oauthId = "44444444-4444-4444-8444-444444444444";
    const updated = rekeyLocalUserId(local.id, oauthId);
    expect(updated?.id).toBe(oauthId);
    expect(findUserById(local.id)).toBeUndefined();
    expect(findUserByEmail("drift@example.com")?.id).toBe(oauthId);
  });

  it("skips id rewrite when the OAuth id already belongs to another account", () => {
    const other = createLocalUser({
      email: "other@example.com",
      password: "correct-horse-battery",
    });
    const local = createLocalUser({
      email: "collision@example.com",
      password: "correct-horse-battery",
    });
    const { user, reconciledFromId } = upsertOAuthUser({
      email: "collision@example.com",
      provider: "google",
      id: other.id, // would collide
    });
    expect(reconciledFromId).toBeNull();
    expect(user.id).toBe(local.id);
  });
});

import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AtlasError, PLAN_CLOUD_LIMITS, STUB_OWNER_ID } from "@atlas/shared";
import {
  fulfillStripeCheckoutSession,
  fulfillStripeSubscriptionEvent,
  verifyStripeWebhookSignature,
} from "./stripe.js";
import {
  hasRemainingCloudSlots,
  resolveOwnerId,
  resolveTier,
  upsertTenantSubscription,
} from "./plan-quota.js";
import { osStore } from "../store/os-store.js";

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";

describe("verifyStripeWebhookSignature", () => {
  const secret = "whsec_test_secret";
  const payload = '{"type":"checkout.session.completed"}';

  it("accepts a valid signature", () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const v1 = createHmac("sha256", secret)
      .update(`${timestamp}.${payload}`, "utf8")
      .digest("hex");
    expect(() =>
      verifyStripeWebhookSignature({
        payload,
        signatureHeader: `t=${timestamp},v1=${v1}`,
        secret,
      }),
    ).not.toThrow();
  });

  it("rejects a bad signature", () => {
    const timestamp = Math.floor(Date.now() / 1000);
    expect(() =>
      verifyStripeWebhookSignature({
        payload,
        signatureHeader: `t=${timestamp},v1=deadbeef`,
        secret,
      }),
    ).toThrow(AtlasError);
  });
});

describe("stripe webhook → tenant upgrade", () => {
  beforeAll(() => {
    process.env.ATLAS_SKIP_STORE_PERSIST = "1";
  });

  afterAll(() => {
    delete process.env.ATLAS_SKIP_STORE_PERSIST;
  });

  afterEach(() => {
    osStore.resetBillingStateForTests();
  });

  it("upgrades the tenant plan and cloud slots on checkout.session.completed", () => {
    const result = fulfillStripeCheckoutSession({
      id: "cs_test_tenant_upgrade",
      client_reference_id: OWNER_A,
      customer: "cus_test_a",
      subscription: "sub_test_a",
      metadata: {
        atlas_owner_id: OWNER_A,
        atlas_tier: "pro",
        atlas_cloud_slots: String(PLAN_CLOUD_LIMITS.pro),
      },
    });

    expect(result.handled).toBe(true);
    expect(result.ownerId).toBe(OWNER_A);
    expect(result.tier).toBe("pro");

    const tenant = osStore.getTenantSubscription(OWNER_A);
    expect(tenant?.tier).toBe("pro");
    expect(tenant?.status).toBe("active");
    expect(tenant?.cloudSlotLimit).toBe(PLAN_CLOUD_LIMITS.pro);
    expect(tenant?.stripeCustomerId).toBe("cus_test_a");
    expect(tenant?.stripeSubscriptionId).toBe("sub_test_a");

    const resolved = resolveTier({} as never, OWNER_A);
    expect(resolved.tier).toBe("pro");
    expect(resolved.source).toBe("tenant");
  });

  it("is idempotent for the same checkout session", () => {
    const session = {
      id: "cs_test_dup",
      metadata: { atlas_owner_id: OWNER_A, atlas_tier: "pro" as const },
      customer: "cus_dup",
    };
    const first = fulfillStripeCheckoutSession(session);
    const second = fulfillStripeCheckoutSession(session);
    expect(first.handled).toBe(true);
    expect(second.duplicate).toBe(true);
  });

  it("downgrades tenant on subscription.deleted", () => {
    upsertTenantSubscription({
      ownerId: OWNER_A,
      tier: "pro",
      status: "active",
      cloudSlotLimit: PLAN_CLOUD_LIMITS.pro,
      stripeCustomerId: "cus_del",
      stripeSubscriptionId: "sub_del",
    });

    const result = fulfillStripeSubscriptionEvent({
      type: "customer.subscription.deleted",
      subscription: {
        id: "sub_del",
        status: "canceled",
        customer: "cus_del",
        metadata: { atlas_owner_id: OWNER_A },
      },
    });

    expect(result.handled).toBe(true);
    expect(result.tier).toBe("free");
    expect(osStore.getTenantSubscription(OWNER_A)?.tier).toBe("free");
    expect(osStore.getTenantSubscription(OWNER_A)?.status).toBe("canceled");
  });

  it("keeps tenants isolated — Owner B stays free when Owner A upgrades", () => {
    fulfillStripeCheckoutSession({
      id: "cs_isolation",
      metadata: { atlas_owner_id: OWNER_A, atlas_tier: "pro" },
      customer: "cus_a",
    });

    expect(resolveTier({} as never, OWNER_A).tier).toBe("pro");
    expect(resolveTier({} as never, OWNER_B).tier).toBe("free");
    expect(resolveTier({} as never, OWNER_B).source).not.toBe("tenant");
  });
});

describe("tenant quota enforcement", () => {
  afterEach(() => {
    osStore.resetBillingStateForTests();
  });

  it("blocks free-tier Atlas evidence mirror (free slots = 0)", () => {
    expect(
      hasRemainingCloudSlots({
        tier: "free",
        cloudProjectCount: 0,
      }),
    ).toBe(false);
    expect(PLAN_CLOUD_LIMITS.free).toBe(0);
  });

  it("allows more slots after Stripe upgrades the tenant to pro", () => {
    fulfillStripeCheckoutSession({
      id: "cs_quota_pro",
      metadata: {
        atlas_owner_id: OWNER_A,
        atlas_tier: "pro",
        atlas_cloud_slots: String(PLAN_CLOUD_LIMITS.pro),
      },
      customer: "cus_quota",
    });

    const tenant = osStore.getTenantSubscription(OWNER_A);
    expect(tenant?.tier).toBe("pro");
    expect(
      hasRemainingCloudSlots({
        tier: tenant!.tier,
        cloudProjectCount: PLAN_CLOUD_LIMITS.free,
        cloudProjectLimit: tenant!.cloudSlotLimit,
      }),
    ).toBe(true);
  });

  it("resolveOwnerId prefers the signed-in user", () => {
    expect(
      resolveOwnerId({ ATLAS_OWNER_ID: "env-owner" } as never, "user-123"),
    ).toBe("user-123");
    expect(resolveOwnerId({} as never)).toBe(STUB_OWNER_ID);
  });
});

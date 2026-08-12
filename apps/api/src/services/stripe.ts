import { createHmac, timingSafeEqual } from "node:crypto";
import {
  AtlasError,
  CREDIT_PACKS,
  PLAN_CLOUD_LIMITS,
  type PlanTier,
} from "@atlas/shared";
import { purchaseCreditPack } from "./artifacts-assists.js";
import { upsertTenantSubscription } from "./plan-quota.js";
import {
  osStore,
  type TenantSubscriptionStatus,
} from "../store/os-store.js";

/** Default one-time amounts (USD cents) when STRIPE_PRICE_* IDs are unset. */
export const STRIPE_PACK_AMOUNT_CENTS = {
  starter: 900,
  growth: 2900,
  scale: 9900,
} as const;

export const STRIPE_PRO_AMOUNT_CENTS = 2900;

export type StripeCheckoutKind =
  | { kind: "credits"; pack: keyof typeof CREDIT_PACKS }
  | { kind: "plan"; tier: Extract<PlanTier, "pro"> }
  | { kind: "credits_and_plan"; pack: keyof typeof CREDIT_PACKS; tier: Extract<PlanTier, "pro"> };

type StripeCheckoutSession = {
  id: string;
  url: string | null;
};

function stripeApiBase(): string {
  return "https://api.stripe.com/v1";
}

function formEncode(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

function packPriceId(pack: keyof typeof CREDIT_PACKS): string | undefined {
  const key = `STRIPE_PRICE_${pack.toUpperCase()}` as const;
  const value = process.env[key];
  return value && value.length > 0 ? value : undefined;
}

function proPriceId(): string | undefined {
  const value = process.env.STRIPE_PRICE_PRO;
  return value && value.length > 0 ? value : undefined;
}

function mapStripeSubscriptionStatus(
  status: string | undefined,
): TenantSubscriptionStatus {
  switch (status) {
    case "active":
    case "canceled":
    case "past_due":
    case "trialing":
    case "incomplete":
      return status;
    default:
      return "none";
  }
}

/** Create a Stripe Checkout Session via REST (no stripe SDK). */
export async function createStripeCheckoutSession(input: {
  secretKey: string;
  webOrigin: string;
  checkout: StripeCheckoutKind;
  ownerId: string;
  customerEmail?: string | null;
  successUrl?: string;
  cancelUrl?: string;
}): Promise<{ sessionId: string; checkoutUrl: string }> {
  const successUrl =
    input.successUrl ??
    process.env.STRIPE_SUCCESS_URL ??
    `${input.webOrigin}/settings/billing?checkout=success`;
  const cancelUrl =
    input.cancelUrl ??
    process.env.STRIPE_CANCEL_URL ??
    `${input.webOrigin}/settings/billing?checkout=canceled`;

  const wantsPlan =
    input.checkout.kind === "plan" || input.checkout.kind === "credits_and_plan";
  const wantsCredits =
    input.checkout.kind === "credits" || input.checkout.kind === "credits_and_plan";
  const proPrice = proPriceId();
  /** Prefer subscription mode for plan-only upgrades when a Price ID is configured. */
  const useSubscription = wantsPlan && !wantsCredits && Boolean(proPrice);

  const params: Record<string, string> = {
    mode: useSubscription ? "subscription" : "payment",
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: input.ownerId,
    "metadata[atlas_product]": "ArletOS",
    "metadata[atlas_owner_id]": input.ownerId,
  };

  if (!useSubscription) {
    params.customer_creation = "always";
  }

  if (input.customerEmail) {
    params.customer_email = input.customerEmail;
  }

  const existing = osStore.getTenantSubscription(input.ownerId);
  if (existing?.stripeCustomerId) {
    params.customer = existing.stripeCustomerId;
    delete params.customer_email;
    delete params.customer_creation;
  }

  let lineIndex = 0;

  const addPriceData = (name: string, unitAmount: number) => {
    params[`line_items[${lineIndex}][price_data][currency]`] = "usd";
    params[`line_items[${lineIndex}][price_data][product_data][name]`] = name;
    params[`line_items[${lineIndex}][price_data][unit_amount]`] = String(unitAmount);
    params[`line_items[${lineIndex}][quantity]`] = "1";
    lineIndex += 1;
  };

  const addPriceId = (priceId: string) => {
    params[`line_items[${lineIndex}][price]`] = priceId;
    params[`line_items[${lineIndex}][quantity]`] = "1";
    lineIndex += 1;
  };

  if (input.checkout.kind === "credits" || input.checkout.kind === "credits_and_plan") {
    const pack = input.checkout.pack;
    const packMeta = CREDIT_PACKS[pack];
    params["metadata[atlas_pack]"] = pack;
    params["metadata[atlas_credits]"] = String(packMeta.credits);
    const priceId = packPriceId(pack);
    if (priceId) {
      addPriceId(priceId);
    } else {
      addPriceData(
        `ArletOS ${packMeta.label} assist credits (${packMeta.credits})`,
        STRIPE_PACK_AMOUNT_CENTS[pack],
      );
    }
  }

  if (input.checkout.kind === "plan" || input.checkout.kind === "credits_and_plan") {
    params["metadata[atlas_tier]"] = input.checkout.tier;
    params["metadata[atlas_cloud_slots]"] = String(PLAN_CLOUD_LIMITS.pro);
    if (proPrice) {
      addPriceId(proPrice);
    } else {
      addPriceData("ArletOS Pro plan upgrade", STRIPE_PRO_AMOUNT_CENTS);
    }
  }

  const response = await fetch(`${stripeApiBase()}/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formEncode(params),
  });

  const payload = (await response.json()) as StripeCheckoutSession & {
    error?: { message?: string };
  };

  if (!response.ok || !payload.url || !payload.id) {
    throw new AtlasError(
      "INTEGRATION_ERROR",
      payload.error?.message ?? "Stripe Checkout session creation failed",
      { statusCode: 502, details: { status: response.status } },
    );
  }

  return { sessionId: payload.id, checkoutUrl: payload.url };
}

/**
 * Verify Stripe-Signature header (t=…,v1=…).
 * Requires the exact raw request body string.
 */
export function verifyStripeWebhookSignature(input: {
  payload: string;
  signatureHeader: string | undefined;
  secret: string;
  toleranceSec?: number;
}): void {
  if (!input.signatureHeader) {
    throw new AtlasError("WEBHOOK_INVALID", "Missing Stripe-Signature header", {
      statusCode: 400,
    });
  }

  const parts = Object.fromEntries(
    input.signatureHeader.split(",").map((piece) => {
      const [k, ...rest] = piece.split("=");
      return [k?.trim() ?? "", rest.join("=").trim()];
    }),
  );
  const timestamp = parts.t;
  const v1 = parts.v1;
  if (!timestamp || !v1) {
    throw new AtlasError("WEBHOOK_INVALID", "Malformed Stripe-Signature header", {
      statusCode: 400,
    });
  }

  const tolerance = input.toleranceSec ?? 300;
  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > tolerance) {
    throw new AtlasError("WEBHOOK_INVALID", "Stripe webhook timestamp outside tolerance", {
      statusCode: 400,
    });
  }

  const signed = `${timestamp}.${input.payload}`;
  const expected = createHmac("sha256", input.secret).update(signed, "utf8").digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const providedBuf = Buffer.from(v1, "utf8");
  if (
    expectedBuf.length !== providedBuf.length ||
    !timingSafeEqual(expectedBuf, providedBuf)
  ) {
    throw new AtlasError("WEBHOOK_INVALID", "Invalid Stripe webhook signature", {
      statusCode: 400,
    });
  }
}

export type StripeWebhookFulfillment = {
  handled: boolean;
  sessionId?: string;
  subscriptionId?: string;
  ownerId?: string;
  pack?: keyof typeof CREDIT_PACKS;
  tier?: PlanTier;
  duplicate?: boolean;
};

function resolveOwnerIdFromStripeObject(obj: {
  client_reference_id?: string | null;
  customer?: string | { id?: string } | null;
  metadata?: Record<string, string | undefined> | null;
}): string | undefined {
  const fromMeta = obj.metadata?.atlas_owner_id;
  if (fromMeta && fromMeta.length > 0) return fromMeta;
  if (obj.client_reference_id && obj.client_reference_id.length > 0) {
    return obj.client_reference_id;
  }
  const customerId =
    typeof obj.customer === "string"
      ? obj.customer
      : obj.customer && typeof obj.customer === "object"
        ? obj.customer.id
        : undefined;
  if (customerId) {
    return osStore.findTenantByStripeCustomerId(customerId)?.ownerId;
  }
  return undefined;
}

/** Apply checkout.session.completed — credit pack and/or upgrade tenant plan. */
export function fulfillStripeCheckoutSession(session: {
  id?: string;
  client_reference_id?: string | null;
  customer?: string | { id?: string } | null;
  subscription?: string | { id?: string } | null;
  metadata?: Record<string, string | undefined> | null;
}): StripeWebhookFulfillment {
  const sessionId = session.id;
  if (!sessionId) {
    return { handled: false };
  }

  const idempotencyKey = `stripe.checkout.${sessionId}`;
  if (osStore.getMeta(idempotencyKey)) {
    const ownerId = resolveOwnerIdFromStripeObject(session);
    return {
      handled: true,
      sessionId,
      duplicate: true,
      ...(ownerId !== undefined ? { ownerId } : {}),
    };
  }

  const packRaw = session.metadata?.atlas_pack;
  const tierRaw = session.metadata?.atlas_tier;
  const pack =
    packRaw === "starter" || packRaw === "growth" || packRaw === "scale"
      ? packRaw
      : undefined;
  const tier = tierRaw === "pro" || tierRaw === "free" ? tierRaw : undefined;
  const ownerId = resolveOwnerIdFromStripeObject(session);

  if (!pack && !tier) {
    return { handled: false, sessionId, ...(ownerId ? { ownerId } : {}) };
  }

  if (pack) {
    purchaseCreditPack(pack);
  }

  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer && typeof session.customer === "object"
        ? (session.customer.id ?? null)
        : null;
  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription && typeof session.subscription === "object"
        ? (session.subscription.id ?? null)
        : null;

  const slotsRaw = session.metadata?.atlas_cloud_slots;
  const cloudSlotLimit =
    slotsRaw && Number.isFinite(Number(slotsRaw)) && Number(slotsRaw) > 0
      ? Number(slotsRaw)
      : undefined;

  if (tier === "pro" && ownerId) {
    upsertTenantSubscription({
      ownerId,
      tier: "pro",
      status: "active",
      cloudSlotLimit: cloudSlotLimit ?? PLAN_CLOUD_LIMITS.pro,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
    });
  } else if (tier === "pro") {
    // Legacy fallback when owner cannot be resolved — keep single-instance plan.
    osStore.setPlan({
      tier: "pro",
      updatedAt: new Date().toISOString(),
    });
  } else if (ownerId && customerId) {
    upsertTenantSubscription({
      ownerId,
      tier: osStore.getTenantSubscription(ownerId)?.tier ?? "free",
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
    });
  }

  osStore.setMeta(idempotencyKey, new Date().toISOString());
  osStore.appendAudit({
    type: "billing.stripe.checkout.completed",
    sessionId,
    ownerId: ownerId ?? null,
    pack: pack ?? null,
    tier: tier ?? null,
    at: new Date().toISOString(),
  });

  return {
    handled: true,
    sessionId,
    ...(ownerId !== undefined ? { ownerId } : {}),
    ...(subscriptionId ? { subscriptionId } : {}),
    ...(pack !== undefined ? { pack } : {}),
    ...(tier !== undefined ? { tier } : {}),
  };
}

/** Apply customer.subscription.updated / deleted to tenant plan + slots. */
export function fulfillStripeSubscriptionEvent(input: {
  type: "customer.subscription.updated" | "customer.subscription.deleted";
  subscription: {
    id?: string;
    status?: string;
    customer?: string | { id?: string } | null;
    metadata?: Record<string, string | undefined> | null;
  };
}): StripeWebhookFulfillment {
  const subscriptionId = input.subscription.id;
  if (!subscriptionId) {
    return { handled: false };
  }

  const idempotencyKey = `stripe.subscription.${input.type}.${subscriptionId}.${input.subscription.status ?? "unknown"}`;
  if (osStore.getMeta(idempotencyKey)) {
    const ownerId = resolveOwnerIdFromStripeObject(input.subscription);
    return {
      handled: true,
      subscriptionId,
      duplicate: true,
      ...(ownerId !== undefined ? { ownerId } : {}),
    };
  }

  const ownerId = resolveOwnerIdFromStripeObject(input.subscription);
  if (!ownerId) {
    return { handled: false, subscriptionId };
  }

  const customerId =
    typeof input.subscription.customer === "string"
      ? input.subscription.customer
      : input.subscription.customer && typeof input.subscription.customer === "object"
        ? (input.subscription.customer.id ?? null)
        : null;

  const status = mapStripeSubscriptionStatus(input.subscription.status);
  const deleted = input.type === "customer.subscription.deleted";
  const activeLike = status === "active" || status === "trialing";
  const tier: PlanTier = deleted || !activeLike ? "free" : "pro";
  const slotsRaw = input.subscription.metadata?.atlas_cloud_slots;
  const cloudSlotLimit =
    slotsRaw && Number.isFinite(Number(slotsRaw)) && Number(slotsRaw) > 0
      ? Number(slotsRaw)
      : PLAN_CLOUD_LIMITS[tier];

  upsertTenantSubscription({
    ownerId,
    tier,
    status: deleted ? "canceled" : status,
    cloudSlotLimit,
    stripeCustomerId: customerId,
    stripeSubscriptionId: deleted ? null : subscriptionId,
  });

  osStore.setMeta(idempotencyKey, new Date().toISOString());
  osStore.appendAudit({
    type: `billing.stripe.${input.type}`,
    subscriptionId,
    ownerId,
    tier,
    status: deleted ? "canceled" : status,
    at: new Date().toISOString(),
  });

  return {
    handled: true,
    subscriptionId,
    ownerId,
    tier,
  };
}

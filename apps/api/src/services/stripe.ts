import { createHmac, timingSafeEqual } from "node:crypto";
import { AtlasError, CREDIT_PACKS, type PlanTier } from "@atlas/shared";
import { purchaseCreditPack } from "./artifacts-assists.js";
import { osStore } from "../store/os-store.js";

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

/** Create a Stripe Checkout Session via REST (no stripe SDK). */
export async function createStripeCheckoutSession(input: {
  secretKey: string;
  webOrigin: string;
  checkout: StripeCheckoutKind;
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

  const params: Record<string, string> = {
    mode: "payment",
    success_url: successUrl,
    cancel_url: cancelUrl,
    "metadata[atlas_product]": "ArletOS",
  };

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
    const priceId = proPriceId();
    if (priceId) {
      addPriceId(priceId);
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
  pack?: keyof typeof CREDIT_PACKS;
  tier?: PlanTier;
  duplicate?: boolean;
};

/** Apply checkout.session.completed — credit pack and/or upgrade plan. */
export function fulfillStripeCheckoutSession(session: {
  id?: string;
  metadata?: Record<string, string | undefined> | null;
}): StripeWebhookFulfillment {
  const sessionId = session.id;
  if (!sessionId) {
    return { handled: false };
  }

  const idempotencyKey = `stripe.checkout.${sessionId}`;
  if (osStore.getMeta(idempotencyKey)) {
    return { handled: true, sessionId, duplicate: true };
  }

  const packRaw = session.metadata?.atlas_pack;
  const tierRaw = session.metadata?.atlas_tier;
  const pack =
    packRaw === "starter" || packRaw === "growth" || packRaw === "scale"
      ? packRaw
      : undefined;
  const tier = tierRaw === "pro" || tierRaw === "free" ? tierRaw : undefined;

  if (!pack && !tier) {
    return { handled: false, sessionId };
  }

  if (pack) {
    purchaseCreditPack(pack);
  }

  if (tier === "pro") {
    osStore.setPlan({
      tier: "pro",
      updatedAt: new Date().toISOString(),
    });
  }

  osStore.setMeta(idempotencyKey, new Date().toISOString());
  osStore.appendAudit({
    type: "billing.stripe.checkout.completed",
    sessionId,
    pack: pack ?? null,
    tier: tier ?? null,
    at: new Date().toISOString(),
  });

  return {
    handled: true,
    sessionId,
    ...(pack !== undefined ? { pack } : {}),
    ...(tier !== undefined ? { tier } : {}),
  };
}

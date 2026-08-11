import { Readable } from "node:stream";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { setPlanSchema, purchaseCreditsSchema, CREDIT_PACKS } from "@atlas/shared";
import { getAccountPlan, resolveTier } from "../services/plan-quota.js";
import {
  ensureCreditsInitialized,
  purchaseCreditPack,
} from "../services/artifacts-assists.js";
import { osStore } from "../store/os-store.js";
import {
  createStripeCheckoutSession,
  fulfillStripeCheckoutSession,
  verifyStripeWebhookSignature,
  type StripeCheckoutKind,
} from "../services/stripe.js";
import { requireSignedInForWrite } from "../middleware/auth-guards.js";

/**
 * Stripe freemium (ADR-011 / ADR-013):
 * - STRIPE_SECRET_KEY — when set, POST /billing/stripe/checkout creates a real Checkout Session
 * - STRIPE_WEBHOOK_SECRET — when set, webhook verifies Stripe-Signature and fulfills credits/plan
 * - Optional: STRIPE_PRICE_STARTER | STRIPE_PRICE_GROWTH | STRIPE_PRICE_SCALE | STRIPE_PRICE_PRO
 *   (Price IDs; otherwise dynamic price_data amounts are used)
 * - Optional: STRIPE_SUCCESS_URL | STRIPE_CANCEL_URL (default: WEB_ORIGIN/settings/billing?…)
 * Without secrets, staging path stays: POST /billing/credits/purchase and stub checkout/webhook.
 */
export async function registerBillingRoutes(app: FastifyInstance): Promise<void> {
  osStore.ensureLoaded();

  app.get("/api/v1/billing/plan", async () => {
    return getAccountPlan(app.atlasEnv);
  });

  app.post("/api/v1/billing/plan", async (request) => {
    requireSignedInForWrite(app, request);
    const body = setPlanSchema.parse(request.body);
    osStore.setPlan({
      tier: body.tier,
      updatedAt: new Date().toISOString(),
    });
    const { tier } = resolveTier(app.atlasEnv);
    ensureCreditsInitialized(tier);
    return getAccountPlan(app.atlasEnv);
  });

  app.get("/api/v1/billing/credits", async () => {
    const { tier } = resolveTier(app.atlasEnv);
    return ensureCreditsInitialized(tier);
  });

  app.get("/api/v1/billing/credit-packs", async () => ({
    packs: Object.entries(CREDIT_PACKS).map(([id, pack]) => ({
      id,
      credits: pack.credits,
      label: pack.label,
      note: "Staging purchase — Stripe Checkout optional via POST /billing/stripe/checkout.",
    })),
  }));

  /** Staging pack purchase until Stripe webhook. */
  app.post("/api/v1/billing/credits/purchase", async (request, reply) => {
    requireSignedInForWrite(app, request);
    const body = purchaseCreditsSchema.parse(request.body);
    const balance = purchaseCreditPack(body.pack);
    return reply.status(201).send({
      pack: body.pack,
      granted: CREDIT_PACKS[body.pack].credits,
      balance,
    });
  });

  const stripeCheckoutBodySchema = z
    .object({
      pack: z.enum(["starter", "growth", "scale"]).optional(),
      tier: z.literal("pro").optional(),
    })
    .refine((b) => Boolean(b.pack || b.tier), {
      message: "Provide pack and/or tier: \"pro\"",
    });

  app.post("/api/v1/billing/stripe/checkout", async (request, reply) => {
    requireSignedInForWrite(app, request);
    const rawBody =
      request.body && typeof request.body === "object"
        ? request.body
        : { pack: "starter" as const };
    const body = stripeCheckoutBodySchema.parse(rawBody);
    const stripeSecret = process.env.STRIPE_SECRET_KEY;

    if (!stripeSecret) {
      return reply.status(200).send({
        mode: "stub",
        provider: "stripe",
        pack: body.pack ?? null,
        tier: body.tier ?? null,
        credits: body.pack ? CREDIT_PACKS[body.pack].credits : null,
        checkoutUrl: null,
        message:
          "STRIPE_SECRET_KEY not set — use POST /billing/credits/purchase for staging credits (or POST /billing/plan for tier). Quotas already enforced (ADR-011).",
      });
    }

    let checkout: StripeCheckoutKind;
    if (body.pack && body.tier) {
      checkout = { kind: "credits_and_plan", pack: body.pack, tier: body.tier };
    } else if (body.tier) {
      checkout = { kind: "plan", tier: body.tier };
    } else if (body.pack) {
      checkout = { kind: "credits", pack: body.pack };
    } else {
      checkout = { kind: "credits", pack: "starter" };
    }

    const session = await createStripeCheckoutSession({
      secretKey: stripeSecret,
      webOrigin: app.atlasEnv.WEB_ORIGIN,
      checkout,
    });

    return reply.status(200).send({
      mode: "live",
      provider: "stripe",
      pack: body.pack ?? null,
      tier: body.tier ?? null,
      credits: body.pack ? CREDIT_PACKS[body.pack].credits : null,
      sessionId: session.sessionId,
      checkoutUrl: session.checkoutUrl,
    });
  });

  app.post(
    "/api/v1/billing/stripe/webhook",
    {
      preParsing: async (request, _reply, payload) => {
        const chunks: Buffer[] = [];
        for await (const chunk of payload) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const rawBuf = Buffer.concat(chunks);
        (request as FastifyRequest & { rawBody?: string }).rawBody =
          rawBuf.toString("utf8");
        return Readable.from(rawBuf);
      },
    },
    async (request, reply) => {
      const secret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!secret) {
        return reply.status(200).send({
          accepted: false,
          mode: "stub",
          message: "STRIPE_WEBHOOK_SECRET not configured — no-op stub",
        });
      }

      const rawBody =
        (request as FastifyRequest & { rawBody?: string }).rawBody ??
        (typeof request.body === "string"
          ? request.body
          : JSON.stringify(request.body ?? {}));

      const signatureHeader = request.headers["stripe-signature"];
      verifyStripeWebhookSignature({
        payload: rawBody,
        signatureHeader: Array.isArray(signatureHeader)
          ? signatureHeader[0]
          : signatureHeader,
        secret,
      });

      const event =
        typeof request.body === "object" && request.body
          ? (request.body as {
              type?: string;
              data?: { object?: { id?: string; metadata?: Record<string, string> } };
            })
          : {};

      if (event.type !== "checkout.session.completed") {
        app.atlasLogger.info("stripe_webhook_ignored", { type: event.type ?? null });
        return reply.status(200).send({ received: true, handled: false });
      }

      const fulfillment = fulfillStripeCheckoutSession(event.data?.object ?? {});
      app.atlasLogger.info("stripe_webhook_fulfilled", {
        sessionId: fulfillment.sessionId ?? null,
        pack: fulfillment.pack ?? null,
        tier: fulfillment.tier ?? null,
        duplicate: fulfillment.duplicate ?? false,
        handled: fulfillment.handled,
      });

      return reply.status(200).send({
        received: true,
        mode: "live",
        ...fulfillment,
      });
    },
  );
}

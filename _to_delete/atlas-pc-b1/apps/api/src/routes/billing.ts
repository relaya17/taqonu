import { Readable } from "node:stream";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  AtlasError,
  setPlanSchema,
  purchaseCreditsSchema,
  CREDIT_PACKS,
} from "@atlas/shared";
import { authorizeEntityAction } from "@atlas/agent-core";
import {
  getAccountPlan,
  getAccountUsage,
  resolveTier,
  setTenantPlanTier,
} from "../services/plan-quota.js";
import {
  ensureCreditsInitialized,
  purchaseCreditPack,
} from "../services/artifacts-assists.js";
import { osStore } from "../store/os-store.js";
import {
  createStripeCheckoutSession,
  fulfillStripeCheckoutSession,
  fulfillStripeSubscriptionEvent,
  verifyStripeWebhookSignature,
  type StripeCheckoutKind,
} from "../services/stripe.js";
import { requireSignedInForWrite } from "../middleware/auth-guards.js";
import { resolveCloudIdentity } from "../services/cloud-identity.js";
import { getRequestUser } from "./auth.js";

/**
 * Stripe freemium (ADR-011 / ADR-013):
 * - STRIPE_SECRET_KEY — when set, POST /billing/stripe/checkout creates a real Checkout Session
 * - STRIPE_WEBHOOK_SECRET — when set, webhook verifies Stripe-Signature and fulfills credits/plan
 * - Optional: STRIPE_PRICE_STARTER | STRIPE_PRICE_GROWTH | STRIPE_PRICE_SCALE | STRIPE_PRICE_PRO
 *   (Price IDs; otherwise dynamic price_data amounts are used)
 * - Optional: STRIPE_SUCCESS_URL | STRIPE_CANCEL_URL (default: WEB_ORIGIN/settings/billing?…)
 * Without secrets, staging path stays: POST /billing/credits/purchase and stub checkout/webhook.
 *
 * Tenant MVP: checkout/webhook keyed by owner_id (session user → tenantSubscriptions in osStore).
 */
export async function registerBillingRoutes(app: FastifyInstance): Promise<void> {
  osStore.ensureLoaded();

  app.get("/api/v1/billing/plan", async (request) => {
    const identity = await resolveCloudIdentity(app, request);
    return getAccountPlan(app.atlasEnv, identity);
  });

  app.get("/api/v1/billing/usage", async (request) => {
    const identity = await resolveCloudIdentity(app, request);
    return getAccountUsage(app.atlasEnv, identity);
  });

  app.post("/api/v1/billing/plan", async (request) => {
    await requireSignedInForWrite(app, request);

    // Entity-policy gate: changing a tenant's plan tier mutates the
    // subscription/billing arrangement that governs quotas and (when Stripe
    // is live) what the account is charged, so it is classified as
    // FINANCIAL_TRANSACTION.UPDATE — `setTenantPlanTier` upserts the
    // existing (or newly-initialized) tenant subscription row in place
    // rather than creating a brand-new transaction record. `writeGateOpen:
    // true` + `approved: true` represents the self-approved case of an
    // authenticated human directly triggering this write via the REST API
    // (mirrors how a signed-in human REST write is already implicitly
    // trusted elsewhere in this codebase, e.g. graph.ts's rebuild route and
    // portfolio.ts's discovery/link route). This is a manual/staging tier
    // flip on the caller's own account (not, e.g., an irreversible
    // platform-wide action), so it stays in the default-allow bucket rather
    // than admin-ops.ts's `approved: false` APPROVAL_REQUIRED case.
    const entityDecision = authorizeEntityAction(
      "FINANCIAL_TRANSACTION",
      "UPDATE",
      { mode: "WRITE", writeGateOpen: true, approved: true },
    );
    if (entityDecision.decision === "DENIED") {
      throw new AtlasError("FORBIDDEN", entityDecision.reason, {
        statusCode: 403,
      });
    }
    if (entityDecision.decision === "APPROVAL_REQUIRED") {
      throw new AtlasError(
        "FORBIDDEN",
        "FINANCIAL_TRANSACTION.UPDATE requires explicit approval",
        { statusCode: 403 },
      );
    }

    // No `checkResourceAccess` ownership check here: `identity.ownerId` is
    // always resolved from the signed-in caller's own id (see
    // `resolveOwnerId` in plan-quota.ts — the caller's id takes priority
    // over any other fallback), so this endpoint only ever mutates the
    // acting user's own tenant subscription — there's no separate/other
    // account owner to compare against (mirrors portfolio.ts's
    // discovery/link route, which skips the ownership check for the same
    // reason).
    const body = setPlanSchema.parse(request.body);
    const identity = await resolveCloudIdentity(app, request);
    setTenantPlanTier(app.atlasEnv, body.tier, identity.ownerId);
    const { tier } = resolveTier(app.atlasEnv, identity.ownerId);
    ensureCreditsInitialized(tier);
    return getAccountPlan(app.atlasEnv, identity);
  });

  app.get("/api/v1/billing/credits", async (request) => {
    const identity = await resolveCloudIdentity(app, request);
    const { tier } = resolveTier(app.atlasEnv, identity.ownerId);
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
    await requireSignedInForWrite(app, request);

    // Same entity-policy gate as POST /billing/plan above: granting credits
    // is a financial-transaction CREATE (HIGH_RISK_WRITE, requires
    // approval by default). Same self-approved-human-write rationale
    // applies — this is a signed-in caller directly purchasing credits for
    // their own account via the REST API, not an agent-initiated action.
    const entityDecision = authorizeEntityAction(
      "FINANCIAL_TRANSACTION",
      "CREATE",
      { mode: "WRITE", writeGateOpen: true, approved: true },
    );
    if (entityDecision.decision === "DENIED") {
      throw new AtlasError("FORBIDDEN", entityDecision.reason, { statusCode: 403 });
    }
    if (entityDecision.decision === "APPROVAL_REQUIRED") {
      throw new AtlasError(
        "FORBIDDEN",
        "FINANCIAL_TRANSACTION.CREATE requires explicit approval",
        { statusCode: 403 },
      );
    }

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
    await requireSignedInForWrite(app, request);

    // Same FINANCIAL_TRANSACTION.CREATE gate as /billing/credits/purchase —
    // this route either creates a real Stripe Checkout Session (live mode)
    // or returns a stub description of one; both branches represent the
    // caller initiating a financial transaction for their own account.
    const entityDecision = authorizeEntityAction(
      "FINANCIAL_TRANSACTION",
      "CREATE",
      { mode: "WRITE", writeGateOpen: true, approved: true },
    );
    if (entityDecision.decision === "DENIED") {
      throw new AtlasError("FORBIDDEN", entityDecision.reason, { statusCode: 403 });
    }
    if (entityDecision.decision === "APPROVAL_REQUIRED") {
      throw new AtlasError(
        "FORBIDDEN",
        "FINANCIAL_TRANSACTION.CREATE requires explicit approval",
        { statusCode: 403 },
      );
    }

    const rawBody =
      request.body && typeof request.body === "object"
        ? request.body
        : { pack: "starter" as const };
    const body = stripeCheckoutBodySchema.parse(rawBody);
    const stripeSecret = process.env.STRIPE_SECRET_KEY;
    const identity = await resolveCloudIdentity(app, request);
    const user = await getRequestUser(app, request);

    if (!stripeSecret) {
      return reply.status(200).send({
        mode: "stub",
        provider: "stripe",
        pack: body.pack ?? null,
        tier: body.tier ?? null,
        ownerId: identity.ownerId,
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
      ownerId: identity.ownerId,
      customerEmail: user?.email ?? null,
    });

    return reply.status(200).send({
      mode: "live",
      provider: "stripe",
      pack: body.pack ?? null,
      tier: body.tier ?? null,
      ownerId: identity.ownerId,
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
              data?: {
                object?: {
                  id?: string;
                  client_reference_id?: string | null;
                  customer?: string | { id?: string } | null;
                  subscription?: string | { id?: string } | null;
                  status?: string;
                  metadata?: Record<string, string>;
                };
              };
            })
          : {};

      const object = event.data?.object ?? {};

      if (event.type === "checkout.session.completed") {
        const fulfillment = fulfillStripeCheckoutSession(object);
        app.atlasLogger.info("stripe_webhook_fulfilled", {
          type: event.type,
          sessionId: fulfillment.sessionId ?? null,
          ownerId: fulfillment.ownerId ?? null,
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
      }

      if (
        event.type === "customer.subscription.updated" ||
        event.type === "customer.subscription.deleted"
      ) {
        const fulfillment = fulfillStripeSubscriptionEvent({
          type: event.type,
          subscription: object,
        });
        app.atlasLogger.info("stripe_webhook_subscription", {
          type: event.type,
          subscriptionId: fulfillment.subscriptionId ?? null,
          ownerId: fulfillment.ownerId ?? null,
          tier: fulfillment.tier ?? null,
          duplicate: fulfillment.duplicate ?? false,
          handled: fulfillment.handled,
        });
        return reply.status(200).send({
          received: true,
          mode: "live",
          ...fulfillment,
        });
      }

      app.atlasLogger.info("stripe_webhook_ignored", { type: event.type ?? null });
      return reply.status(200).send({ received: true, handled: false });
    },
  );
}

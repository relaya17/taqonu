import type { FastifyInstance } from "fastify";
import {
  AtlasError,
  PLATFORM_CODENAME,
  PLATFORM_NAME,
  PLATFORM_VERSION,
  PREFERRED_CUSTOMER_CLOUD,
  STORAGE_POLICY_VERSION,
  byoCloudBindingSchema,
  connectByoCloudSchema,
  disconnectByoCloudSchema,
  platformInfoSchema,
} from "@atlas/shared";
import { looksLikeCloudflareApiToken } from "@atlas/integrations-cloudflare";
import { osStore } from "../store/os-store.js";
import { resolveOwnerId } from "../services/plan-quota.js";
import { resolveCloudIdentity } from "../services/cloud-identity.js";
import { requireSignedInForWrite } from "../middleware/auth-guards.js";
import { enforceEntityWrite } from "../services/risk-audit.js";

/**
 * BYO customer cloud — Cloudflare-first.
 * Atlas never stores customer R2/D1 payloads; free storage is the customer's CF free tier.
 */
export async function registerByoCloudRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/api/v1/platform", async () =>
    platformInfoSchema.parse({
      name: PLATFORM_NAME,
      codename: PLATFORM_CODENAME,
      version: PLATFORM_VERSION,
      storagePolicyVersion: STORAGE_POLICY_VERSION,
      storageModel: "BYO_CUSTOMER_CLOUD",
      preferredCustomerCloud: PREFERRED_CUSTOMER_CLOUD,
    }),
  );

  app.get("/api/v1/byo-cloud/status", async (request) => {
    const identity = await resolveCloudIdentity(app, request);
    const ownerId = resolveOwnerId(app.atlasEnv, identity.ownerId);
    const stored = osStore.getByoCloudBinding(ownerId);
    if (!stored) {
      return byoCloudBindingSchema.parse({
        provider: "cloudflare",
        status: "disconnected",
        accountLabel: null,
        externalAccountId: null,
        connectedAt: null,
        lastError: null,
        capabilities: [],
      });
    }
    return byoCloudBindingSchema.parse({
      provider: stored.provider,
      status: stored.status,
      accountLabel: stored.accountLabel,
      externalAccountId: stored.externalAccountId,
      connectedAt: stored.connectedAt,
      lastError: stored.lastError,
      capabilities: stored.capabilities,
    });
  });

  app.post("/api/v1/byo-cloud/cloudflare/connect", async (request) => {
    // ROLE-LEVEL gate: this writes a customer cloud-binding config, so it
    // requires a signed-in caller (previously wide open — `resolveCloudIdentity`
    // alone does not throw for an unauthenticated request, it silently falls
    // back to a stub owner id).
    const user = await requireSignedInForWrite(app, request);
    const body = connectByoCloudSchema.parse(request.body ?? {});
    if (body.apiToken && !looksLikeCloudflareApiToken(body.apiToken)) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        "Cloudflare API token shape looks invalid.",
        { statusCode: 400 },
      );
    }

    // ENTITY-LEVEL gate: connecting a BYO-cloud binding creates new
    // control-plane configuration for this tenant. This is self-service
    // (the caller connects their OWN account, immediately reversible via
    // disconnect below), so an authenticated WRITE-session caller's own
    // request is treated as sufficient authorization — no separate
    // human-approval round trip is manufactured for it.
    enforceEntityWrite({
      entityType: "CONFIGURATION",
      action: "CREATE",
      routeLabel: "byo-cloud.connect",
      actorId: user.id,
    });

    const identity = await resolveCloudIdentity(app, request);
    const ownerId = resolveOwnerId(app.atlasEnv, identity.ownerId);
    const connectedAt = new Date().toISOString();

    // v1: record binding metadata only. Token is accepted for future encrypted
    // vault; never written to store.json / API responses.
    osStore.setByoCloudBinding(ownerId, {
      provider: "cloudflare",
      status: "connected",
      accountLabel: body.accountLabel,
      externalAccountId: body.externalAccountId ?? null,
      connectedAt,
      lastError: null,
      capabilities: body.capabilities ?? ["workers", "r2", "d1"],
      tokenConfigured: Boolean(body.apiToken),
    });

    return byoCloudBindingSchema.parse({
      provider: "cloudflare",
      status: "connected",
      accountLabel: body.accountLabel,
      externalAccountId: body.externalAccountId ?? null,
      connectedAt,
      lastError: null,
      capabilities: body.capabilities ?? ["workers", "r2", "d1"],
    });
  });

  app.post("/api/v1/byo-cloud/cloudflare/disconnect", async (request) => {
    const user = await requireSignedInForWrite(app, request);
    disconnectByoCloudSchema.parse(request.body ?? { provider: "cloudflare" });

    // ENTITY-LEVEL gate: removes stored binding config. `DELETE` is
    // DESTRUCTIVE-tier under `DEFAULT_ENTITY_POLICIES`, but as with connect
    // above this is self-service and reversible (reconnect any time), so
    // an authenticated WRITE-session caller's own request is sufficient.
    enforceEntityWrite({
      entityType: "CONFIGURATION",
      action: "DELETE",
      routeLabel: "byo-cloud.disconnect",
      actorId: user.id,
    });

    const identity = await resolveCloudIdentity(app, request);
    const ownerId = resolveOwnerId(app.atlasEnv, identity.ownerId);
    osStore.clearByoCloudBinding(ownerId);
    return byoCloudBindingSchema.parse({
      provider: "cloudflare",
      status: "disconnected",
      accountLabel: null,
      externalAccountId: null,
      connectedAt: null,
      lastError: null,
      capabilities: [],
    });
  });
}

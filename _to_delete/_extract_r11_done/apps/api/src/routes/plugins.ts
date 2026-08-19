import type { FastifyInstance } from "fastify";
import { AtlasError, pluginManifestIdSchema, pluginManifestStatusSchema } from "@atlas/shared";
import {
  approvePlugin,
  authorizeEntityAction,
  disablePlugin,
  enablePlugin,
  getPlugin,
  listPlugins,
  registerPlugin,
  rejectPlugin,
  uninstallPlugin,
  validatePluginManifest,
} from "@atlas/agent-core";
import { z } from "zod";
import { requireAdmin } from "../middleware/auth-guards.js";

const paramsSchema = z.object({ id: pluginManifestIdSchema });
const querySchema = z.object({ status: pluginManifestStatusSchema.optional() });
const reasonBodySchema = z.object({ reason: z.string().min(1) });

/**
 * ENTITY-LEVEL gate, independent of the `requireAdmin` ROLE-LEVEL gate
 * already applied by each caller below. `requireAdmin` only proves the
 * caller holds the admin *role* — it says nothing about whether this
 * particular *class* of action (mutating a third-party plugin's
 * registration/approval/lifecycle state — effectively a capability grant
 * to run untrusted code against `declaredTools` /
 * `declaredEntityActions`) has actually been approved. Mirrors the
 * two-axis pattern used by `kernel.ts`, `gates.ts` and `byo-cloud.ts`:
 * an authenticated admin's own request is treated as sufficient
 * authorization (no separate human-approval round trip is manufactured
 * here — that would be a new approval-workflow integration, out of scope
 * for this HTTP layer), so `writeGateOpen`/`approved` are hardcoded
 * `true`. Both `DENIED` and `APPROVAL_REQUIRED` are translated to the
 * same 403 `FORBIDDEN` — `APPROVAL_REQUIRED` is never silently treated
 * as allowed, matching `kernel.ts`/`gates.ts` precedent.
 */
function enforcePluginEntityAuthz(
  action: "CREATE" | "UPDATE" | "DELETE",
  routeLabel: string,
): void {
  const entityAuthz = authorizeEntityAction("CONFIGURATION", action, {
    mode: "WRITE",
    writeGateOpen: true,
    approved: true,
  });
  if (entityAuthz.decision !== "ALLOWED") {
    const reason =
      entityAuthz.decision === "DENIED"
        ? entityAuthz.reason
        : `${routeLabel} (CONFIGURATION.${action}) was not ALLOWED.`;
    throw new AtlasError("FORBIDDEN", reason, { statusCode: 403 });
  }
}

/**
 * Plugin SDK HTTP layer — thin wrapper around `@atlas/agent-core`'s
 * `plugin-registry.ts` (validate/register/list/get) and
 * `plugin-lifecycle.ts` (approve/reject/enable/disable/uninstall). Neither
 * module has any notion of "who is calling" by design, so every mutating
 * route here is `requireAdmin`-gated, mirroring
 * `apps/api/src/routes/agent-lifecycle.ts`.
 */
export async function registerPluginRoutes(app: FastifyInstance): Promise<void> {
  /** Public read — list registered plugins, optionally filtered by status. */
  app.get("/api/v1/plugins", async (request) => {
    const { status } = querySchema.parse(request.query);
    return { items: listPlugins(status) };
  });

  /** Public read — a single registered plugin by id. */
  app.get("/api/v1/plugins/:id", async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const plugin = getPlugin(id);
    if (!plugin) {
      throw new AtlasError("NOT_FOUND", `Plugin "${id}" is not registered.`, {
        statusCode: 404,
      });
    }
    return plugin;
  });

  /**
   * Register a new plugin manifest. The request body is untrusted `unknown`
   * from the HTTP layer, so it is run through `validatePluginManifest` first
   * (shape + policy-engine cross-check) — a 400 with the full `errors` array
   * is returned for anything that fails validation, never an opaque 500.
   * Only once shape-valid is it handed to `registerPlugin`, whose only
   * remaining failure mode at that point is a duplicate id (409).
   */
  app.post("/api/v1/plugins", async (request, reply) => {
    await requireAdmin(app, request);
    // Registering a manifest is the entry point of a third-party
    // capability grant — CONFIGURATION.CREATE.
    enforcePluginEntityAuthz("CREATE", "plugins.register");

    const validated = validatePluginManifest(request.body);
    if (!validated.valid) {
      throw new AtlasError("VALIDATION_ERROR", "Invalid plugin manifest", {
        details: { errors: validated.errors },
      });
    }

    const result = registerPlugin(validated.manifest);
    if (!result.ok) {
      throw new AtlasError("CONFLICT", result.reason, { statusCode: 409 });
    }

    reply.status(201);
    return { ok: true, plugin: result.plugin };
  });

  app.post("/api/v1/plugins/:id/approve", async (request) => {
    const user = await requireAdmin(app, request);
    // Approving mutates the manifest's status (PENDING_REVIEW -> APPROVED)
    // and is what actually activates its declared capability grant —
    // CONFIGURATION.UPDATE.
    enforcePluginEntityAuthz("UPDATE", "plugins.approve");
    const { id } = paramsSchema.parse(request.params);
    const { reason } = reasonBodySchema.parse(request.body);

    const result = approvePlugin(id, { approvedBy: user.id, reason });
    if (!result.ok) {
      throw new AtlasError("FORBIDDEN", result.reason, { statusCode: 403 });
    }
    return { ok: true, plugin: result.plugin };
  });

  app.post("/api/v1/plugins/:id/reject", async (request) => {
    const user = await requireAdmin(app, request);
    // Rejecting mutates the manifest's status (PENDING_REVIEW -> REJECTED)
    // — CONFIGURATION.UPDATE.
    enforcePluginEntityAuthz("UPDATE", "plugins.reject");
    const { id } = paramsSchema.parse(request.params);
    const { reason } = reasonBodySchema.parse(request.body);

    const result = rejectPlugin(id, { rejectedBy: user.id, reason });
    if (!result.ok) {
      throw new AtlasError("FORBIDDEN", result.reason, { statusCode: 403 });
    }
    return { ok: true, plugin: result.plugin };
  });

  app.post("/api/v1/plugins/:id/enable", async (request) => {
    await requireAdmin(app, request);
    // Enabling mutates the manifest's status (APPROVED -> ENABLED), turning
    // the plugin's already-approved capability grant live — CONFIGURATION.UPDATE.
    enforcePluginEntityAuthz("UPDATE", "plugins.enable");
    const { id } = paramsSchema.parse(request.params);

    const result = enablePlugin(id);
    if (!result.ok) {
      throw new AtlasError("FORBIDDEN", result.reason, { statusCode: 403 });
    }
    return { ok: true, plugin: result.plugin };
  });

  app.post("/api/v1/plugins/:id/disable", async (request) => {
    await requireAdmin(app, request);
    // Disabling mutates the manifest's status (ENABLED -> DISABLED),
    // revoking the plugin's live capability grant without deleting its
    // registration — DESTRUCTIVE-tier under `DEFAULT_ENTITY_POLICIES`
    // (same tier as DELETE for CONFIGURATION), but reversible via
    // enable again, so it maps to CONFIGURATION.UPDATE rather than DELETE.
    enforcePluginEntityAuthz("UPDATE", "plugins.disable");
    const { id } = paramsSchema.parse(request.params);

    const result = disablePlugin(id);
    if (!result.ok) {
      throw new AtlasError("FORBIDDEN", result.reason, { statusCode: 403 });
    }
    return { ok: true, plugin: result.plugin };
  });

  app.post("/api/v1/plugins/:id/uninstall", async (request) => {
    await requireAdmin(app, request);
    // Uninstalling permanently removes the manifest's registration
    // (irreversible — re-adding it is a fresh `register`, not an undo) —
    // CONFIGURATION.DELETE, the DESTRUCTIVE tier `DEFAULT_ENTITY_POLICIES`
    // reserves for entity removal.
    enforcePluginEntityAuthz("DELETE", "plugins.uninstall");
    const { id } = paramsSchema.parse(request.params);

    const result = uninstallPlugin(id);
    if (!result.ok) {
      throw new AtlasError("FORBIDDEN", result.reason, { statusCode: 403 });
    }
    // `uninstallPlugin` returns just `{ ok: true }` (no `.plugin` — see its
    // doc comment in plugin-lifecycle.ts), so re-fetch current state to keep
    // the HTTP response useful.
    return { ok: true, plugin: getPlugin(id) };
  });
}

import type { FastifyInstance } from "fastify";
import { AtlasError, pluginManifestIdSchema, pluginManifestStatusSchema } from "@atlas/shared";
import {
  approvePlugin,
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
    const { id } = paramsSchema.parse(request.params);

    const result = enablePlugin(id);
    if (!result.ok) {
      throw new AtlasError("FORBIDDEN", result.reason, { statusCode: 403 });
    }
    return { ok: true, plugin: result.plugin };
  });

  app.post("/api/v1/plugins/:id/disable", async (request) => {
    await requireAdmin(app, request);
    const { id } = paramsSchema.parse(request.params);

    const result = disablePlugin(id);
    if (!result.ok) {
      throw new AtlasError("FORBIDDEN", result.reason, { statusCode: 403 });
    }
    return { ok: true, plugin: result.plugin };
  });

  app.post("/api/v1/plugins/:id/uninstall", async (request) => {
    await requireAdmin(app, request);
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

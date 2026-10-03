import type { FastifyInstance, FastifyRequest } from "fastify";
import { AtlasError } from "@atlas/shared";
import { requireUser } from "./auth-guards.js";
import { authorizeStudioExtensionRequest } from "../services/studio-extensions.js";

/** Header Studio sends when a request is made on behalf of an extension (ADR-026). */
export const STUDIO_EXTENSION_HEADER = "x-arletos-extension";
/** Project the extension panel is acting in, for routes without a project in the URL. */
export const STUDIO_EXTENSION_PROJECT_HEADER = "x-arletos-project";

const EXTENSION_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function header(request: FastifyRequest, name: string): string | null {
  const value = request.headers[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function projectIdOf(request: FastifyRequest): string | null {
  const params = (request.params ?? {}) as Record<string, unknown>;
  const query = (request.query ?? {}) as Record<string, unknown>;
  const body =
    request.body && typeof request.body === "object" ? (request.body as Record<string, unknown>) : {};
  for (const candidate of [params.id, params.projectId, query.projectId, body.projectId]) {
    if (typeof candidate === "string" && UUID.test(candidate)) {
      // `:id` is a project only on /projects/:id/... routes.
      if (candidate === params.id && !request.routeOptions.url?.startsWith("/api/v1/projects/:id")) {
        continue;
      }
      return candidate;
    }
  }
  const fromHeader = header(request, STUDIO_EXTENSION_PROJECT_HEADER);
  return fromHeader && UUID.test(fromHeader) ? fromHeader : null;
}

/**
 * ADR-026 enforcement: a request that says it comes from a Studio extension
 * may only reach routes that extension declares, in a project where it is
 * enabled, with the bound permission granted by the user. Requests without
 * the header (core Studio surfaces) are untouched.
 */
export function registerStudioExtensionGate(app: FastifyInstance): void {
  app.addHook("preHandler", async (request) => {
    const extensionId = header(request, STUDIO_EXTENSION_HEADER);
    if (!extensionId) return;
    if (!EXTENSION_ID.test(extensionId) || extensionId.length > 80) {
      throw new AtlasError("FORBIDDEN", "Unknown Studio extension", { statusCode: 403 });
    }
    const user = await requireUser(app, request);
    const body =
      request.body && typeof request.body === "object" ? (request.body as Record<string, unknown>) : {};
    const decision = authorizeStudioExtensionRequest({
      userId: user.id,
      extensionId,
      projectId: projectIdOf(request),
      method: request.method,
      url: request.routeOptions.url ?? "",
      commandId: typeof body.commandId === "string" ? body.commandId : null,
    });
    if (!decision.ok) {
      throw new AtlasError(
        "FORBIDDEN",
        `Studio extension "${extensionId}" is not allowed here (${decision.denial}).`,
        { statusCode: 403, details: { extensionId, denial: decision.denial } },
      );
    }
  });
}

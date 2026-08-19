import type { FastifyInstance } from "fastify";
import { AtlasError, fabricAgentIdSchema } from "@atlas/shared";
import {
  listAgentLifecycleState,
  setAgentEnabled,
} from "@atlas/agent-core";
import { z } from "zod";
import { requireAdmin } from "../middleware/auth-guards.js";

const paramsSchema = z.object({ id: fabricAgentIdSchema });

export async function registerAgentLifecycleRoutes(
  app: FastifyInstance,
): Promise<void> {
  /** Public read — runtime enable/disable overlay for the agent registry. */
  app.get("/api/v1/agents/lifecycle", async () => ({
    items: listAgentLifecycleState(),
  }));

  app.post("/api/v1/agents/:id/enable", async (request) => {
    await requireAdmin(app, request);
    const { id } = paramsSchema.parse(request.params);
    const result = setAgentEnabled(id, true);
    if (!result.ok) {
      throw new AtlasError("FORBIDDEN", result.reason, { statusCode: 403 });
    }
    const entry = listAgentLifecycleState().find((item) => item.agentId === id);
    return entry;
  });

  app.post("/api/v1/agents/:id/disable", async (request) => {
    await requireAdmin(app, request);
    const { id } = paramsSchema.parse(request.params);
    const result = setAgentEnabled(id, false);
    if (!result.ok) {
      throw new AtlasError("FORBIDDEN", result.reason, { statusCode: 403 });
    }
    const entry = listAgentLifecycleState().find((item) => item.agentId === id);
    return entry;
  });
}

import type { FastifyInstance } from "fastify";
import { AtlasError, fabricAgentIdSchema } from "@atlas/shared";
import { listAgentLifecycleState, setAgentEnabled } from "@atlas/agent-core";
import { z } from "zod";
import { requireAdmin } from "../middleware/auth-guards.js";
import { enforceEntityWrite } from "../services/risk-audit.js";

const paramsSchema = z.object({ id: fabricAgentIdSchema });

export async function registerAgentLifecycleRoutes(
  app: FastifyInstance,
): Promise<void> {
  /** Public read — runtime enable/disable overlay for the agent registry. */
  app.get("/api/v1/agents/lifecycle", async () => ({
    items: listAgentLifecycleState(),
  }));

  app.post("/api/v1/agents/:id/enable", async (request) => {
    const user = await requireAdmin(app, request);
    const { id } = paramsSchema.parse(request.params);
    enforceEntityWrite({
      entityType: "CONFIGURATION",
      action: "UPDATE",
      routeLabel: "agents.enable",
      actorId: user.id,
      input: { agentId: id },
    });
    const result = setAgentEnabled(id, true);
    if (!result.ok) {
      throw new AtlasError("FORBIDDEN", result.reason, { statusCode: 403 });
    }
    const entry = listAgentLifecycleState().find((item) => item.agentId === id);
    return entry;
  });

  app.post("/api/v1/agents/:id/disable", async (request) => {
    const user = await requireAdmin(app, request);
    const { id } = paramsSchema.parse(request.params);
    enforceEntityWrite({
      entityType: "CONFIGURATION",
      action: "UPDATE",
      routeLabel: "agents.disable",
      actorId: user.id,
      input: { agentId: id },
    });
    const result = setAgentEnabled(id, false);
    if (!result.ok) {
      throw new AtlasError("FORBIDDEN", result.reason, { statusCode: 403 });
    }
    const entry = listAgentLifecycleState().find((item) => item.agentId === id);
    return entry;
  });
}

import type { FastifyInstance } from "fastify";
import { AtlasError, fabricAgentIdSchema } from "@atlas/shared";
import {
  authorizeEntityAction,
  listAgentLifecycleState,
  setAgentEnabled,
} from "@atlas/agent-core";
import { z } from "zod";
import { requireAdmin } from "../middleware/auth-guards.js";

const paramsSchema = z.object({ id: fabricAgentIdSchema });

/**
 * ENTITY-LEVEL gate for the 2 mutating routes below, independent of the
 * `requireAdmin` ROLE-LEVEL gate already applied by each one — enabling/
 * disabling a fabric agent is a control-plane setting, CONFIGURATION per
 * `BusinessEntityType`'s own doc comment. Same pattern as `plugins.ts`'s
 * `enforcePluginEntityAuthz`.
 */
function enforceAgentLifecycleEntityAuthz(routeLabel: string): void {
  const entityAuthz = authorizeEntityAction("CONFIGURATION", "UPDATE", {
    mode: "WRITE",
    writeGateOpen: true,
    approved: true,
  });
  if (entityAuthz.decision !== "ALLOWED") {
    const reason =
      entityAuthz.decision === "DENIED"
        ? entityAuthz.reason
        : `${routeLabel} (CONFIGURATION.UPDATE) was not ALLOWED.`;
    throw new AtlasError("FORBIDDEN", reason, { statusCode: 403 });
  }
}

export async function registerAgentLifecycleRoutes(
  app: FastifyInstance,
): Promise<void> {
  /** Public read — runtime enable/disable overlay for the agent registry. */
  app.get("/api/v1/agents/lifecycle", async () => ({
    items: listAgentLifecycleState(),
  }));

  app.post("/api/v1/agents/:id/enable", async (request) => {
    await requireAdmin(app, request);
    enforceAgentLifecycleEntityAuthz("agents.enable");
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
    enforceAgentLifecycleEntityAuthz("agents.disable");
    const { id } = paramsSchema.parse(request.params);
    const result = setAgentEnabled(id, false);
    if (!result.ok) {
      throw new AtlasError("FORBIDDEN", result.reason, { statusCode: 403 });
    }
    const entry = listAgentLifecycleState().find((item) => item.agentId === id);
    return entry;
  });
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AGENT_RUNTIME_CONTROL_PATH, AtlasError } from "@atlas/shared";
import { requireControlPlaneService } from "../services/governed-lifecycle-handoff.js";
import {
  clearDurableAgentRuntimeStatus,
  setDurableAgentRuntimeStatus,
  DURABLE_AGENT_RUNTIME_STATUSES,
} from "../services/agent-runtime-controls.js";

/**
 * Step 4 Decision B — Control-Plane-service-authenticated write surface for
 * the durable agent-runtime-control subset (PAUSED/QUARANTINED/REVOKED/
 * DISABLED). Same bearer contract as the existing governed-lifecycle-
 * handoff and atlas-self-control routes (`requireControlPlaneService`) --
 * not a new auth mechanism. Called by
 * `apps/control-plane/src/services/atlas-self-agent-control.ts` via the
 * existing `callAtlasApi` CP -> API pattern
 * (`apps/control-plane/src/services/lifecycle-handoff.ts`).
 *
 * This is the sole write path for the durable subset. Reads happen
 * in-process, from apps/api's own database, via
 * `resolveGovernedAgentIdentity` (`agent-runtime-authz.ts`) -- there is no
 * corresponding GET route here, because dispatchAgentAction's read never
 * goes over HTTP for this subset.
 */
const setBodySchema = z.object({
  agentId: z.string().min(1).max(200),
  status: z.enum(DURABLE_AGENT_RUNTIME_STATUSES),
  setBy: z.string().min(1).max(200),
  reason: z.string().min(1).max(2000),
  expiresAt: z.string().min(1).max(64).nullable().optional(),
});

export async function registerAgentRuntimeControlRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post(AGENT_RUNTIME_CONTROL_PATH, async (request) => {
    requireControlPlaneService(request.headers.authorization);
    const parsed = setBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw new AtlasError("VALIDATION_ERROR", "Malformed agent runtime control request", {
        statusCode: 400,
      });
    }
    const record = await setDurableAgentRuntimeStatus(parsed.data);
    return { record };
  });

  app.delete(`${AGENT_RUNTIME_CONTROL_PATH}/:agentId`, async (request) => {
    requireControlPlaneService(request.headers.authorization);
    const { agentId } = request.params as { agentId: string };
    await clearDurableAgentRuntimeStatus(agentId);
    return { cleared: true };
  });
}

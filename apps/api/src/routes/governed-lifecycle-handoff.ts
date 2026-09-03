import type { FastifyInstance } from "fastify";
import {
  AtlasError,
  GOVERNED_LIFECYCLE_HANDOFF_PATH,
  governedLifecycleHandoffSchema,
} from "@atlas/shared";
import {
  acceptGovernedLifecycleHandoff,
  requireControlPlaneService,
} from "../services/governed-lifecycle-handoff.js";

export async function registerGovernedLifecycleHandoffRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post(GOVERNED_LIFECYCLE_HANDOFF_PATH, async (request) => {
    requireControlPlaneService(request.headers.authorization);
    const parsed = governedLifecycleHandoffSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw new AtlasError("VALIDATION_ERROR", "Malformed governed lifecycle handoff", {
        statusCode: 400,
      });
    }
    return acceptGovernedLifecycleHandoff({ handoff: parsed.data });
  });
}

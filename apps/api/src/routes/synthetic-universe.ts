import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  SYNTHETIC_SCENARIO_CLOSED_LOOP_PATH,
  SYNTHETIC_SCENARIO_RUN_PATH,
} from "@atlas/synthetic-universe";
import { requireSignedInForWrite } from "../middleware/auth-guards.js";
import {
  runSyntheticClosedLoopForAtlas,
  runSyntheticScenarioForAtlas,
} from "../services/synthetic-universe-run.js";

const runBodySchema = z.object({
  tenantId: z.string().trim().min(1).max(128),
  scenarioId: z.string().trim().min(1).max(200),
});

export async function registerSyntheticUniverseRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post(SYNTHETIC_SCENARIO_RUN_PATH, async (request) => {
    const user = await requireSignedInForWrite(app, request);
    const body = runBodySchema.parse(request.body ?? {});
    return runSyntheticScenarioForAtlas({
      user,
      scenarioId: body.scenarioId,
      tenantId: body.tenantId,
    });
  });

  app.post(SYNTHETIC_SCENARIO_CLOSED_LOOP_PATH, async (request) => {
    const user = await requireSignedInForWrite(app, request);
    const body = runBodySchema.parse(request.body ?? {});
    return runSyntheticClosedLoopForAtlas({
      user,
      scenarioId: body.scenarioId,
      tenantId: body.tenantId,
    });
  });
}

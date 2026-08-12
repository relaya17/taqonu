import type { FastifyInstance } from "fastify";
import {
  projectCurrentStateResponseSchema,
  reconcileProjectStateRequestSchema,
  uuidSchema,
} from "@atlas/shared";
import { z } from "zod";
import { osStore } from "../store/os-store.js";
import { runStateReconciliation } from "../services/state-reconciliation.js";
import {
  buildCurrentStateRollup,
  emptyUnknownSnapshot,
} from "../services/current-state-rollup.js";

export async function registerStateRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/projects/:id/state", async (request) => {
    const params = z.object({ id: uuidSchema }).parse(request.params);
    const snapshot =
      osStore.getSnapshot(params.id) ?? emptyUnknownSnapshot(params.id);
    const rollup = buildCurrentStateRollup(
      snapshot,
      osStore.getEvidence(params.id),
    );
    return projectCurrentStateResponseSchema.parse(rollup);
  });

  app.post("/api/v1/projects/:id/state/reconcile", async (request, reply) => {
    const params = z.object({ id: uuidSchema }).parse(request.params);
    reconcileProjectStateRequestSchema.parse(request.body ?? {});

    const snapshot = runStateReconciliation(params.id);
    const rollup = buildCurrentStateRollup(
      snapshot,
      osStore.getEvidence(params.id),
    );

    app.atlasLogger.info("state_reconciled", {
      projectId: params.id,
      snapshotId: snapshot.id,
      overall: snapshot.overallEpistemicState,
      conflicts: snapshot.conflicts.length,
      evidenceLinked: rollup.evidence.length,
    });

    return reply.status(200).send(projectCurrentStateResponseSchema.parse(rollup));
  });
}

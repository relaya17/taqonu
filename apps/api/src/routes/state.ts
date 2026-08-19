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
  assertProjectReadAccess,
  assertProjectWriteAccess,
} from "../services/project-access.js";
import {
  buildCurrentStateRollup,
  emptyUnknownSnapshot,
} from "../services/current-state-rollup.js";
import { enforceEntityWrite } from "../services/risk-audit.js";

export async function registerStateRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/projects/:id/state", async (request) => {
    // SECURITY FIX (found while widening Policy Engine coverage): this
    // route had ZERO auth — the project's full Current State rollup
    // (evidence, conflicts, snapshot) was readable by anyone who knew the
    // project id. This is the central Current State read endpoint.
    const params = z.object({ id: uuidSchema }).parse(request.params);
    await assertProjectReadAccess(app, request, params.id);
    const snapshot =
      osStore.getSnapshot(params.id) ?? emptyUnknownSnapshot(params.id);
    const rollup = buildCurrentStateRollup(
      snapshot,
      osStore.getEvidence(params.id),
    );
    return projectCurrentStateResponseSchema.parse(rollup);
  });

  app.post("/api/v1/projects/:id/state/reconcile", async (request, reply) => {
    // SECURITY FIX: same class of gap as the GET above — this route had
    // ZERO auth and both leaks the rollup and triggers real reconciliation
    // compute.
    const params = z.object({ id: uuidSchema }).parse(request.params);
    const user = await assertProjectWriteAccess(app, request, params.id);
    enforceEntityWrite({
      entityType: "RECORD",
      action: "UPDATE",
      routeLabel: "projects.state.reconcile",
      actorId: user.id,
      projectId: params.id,
    });
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

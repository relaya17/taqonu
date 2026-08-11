import type { FastifyInstance } from "fastify";
import {
  projectStateSnapshotSchema,
  reconcileProjectStateRequestSchema,
  uuidSchema,
} from "@atlas/shared";
import { z } from "zod";
import { osStore } from "../store/os-store.js";
import { runStateReconciliation } from "../services/state-reconciliation.js";

function emptyUnknownSnapshot(projectId: string) {
  const now = new Date().toISOString();
  return projectStateSnapshotSchema.parse({
    id: crypto.randomUUID(),
    projectId,
    asOf: now,
    reconciledAt: now,
    slices: [
      {
        key: "GIT",
        summary: "No GitHub sync yet — state UNKNOWN until connector evidence arrives.",
        epistemicState: "UNKNOWN",
        confidence: 0,
        evidenceIds: [],
        claimIds: [],
        asOf: now,
        validUntil: null,
        stale: true,
      },
    ],
    conflicts: [],
    overallEpistemicState: "UNKNOWN",
    sourceConnectors: ["github"],
  });
}

export async function registerStateRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/projects/:id/state", async (request) => {
    const params = z.object({ id: uuidSchema }).parse(request.params);
    return osStore.getSnapshot(params.id) ?? emptyUnknownSnapshot(params.id);
  });

  app.post("/api/v1/projects/:id/state/reconcile", async (request, reply) => {
    const params = z.object({ id: uuidSchema }).parse(request.params);
    reconcileProjectStateRequestSchema.parse(request.body ?? {});

    const snapshot = runStateReconciliation(params.id);
    app.atlasLogger.info("state_reconciled", {
      projectId: params.id,
      snapshotId: snapshot.id,
      overall: snapshot.overallEpistemicState,
      conflicts: snapshot.conflicts.length,
    });

    return reply.status(200).send(snapshot);
  });
}

import type { FastifyInstance } from "fastify";
import {
  createEvidenceRecordSchema,
  evidenceRecordSchema,
} from "@atlas/shared";
import { osStore } from "../store/os-store.js";

const OWNER_ID = "00000000-0000-4000-8000-000000000001";

export async function registerEvidenceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/evidence", async () => {
    const items = [...osStore.evidence.values()].flat();
    return {
      items,
      page: 1,
      pageSize: 20,
      total: items.length,
    };
  });

  app.post("/api/v1/evidence", async (request, reply) => {
    const body = createEvidenceRecordSchema.parse(request.body);
    const now = new Date().toISOString();
    const record = evidenceRecordSchema.parse({
      id: crypto.randomUUID(),
      ownerId: OWNER_ID,
      projectId: body.projectId ?? null,
      source: body.source,
      sourceType: body.sourceType,
      sourceId: body.sourceId ?? null,
      uri: body.uri ?? null,
      excerpt: body.excerpt ?? null,
      version: body.version ?? null,
      observedAt: body.observedAt ?? now,
      createdAt: now,
      confidence: body.confidence ?? 1,
      epistemicState: body.epistemicState,
      metadata: body.metadata ?? {},
    });
    if (record.projectId) {
      osStore.addEvidence(record.projectId, [record]);
    }
    osStore.recordEvent({
      type: "evidence.recorded",
      evidenceId: record.id,
      projectId: record.projectId,
      occurredAt: now,
    });
    return reply.status(201).send(record);
  });
}

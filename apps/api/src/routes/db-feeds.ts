import type { FastifyInstance } from "fastify";
import { evidenceRecordSchema, uuidSchema } from "@atlas/shared";
import {
  summarizeSupabaseFeed,
  supabaseFeedInputSchema,
} from "@atlas/integrations-supabase";
import {
  summarizeMongoFeed,
  mongoFeedInputSchema,
} from "@atlas/integrations-mongodb";
import { z } from "zod";
import { osStore } from "../store/os-store.js";
import { runStateReconciliation } from "../services/state-reconciliation.js";

const OWNER_ID = "00000000-0000-4000-8000-000000000001";

export async function registerDbFeedRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/feeds/supabase", async (request, reply) => {
    const body = supabaseFeedInputSchema.parse(request.body);
    const summarized = summarizeSupabaseFeed(body);
    const now = new Date().toISOString();

    osStore.setDbFeed(body.projectId, {
      provider: "supabase",
      projectId: body.projectId,
      observedAt: now,
      summary: summarized.summary,
      tableOrCollectionCount: summarized.tableCount,
      names: summarized.names,
      rlsEnabled: body.rlsEnabled ?? null,
      host: body.hostLabel,
    });

    const evidence = evidenceRecordSchema.parse({
      id: crypto.randomUUID(),
      ownerId: OWNER_ID,
      projectId: body.projectId,
      source: `supabase:${body.hostLabel}`,
      sourceType: "CONNECTOR",
      sourceId: body.hostLabel,
      uri: null,
      excerpt: summarized.summary,
      version: null,
      observedAt: now,
      createdAt: now,
      confidence: 1,
      epistemicState: "FACT",
      metadata: {
        schema: body.schemaName,
        tableCount: summarized.tableCount,
        rlsEnabled: body.rlsEnabled ?? null,
      },
    });
    osStore.addEvidence(body.projectId, [evidence]);

    const snapshot = runStateReconciliation(body.projectId);
    return reply.status(201).send({ feed: summarized, evidenceId: evidence.id, snapshot });
  });

  app.post("/api/v1/feeds/mongodb", async (request, reply) => {
    const body = mongoFeedInputSchema.parse(request.body);
    const summarized = summarizeMongoFeed(body);
    const now = new Date().toISOString();

    osStore.setDbFeed(body.projectId, {
      provider: "mongodb",
      projectId: body.projectId,
      observedAt: now,
      summary: summarized.summary,
      tableOrCollectionCount: summarized.collectionCount,
      names: summarized.names,
      rlsEnabled: null,
      host: body.hostLabel,
    });

    const evidence = evidenceRecordSchema.parse({
      id: crypto.randomUUID(),
      ownerId: OWNER_ID,
      projectId: body.projectId,
      source: `mongodb:${body.hostLabel}/${body.databaseName}`,
      sourceType: "CONNECTOR",
      sourceId: body.databaseName,
      uri: null,
      excerpt: summarized.summary,
      version: null,
      observedAt: now,
      createdAt: now,
      confidence: 1,
      epistemicState: "FACT",
      metadata: {
        collectionCount: summarized.collectionCount,
        indexCount: body.indexCount ?? null,
      },
    });
    osStore.addEvidence(body.projectId, [evidence]);

    const snapshot = runStateReconciliation(body.projectId);
    return reply.status(201).send({ feed: summarized, evidenceId: evidence.id, snapshot });
  });

  app.get("/api/v1/feeds/:projectId", async (request) => {
    const params = z.object({ projectId: uuidSchema }).parse(request.params);
    return {
      items: osStore.getDbFeeds(params.projectId),
    };
  });
}

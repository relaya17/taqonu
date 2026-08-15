import type { FastifyInstance } from "fastify";
import { parseEvidenceRecord, uuidSchema } from "@atlas/shared";
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
import { resolveCloudIdentity } from "../services/cloud-identity.js";
import { assertProjectWriteAccess } from "../services/project-access.js";

/**
 * Customer Mongo/Supabase as **observation feeds** → DATABASE evidence.
 * Never accepts connection secrets; Atlas app DB is separate (osStore / optional Supabase).
 */
export async function registerDbFeedRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/feeds/supabase", async (request, reply) => {
    const body = supabaseFeedInputSchema.parse(request.body);
    assertProjectWriteAccess(app, request, body.projectId);
    const { ownerId } = await resolveCloudIdentity(app, request);
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

    const evidence = parseEvidenceRecord({
      id: crypto.randomUUID(),
      ownerId,
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
      category: "DATABASE",
      metadata: {
        schema: body.schemaName,
        tableCount: summarized.tableCount,
        rlsEnabled: body.rlsEnabled ?? null,
        feedRole: "customer_observation_not_atlas_primary",
      },
    });
    osStore.addEvidence(body.projectId, [evidence]);

    const snapshot = runStateReconciliation(body.projectId);
    return reply.status(201).send({
      feed: summarized,
      evidenceId: evidence.id,
      snapshot,
      note: "Customer Supabase metadata only — not Atlas primary store; no secrets accepted.",
    });
  });

  app.post("/api/v1/feeds/mongodb", async (request, reply) => {
    const body = mongoFeedInputSchema.parse(request.body);
    assertProjectWriteAccess(app, request, body.projectId);
    const { ownerId } = await resolveCloudIdentity(app, request);
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

    const evidence = parseEvidenceRecord({
      id: crypto.randomUUID(),
      ownerId,
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
      category: "DATABASE",
      metadata: {
        collectionCount: summarized.collectionCount,
        indexCount: body.indexCount ?? null,
        feedRole: "customer_observation_not_atlas_primary",
      },
    });
    osStore.addEvidence(body.projectId, [evidence]);

    const snapshot = runStateReconciliation(body.projectId);
    return reply.status(201).send({
      feed: summarized,
      evidenceId: evidence.id,
      snapshot,
      note: "Customer MongoDB metadata only — not Atlas primary store; no secrets accepted.",
    });
  });

  app.get("/api/v1/feeds/:projectId", async (request) => {
    const params = z.object({ projectId: uuidSchema }).parse(request.params);
    return {
      items: osStore.getDbFeeds(params.projectId),
      deployment: osStore.getDeployFeeds(params.projectId),
      note: "Observation feeds for Current State DATABASE + DEPLOYMENT — distinct from Atlas persistence.",
    };
  });
}

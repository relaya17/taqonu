import type { FastifyInstance } from "fastify";
import {
  AtlasError,
  STUB_OWNER_ID,
  evidenceRecordSchema,
  normalizedEvidenceDraftSchema,
  providerAdapterIdSchema,
  uuidSchema,
} from "@atlas/shared";
import { vercelObservationToEvidenceDrafts } from "@atlas/integrations-vercel";
import { z } from "zod";
import { osStore } from "../store/os-store.js";
import { appendDomainEvent } from "../services/memory-pipeline.js";

const vercelObserveSchema = z.object({
  projectId: uuidSchema,
  projectName: z.string().min(1).max(200),
  deploymentUrl: z.string().url().nullable(),
  environment: z.enum(["production", "preview", "development"]),
  readyState: z.enum(["READY", "ERROR", "BUILDING", "QUEUED", "UNKNOWN"]),
  commitSha: z.string().max(80).nullable(),
});

export async function registerProviderAdapterRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/api/v1/providers/adapters", async () => ({
    items: [
      {
        id: "github",
        status: "live",
        note: "Full observe → evidence (FACT)",
      },
      {
        id: "local",
        status: "live",
        note: "Local folder scan",
      },
      {
        id: "vercel",
        status: "mvp",
        note: "POST /api/v1/providers/vercel/observe → normalized evidence",
      },
      {
        id: "supabase",
        status: "feed",
        note: "DB feed observation (not full adapter yet)",
      },
      {
        id: "mongodb",
        status: "feed",
        note: "DB feed observation (not full adapter yet)",
      },
      {
        id: "ci",
        status: "planned",
        note: "CI artifact adapter planned",
      },
      {
        id: "sentry",
        status: "planned",
        note: "Error observation adapter planned",
      },
      {
        id: "stripe",
        status: "planned",
        note: "Billing event adapter planned",
      },
    ],
    contract: "Provider Adapter → Normalized Evidence → Atlas Evidence Graph",
  }));

  app.post("/api/v1/providers/vercel/observe", async (request, reply) => {
    const body = vercelObserveSchema.parse(request.body);
    const project = osStore.getProject(body.projectId);
    if (!project) {
      throw new AtlasError("NOT_FOUND", "Project not found");
    }
    const now = new Date().toISOString();
    const drafts = vercelObservationToEvidenceDrafts({
      projectName: body.projectName,
      deploymentUrl: body.deploymentUrl,
      environment: body.environment,
      readyState: body.readyState,
      commitSha: body.commitSha,
      observedAt: now,
    });

    const sourceType =
      body.environment === "production"
        ? "PRODUCTION"
        : body.environment === "preview"
          ? "STAGING"
          : "CI";

    const records = drafts.map((draft) => {
      const normalized = normalizedEvidenceDraftSchema.parse(draft);
      return evidenceRecordSchema.parse({
        id: crypto.randomUUID(),
        ownerId: STUB_OWNER_ID,
        projectId: body.projectId,
        source: normalized.source,
        sourceType,
        sourceId: normalized.sourceId,
        uri: normalized.uri,
        excerpt: normalized.excerpt,
        version: normalized.version,
        observedAt: normalized.observedAt,
        createdAt: now,
        epistemicState: normalized.epistemicState,
        confidence: normalized.confidence,
        authorityRank: normalized.authorityRank,
        classification: normalized.classification,
        metadata: {
          provider: "vercel",
          adapter: true,
          environment: body.environment,
          readyState: body.readyState,
        },
      });
    });

    osStore.addEvidence(body.projectId, records);
    appendDomainEvent({
      type: "provider.observation",
      projectId: body.projectId,
      epistemicState: records[0]?.epistemicState ?? "OBSERVED",
      payload: {
        provider: providerAdapterIdSchema.parse("vercel"),
        evidenceIds: records.map((r) => r.id),
        environment: body.environment,
        readyState: body.readyState,
      },
    });
    appendDomainEvent({
      type: "evidence.recorded",
      projectId: body.projectId,
      epistemicState: "OBSERVED",
      payload: { count: records.length, provider: "vercel" },
    });

    return reply.status(201).send({
      provider: "vercel",
      evidence: records,
      note: "Normalized via Provider Adapter contract (ADR-014 §9).",
    });
  });
}

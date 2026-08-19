import type { FastifyInstance } from "fastify";
import {
  AtlasError,
  STUB_OWNER_ID,
  parseEvidenceRecord,
  normalizedEvidenceDraftSchema,
  providerAdapterIdSchema,
  uuidSchema,
} from "@atlas/shared";
import { vercelObservationToEvidenceDrafts } from "@atlas/integrations-vercel";
import { renderObservationToEvidenceDrafts } from "@atlas/integrations-render";
import { z } from "zod";
import { osStore } from "../store/os-store.js";
import { appendDomainEvent } from "../services/memory-pipeline.js";
import { assertProjectWriteAccess } from "../services/project-access.js";
import { enforceEntityWrite } from "../services/risk-audit.js";

const vercelObserveSchema = z.object({
  projectId: uuidSchema,
  projectName: z.string().min(1).max(200),
  deploymentUrl: z.string().url().nullable(),
  environment: z.enum(["production", "preview", "development"]),
  readyState: z.enum(["READY", "ERROR", "BUILDING", "QUEUED", "UNKNOWN"]),
  commitSha: z.string().max(80).nullable(),
});

const renderObserveSchema = z.object({
  projectId: uuidSchema,
  serviceName: z.string().min(1).max(200),
  serviceUrl: z.string().url().nullable(),
  environment: z.enum(["production", "preview", "development"]),
  status: z.enum(["live", "build_failed", "suspended", "deploying", "unknown"]),
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
        status: "live",
        note: "POST /api/v1/feeds/vercel → DEPLOYMENT evidence (+ /providers/vercel/observe)",
      },
      {
        id: "netlify",
        status: "planned",
        note: "Netlify observe adapter planned (process-audit provider target)",
      },
      {
        id: "render",
        status: "live",
        note: "POST /api/v1/feeds/render → DEPLOYMENT evidence (+ /providers/render/observe)",
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
        id: "cloudflare",
        status: "live",
        note: "BYO customer cloud (preferred free tier) — POST /api/v1/byo-cloud/cloudflare/connect",
      },
      {
        id: "ci",
        status: "mvp",
        note: "POST /api/v1/security/sarif → SECURITY evidence (SARIF)",
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
      {
        id: "aws",
        status: "planned",
        note: "AWS console link + observe planned",
      },
      {
        id: "azure",
        status: "planned",
        note: "Azure portal link + observe planned",
      },
      {
        id: "gcp",
        status: "planned",
        note: "Google Cloud console link + observe planned",
      },
    ],
    contract: "Provider Adapter → Normalized Evidence → Atlas Evidence Graph",
  }));

  app.post("/api/v1/providers/vercel/observe", async (request, reply) => {
    const body = vercelObserveSchema.parse(request.body);
    const user = await assertProjectWriteAccess(app, request, body.projectId);
    enforceEntityWrite({
      entityType: "CONFIGURATION",
      action: "CREATE",
      routeLabel: "providers.vercel.observe",
      actorId: user.id,
      projectId: body.projectId,
    });
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
      return parseEvidenceRecord({
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
        category: "DEPLOYMENT",
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

  app.post("/api/v1/providers/render/observe", async (request, reply) => {
    const body = renderObserveSchema.parse(request.body);
    const user = await assertProjectWriteAccess(app, request, body.projectId);
    enforceEntityWrite({
      entityType: "CONFIGURATION",
      action: "CREATE",
      routeLabel: "providers.render.observe",
      actorId: user.id,
      projectId: body.projectId,
    });
    const project = osStore.getProject(body.projectId);
    if (!project) {
      throw new AtlasError("NOT_FOUND", "Project not found");
    }
    const now = new Date().toISOString();
    const drafts = renderObservationToEvidenceDrafts({
      serviceName: body.serviceName,
      serviceUrl: body.serviceUrl,
      environment: body.environment,
      status: body.status,
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
      return parseEvidenceRecord({
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
        category: "DEPLOYMENT",
        metadata: {
          provider: "render",
          adapter: true,
          environment: body.environment,
          status: body.status,
        },
      });
    });

    osStore.addEvidence(body.projectId, records);
    appendDomainEvent({
      type: "provider.observation",
      projectId: body.projectId,
      epistemicState: records[0]?.epistemicState ?? "OBSERVED",
      payload: {
        provider: providerAdapterIdSchema.parse("render"),
        evidenceIds: records.map((r) => r.id),
        environment: body.environment,
        status: body.status,
      },
    });
    appendDomainEvent({
      type: "evidence.recorded",
      projectId: body.projectId,
      epistemicState: "OBSERVED",
      payload: { count: records.length, provider: "render" },
    });

    return reply.status(201).send({
      provider: "render",
      evidence: records,
      note: "Normalized via Provider Adapter contract (ADR-014 §9).",
    });
  });
}

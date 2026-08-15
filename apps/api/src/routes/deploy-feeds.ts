import type { FastifyInstance } from "fastify";
import {
  normalizedEvidenceDraftSchema,
  parseEvidenceRecord,
  uuidSchema,
} from "@atlas/shared";
import {
  summarizeVercelFeed,
  vercelObservationToEvidenceDrafts,
} from "@atlas/integrations-vercel";
import {
  summarizeRenderFeed,
  renderObservationToEvidenceDrafts,
} from "@atlas/integrations-render";
import { z } from "zod";
import { osStore } from "../store/os-store.js";
import { runStateReconciliation } from "../services/state-reconciliation.js";
import { resolveCloudIdentity } from "../services/cloud-identity.js";
import { assertProjectWriteAccess } from "../services/project-access.js";

const vercelFeedBodySchema = z.object({
  projectId: uuidSchema,
  projectName: z.string().min(1).max(200),
  deploymentUrl: z.string().url().nullable().optional(),
  environment: z.enum(["production", "preview", "development"]),
  readyState: z.enum(["READY", "ERROR", "BUILDING", "QUEUED", "UNKNOWN"]),
  commitSha: z.string().max(80).nullable().optional(),
});

const renderFeedBodySchema = z.object({
  projectId: uuidSchema,
  serviceName: z.string().min(1).max(200),
  serviceUrl: z.string().url().nullable().optional(),
  environment: z.enum(["production", "preview", "development"]),
  status: z.enum(["live", "build_failed", "suspended", "deploying", "unknown"]),
  commitSha: z.string().max(80).nullable().optional(),
});

/**
 * Vercel/Render as **observation feeds** → DEPLOYMENT evidence.
 * Metadata only — never accepts deploy tokens / API secrets.
 */
export async function registerDeployFeedRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post("/api/v1/feeds/vercel", async (request, reply) => {
    const body = vercelFeedBodySchema.parse(request.body);
    assertProjectWriteAccess(app, request, body.projectId);
    const { ownerId } = await resolveCloudIdentity(app, request);
    const summarized = summarizeVercelFeed({
      projectId: body.projectId,
      projectName: body.projectName,
      deploymentUrl: body.deploymentUrl ?? null,
      environment: body.environment,
      readyState: body.readyState,
      commitSha: body.commitSha ?? null,
    });
    const now = new Date().toISOString();

    osStore.setDeployFeed(body.projectId, {
      provider: "vercel",
      projectId: body.projectId,
      observedAt: now,
      summary: summarized.summary,
      environment: summarized.environment,
      status: summarized.status,
      url: summarized.url,
      commitSha: summarized.commitSha,
      hostLabel: body.projectName,
    });

    const drafts = vercelObservationToEvidenceDrafts({
      projectName: body.projectName,
      deploymentUrl: summarized.url,
      environment: body.environment,
      readyState: body.readyState,
      commitSha: summarized.commitSha,
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
        ownerId,
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
          feedRole: "deploy_observation",
          environment: body.environment,
          readyState: body.readyState,
        },
      });
    });
    osStore.addEvidence(body.projectId, records);

    const snapshot = runStateReconciliation(body.projectId);
    let observeCycleId: string | null = null;
    try {
      const { tryContinuousObserve } = await import(
        "../services/observe-cycle.js"
      );
      const observed = tryContinuousObserve({
        projectId: body.projectId,
        envGoldenRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
        trigger: "deploy",
        deployEvent: {
          provider: "vercel",
          environment: summarized.environment,
          status: summarized.status,
          observedAt: now,
          url: summarized.url,
          commitSha: summarized.commitSha,
          hostLabel: body.projectName,
          summary: summarized.summary,
        },
      });
      observeCycleId = observed?.id ?? null;
    } catch {
      /* best-effort */
    }
    return reply.status(201).send({
      feed: summarized,
      evidenceIds: records.map((r) => r.id),
      snapshot,
      observeCycleId,
      note: "Vercel deployment metadata only — no tokens accepted; DEPLOYMENT slice updated.",
    });
  });

  app.post("/api/v1/feeds/render", async (request, reply) => {
    const body = renderFeedBodySchema.parse(request.body);
    assertProjectWriteAccess(app, request, body.projectId);
    const { ownerId } = await resolveCloudIdentity(app, request);
    const summarized = summarizeRenderFeed({
      projectId: body.projectId,
      serviceName: body.serviceName,
      serviceUrl: body.serviceUrl ?? null,
      environment: body.environment,
      status: body.status,
      commitSha: body.commitSha ?? null,
    });
    const now = new Date().toISOString();

    osStore.setDeployFeed(body.projectId, {
      provider: "render",
      projectId: body.projectId,
      observedAt: now,
      summary: summarized.summary,
      environment: summarized.environment,
      status: summarized.status,
      url: summarized.url,
      commitSha: summarized.commitSha,
      hostLabel: body.serviceName,
    });

    const drafts = renderObservationToEvidenceDrafts({
      serviceName: body.serviceName,
      serviceUrl: summarized.url,
      environment: body.environment,
      status: body.status,
      commitSha: summarized.commitSha,
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
        ownerId,
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
          feedRole: "deploy_observation",
          environment: body.environment,
          status: body.status,
        },
      });
    });
    osStore.addEvidence(body.projectId, records);

    const snapshot = runStateReconciliation(body.projectId);
    let observeCycleId: string | null = null;
    try {
      const { tryContinuousObserve } = await import(
        "../services/observe-cycle.js"
      );
      const observed = tryContinuousObserve({
        projectId: body.projectId,
        envGoldenRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
        trigger: "deploy",
        deployEvent: {
          provider: "render",
          environment: summarized.environment,
          status: summarized.status,
          observedAt: now,
          url: summarized.url,
          commitSha: summarized.commitSha,
          hostLabel: body.serviceName,
          summary: summarized.summary,
        },
      });
      observeCycleId = observed?.id ?? null;
    } catch {
      /* best-effort */
    }
    return reply.status(201).send({
      feed: summarized,
      evidenceIds: records.map((r) => r.id),
      snapshot,
      observeCycleId,
      note: "Render deployment metadata only — no tokens accepted; DEPLOYMENT slice updated.",
    });
  });

  app.get("/api/v1/feeds/:projectId/deployment", async (request) => {
    const params = z.object({ projectId: uuidSchema }).parse(request.params);
    return {
      items: osStore.getDeployFeeds(params.projectId),
      note: "Observation feeds for Current State DEPLOYMENT — distinct from DATABASE feeds.",
    };
  });
}

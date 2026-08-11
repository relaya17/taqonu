import type { FastifyInstance } from "fastify";
import {
  GITHUB_APP_PERMISSIONS,
  GITHUB_SYNC_STAGES,
  verifyGitHubWebhookSignature,
} from "@atlas/integrations-github";
import { AtlasError, uuidSchema } from "@atlas/shared";
import { z } from "zod";
import {
  ingestGitHubSync,
  runStateReconciliation,
} from "../services/state-reconciliation.js";
import { discoverGitHubPortfolio } from "../services/portfolio-discovery.js";
import { osStore } from "../store/os-store.js";

const syncBodySchema = z.object({
  projectId: uuidSchema,
  fullName: z.string().min(1).max(200),
  defaultBranch: z.string().max(200).nullable().optional(),
  private: z.boolean().optional(),
  htmlUrl: z.string().url().nullable().optional(),
  headSha: z.string().max(64).nullable().optional(),
  openPrCount: z.number().int().min(0).optional(),
  openIssueCount: z.number().int().min(0).optional(),
  dependencyManifests: z.array(z.string().min(1)).optional(),
  hasCiConfig: z.boolean().optional(),
  architectureDocPaths: z.array(z.string().min(1)).optional(),
  hasTestDirectory: z.boolean().optional(),
  recentCiStatus: z.enum(["success", "failure", "unknown"]).nullable().optional(),
  hasDependabot: z.boolean().optional(),
  hasCodeowners: z.boolean().optional(),
  reconcile: z.boolean().default(true),
});

type InstallationState =
  | "not_configured"
  | "configured"
  | "webhook_ready"
  | "active";

function resolveInstallation(env: {
  GITHUB_APP_ID?: string | undefined;
  GITHUB_PRIVATE_KEY?: string | undefined;
  GITHUB_WEBHOOK_SECRET?: string | undefined;
}): {
  installation: InstallationState;
  appIdConfigured: boolean;
  privateKeyConfigured: boolean;
  webhookSecretConfigured: boolean;
} {
  const appIdConfigured = Boolean(env.GITHUB_APP_ID);
  const privateKeyConfigured = Boolean(env.GITHUB_PRIVATE_KEY);
  const webhookSecretConfigured = Boolean(env.GITHUB_WEBHOOK_SECRET);
  let installation: InstallationState = "not_configured";
  if (appIdConfigured && privateKeyConfigured && webhookSecretConfigured) {
    installation = "webhook_ready";
  } else if (appIdConfigured && privateKeyConfigured) {
    installation = "configured";
  }
  const last = osStore.getMeta("github.lastWebhookAt");
  if (installation === "webhook_ready" && last) {
    installation = "active";
  }
  return {
    installation,
    appIdConfigured,
    privateKeyConfigured,
    webhookSecretConfigured,
  };
}

export async function registerGithubRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/github", async () => {
    const status = resolveInstallation(app.atlasEnv);
    return {
      provider: "github",
      installation: status.installation,
      appIdConfigured: status.appIdConfigured,
      privateKeyConfigured: status.privateKeyConfigured,
      webhookSecretConfigured: status.webhookSecretConfigured,
      lastWebhookAt: osStore.getMeta("github.lastWebhookAt") ?? null,
      lastSyncAt: osStore.getMeta("github.lastSyncAt") ?? null,
      permissions: GITHUB_APP_PERMISSIONS,
      syncStages: GITHUB_SYNC_STAGES,
      mvpNote:
        status.installation === "not_configured"
          ? "Set GITHUB_APP_ID + GITHUB_PRIVATE_KEY + GITHUB_WEBHOOK_SECRET. BYO discover/sync still works without App install."
          : "App credentials present. POST /webhooks for incremental sync; POST /discover and /sync remain for BYO bootstrap.",
    };
  });

  app.post("/api/v1/github/discover", async (request, reply) => {
    const result = discoverGitHubPortfolio(request.body);
    app.atlasLogger.info("github_discover_completed", {
      created: result.created,
      updated: result.updated,
      total: result.projects.length,
    });
    return reply.status(201).send(result);
  });

  app.post("/api/v1/github/sync", async (request, reply) => {
    const body = syncBodySchema.parse(request.body);
    const { observation, evidence } = ingestGitHubSync(body.projectId, body);

    const snapshot = body.reconcile
      ? runStateReconciliation(body.projectId)
      : null;

    const now = new Date().toISOString();
    osStore.setMeta("github.lastSyncAt", now);

    app.atlasLogger.info("github_sync_ingested", {
      projectId: body.projectId,
      fullName: observation.fullName,
      evidenceCount: evidence.length,
      reconciled: Boolean(snapshot),
    });

    return reply.status(201).send({
      observation,
      evidenceCount: evidence.length,
      snapshot,
      syncedAt: now,
    });
  });

  app.post("/api/v1/github/webhooks", async (request, reply) => {
    const secret = app.atlasEnv.GITHUB_WEBHOOK_SECRET;
    if (!secret) {
      throw new AtlasError(
        "CONFIG_ERROR",
        "GITHUB_WEBHOOK_SECRET is not configured",
      );
    }

    const payload =
      typeof request.body === "string"
        ? request.body
        : JSON.stringify(request.body ?? {});

    const signatureHeader = request.headers["x-hub-signature-256"];
    verifyGitHubWebhookSignature({
      payload,
      signatureHeader: Array.isArray(signatureHeader)
        ? signatureHeader[0]
        : signatureHeader,
      secret,
    });

    const event = String(request.headers["x-github-event"] ?? "unknown");
    const now = new Date().toISOString();
    osStore.setMeta("github.lastWebhookAt", now);

    let syncResult: { synced: boolean; projectId?: string; reason?: string } = {
      synced: false,
      reason: "no_matching_project",
    };

    try {
      const body =
        typeof request.body === "object" && request.body
          ? (request.body as Record<string, unknown>)
          : (JSON.parse(payload) as Record<string, unknown>);
      const repo = body.repository as
        | { full_name?: string; default_branch?: string; private?: boolean; html_url?: string }
        | undefined;
      const fullName = repo?.full_name;
      if (fullName) {
        const projects = osStore.listProjects();
        const match = projects.find(
          (p) =>
            p.slug === fullName.split("/")[1]?.toLowerCase() ||
            p.name.toLowerCase() === fullName.toLowerCase(),
        );
        if (match) {
          const headSha =
            typeof (body.after as string | undefined) === "string"
              ? (body.after as string)
              : typeof (body.pull_request as { head?: { sha?: string } } | undefined)
                    ?.head?.sha === "string"
                ? (body.pull_request as { head: { sha: string } }).head.sha
                : null;
          const syncInput: {
            projectId: string;
            fullName: string;
            defaultBranch?: string | null;
            private?: boolean;
            htmlUrl?: string | null;
            headSha?: string | null;
            reconcile: boolean;
          } = {
            projectId: match.id,
            fullName,
            reconcile: true,
          };
          if (repo.default_branch !== undefined) {
            syncInput.defaultBranch = repo.default_branch;
          }
          if (repo.private !== undefined) {
            syncInput.private = repo.private;
          }
          if (repo.html_url !== undefined) {
            syncInput.htmlUrl = repo.html_url;
          }
          if (headSha !== null) {
            syncInput.headSha = headSha;
          }
          ingestGitHubSync(match.id, syncInput);
          runStateReconciliation(match.id);
          osStore.setMeta("github.lastSyncAt", now);
          syncResult = { synced: true, projectId: match.id };
        }
      }
    } catch (error) {
      app.atlasLogger.warn("github_webhook_sync_partial", {
        event,
        error: error instanceof Error ? error.message : "unknown",
      });
      syncResult = {
        synced: false,
        reason: error instanceof Error ? error.message : "parse_error",
      };
    }

    app.atlasLogger.info("github_webhook_accepted", {
      event,
      synced: syncResult.synced,
    });

    return reply.status(202).send({
      accepted: true,
      event,
      at: now,
      ...syncResult,
    });
  });
}

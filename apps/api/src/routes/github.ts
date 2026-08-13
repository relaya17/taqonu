import type { FastifyInstance } from "fastify";
import {
  GITHUB_APP_PERMISSIONS,
  GITHUB_INSTALLATION_STATES,
  GITHUB_SYNC_STAGES,
  buildGitHubAppSetupUrl,
  extractIncrementalWebhookSync,
  fetchGitHubAppInstallation,
  matchProjectByRepoFullName,
  normalizeGithubPrivateKey,
  resolveGitHubAppSlug,
  signGitHubInstallState,
  verifyGitHubInstallState,
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
import { atlasMetrics } from "./metrics.js";

const SUPPORTED_LOCALES = new Set(["he", "en", "ar"]);
const DEFAULT_LOCALE = "he";

function safeLocale(locale: string | null | undefined): string {
  return locale && SUPPORTED_LOCALES.has(locale) ? locale : DEFAULT_LOCALE;
}

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

type InstallationState = keyof typeof GITHUB_INSTALLATION_STATES;

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

function resolveSetupUrl(env: {
  GITHUB_APP_ID?: string | undefined;
  GITHUB_PRIVATE_KEY?: string | undefined;
  GITHUB_APP_SLUG?: string | undefined;
  GITHUB_APP_NAME?: string | undefined;
}): {
  setupUrl: string | null;
  appSlug: string | null;
  setupUrlNote: string | null;
} {
  const credentialsExist = Boolean(env.GITHUB_APP_ID && env.GITHUB_PRIVATE_KEY);
  const appSlug = resolveGitHubAppSlug(env);
  if (credentialsExist && appSlug) {
    return {
      setupUrl: buildGitHubAppSetupUrl(appSlug),
      appSlug,
      setupUrlNote: null,
    };
  }
  if (credentialsExist && !appSlug) {
    return {
      setupUrl: null,
      appSlug: null,
      setupUrlNote:
        "App credentials are set, but setup URL is null — set GITHUB_APP_SLUG (or GITHUB_APP_NAME) to expose https://github.com/apps/{slug}/installations/new.",
    };
  }
  return {
    setupUrl: null,
    appSlug: null,
    setupUrlNote: null,
  };
}

export async function registerGithubRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/github", async () => {
    const status = resolveInstallation(app.atlasEnv);
    const setup = resolveSetupUrl(app.atlasEnv);
    const installations = osStore.listGithubAppInstallations();
    return {
      provider: "github",
      installation: status.installation,
      installationStates: GITHUB_INSTALLATION_STATES,
      appIdConfigured: status.appIdConfigured,
      privateKeyConfigured: status.privateKeyConfigured,
      webhookSecretConfigured: status.webhookSecretConfigured,
      appSlug: setup.appSlug,
      setupUrl: setup.setupUrl,
      setupUrlNote: setup.setupUrlNote,
      /** Full-page redirect that starts the signed install flow (see /api/v1/github/install). */
      installUrl: setup.appSlug ? "/api/v1/github/install" : null,
      installations,
      lastWebhookAt: osStore.getMeta("github.lastWebhookAt") ?? null,
      lastSyncAt: osStore.getMeta("github.lastSyncAt") ?? null,
      permissions: GITHUB_APP_PERMISSIONS,
      syncStages: GITHUB_SYNC_STAGES,
      mvpNote:
        status.installation === "not_configured"
          ? "Set GITHUB_APP_ID + GITHUB_PRIVATE_KEY + GITHUB_WEBHOOK_SECRET (+ GITHUB_APP_SLUG for install URL). BYO discover/sync still works without App install."
          : "App credentials present. GET /install redirects to GitHub's install page; /install/callback verifies + persists installation_id via the App JWT. POST /webhooks for incremental sync; POST /discover and /sync remain for BYO bootstrap.",
    };
  });

  app.get("/api/v1/github/install", async (request, reply) => {
    const env = app.atlasEnv;
    const appSlug = resolveGitHubAppSlug(env);
    if (!appSlug) {
      throw new AtlasError(
        "CONFIG_ERROR",
        "GITHUB_APP_SLUG (or GITHUB_APP_NAME) is not configured — cannot build the GitHub App install URL",
      );
    }

    const query = z
      .object({
        projectId: uuidSchema.optional(),
        locale: z.string().min(1).max(8).optional(),
      })
      .parse(request.query ?? {});

    const state = signGitHubInstallState({
      secret: env.COOKIE_SECRET,
      projectId: query.projectId ?? null,
      locale: safeLocale(query.locale),
    });

    const installUrl = buildGitHubAppSetupUrl(appSlug, state);
    app.atlasLogger.info("github_install_redirect", {
      projectId: query.projectId ?? null,
    });
    return reply.redirect(installUrl);
  });

  app.get("/api/v1/github/install/callback", async (request, reply) => {
    const env = app.atlasEnv;
    const query = z
      .object({
        installation_id: z.string().min(1).optional(),
        setup_action: z.string().optional(),
        state: z.string().optional(),
      })
      .parse(request.query ?? {});

    const decodedState = query.state
      ? verifyGitHubInstallState({ state: query.state, secret: env.COOKIE_SECRET })
      : null;
    const locale = safeLocale(decodedState?.locale);

    const redirectTo = (params: Record<string, string>): string => {
      const url = new URL(`${env.WEB_ORIGIN}/${locale}/integrations`);
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
      return url.toString();
    };

    // Org owner approval still pending — no installation_id to confirm yet.
    if (query.setup_action === "request") {
      return reply.redirect(redirectTo({ github_install: "pending" }));
    }

    if (!query.installation_id) {
      return reply.redirect(
        redirectTo({ github_install: "error", reason: "missing_installation_id" }),
      );
    }

    if (!query.state || !decodedState) {
      app.atlasLogger.warn("github_install_callback_invalid_state", {
        hasState: Boolean(query.state),
      });
      return reply.redirect(redirectTo({ github_install: "error", reason: "invalid_state" }));
    }

    const appId = env.GITHUB_APP_ID;
    const privateKey = env.GITHUB_PRIVATE_KEY;
    if (!appId || !privateKey) {
      return reply.redirect(
        redirectTo({ github_install: "error", reason: "app_not_configured" }),
      );
    }

    try {
      const info = await fetchGitHubAppInstallation({
        installationId: query.installation_id,
        appId,
        privateKeyPem: normalizeGithubPrivateKey(privateKey),
      });

      const now = new Date().toISOString();
      osStore.upsertGithubAppInstallation({
        installationId: String(info.id),
        projectId: decodedState.projectId,
        accountLogin: info.accountLogin,
        accountType: info.accountType,
        targetType: info.targetType,
        repositorySelection: info.repositorySelection,
        setupAction: query.setup_action ?? null,
        suspendedAt: info.suspendedAt,
        installedAt: now,
        updatedAt: now,
      });

      atlasMetrics.record("retrieval_hit_rate", 1, {
        kind: "github_install_callback",
        outcome: "success",
      });
      app.atlasLogger.info("github_install_confirmed", {
        installationId: info.id,
        projectId: decodedState.projectId,
        accountLogin: info.accountLogin,
      });

      return reply.redirect(
        redirectTo({ github_install: "success", installation_id: String(info.id) }),
      );
    } catch (error) {
      atlasMetrics.record("retrieval_hit_rate", 0, {
        kind: "github_install_callback",
        outcome: "error",
      });
      app.atlasLogger.warn("github_install_confirm_failed", {
        installationId: query.installation_id,
        error: error instanceof Error ? error.message : "unknown",
      });
      return reply.redirect(
        redirectTo({ github_install: "error", reason: "verification_failed" }),
      );
    }
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

    let syncResult: {
      synced: boolean;
      projectId?: string;
      fullName?: string;
      headSha?: string | null;
      recentCiStatus?: string | null;
      reason?: string;
    } = {
      synced: false,
      reason: "no_matching_project",
    };

    try {
      const body =
        typeof request.body === "object" && request.body
          ? (request.body as Record<string, unknown>)
          : (JSON.parse(payload) as Record<string, unknown>);

      const incremental = extractIncrementalWebhookSync({ event, body });
      if (!incremental.shouldSync || !incremental.repo) {
        syncResult = {
          synced: false,
          reason: incremental.reason ?? "event_not_incremental",
        };
      } else {
        const fullName = incremental.repo.fullName;
        const projects = osStore.listProjects().map((p) => ({
          id: p.id,
          slug: p.slug,
          name: p.name,
          githubFullName: osStore.github.get(p.id)?.fullName ?? null,
        }));
        const match = matchProjectByRepoFullName(fullName, projects);

        if (!match) {
          syncResult = {
            synced: false,
            fullName,
            reason: "no_matching_project",
          };
        } else {
          const syncInput: {
            projectId: string;
            fullName: string;
            defaultBranch?: string | null;
            private?: boolean;
            htmlUrl?: string | null;
            headSha?: string | null;
            recentCiStatus?: "success" | "failure" | "unknown" | null;
            reconcile: boolean;
          } = {
            projectId: match.id,
            fullName,
            reconcile: true,
          };
          if (incremental.repo.defaultBranch !== null) {
            syncInput.defaultBranch = incremental.repo.defaultBranch;
          }
          if (incremental.repo.private !== undefined) {
            syncInput.private = incremental.repo.private;
          }
          if (incremental.repo.htmlUrl !== null) {
            syncInput.htmlUrl = incremental.repo.htmlUrl;
          }
          if (incremental.headSha !== null) {
            syncInput.headSha = incremental.headSha;
          }
          if (incremental.recentCiStatus !== null) {
            syncInput.recentCiStatus = incremental.recentCiStatus;
          }

          ingestGitHubSync(match.id, syncInput);
          runStateReconciliation(match.id);
          osStore.setMeta("github.lastSyncAt", now);
          syncResult = {
            synced: true,
            projectId: match.id,
            fullName,
            headSha: incremental.headSha,
            recentCiStatus: incremental.recentCiStatus,
          };

          // TRUTH-10 0.9 — continuous observer when local workspace is linked
          try {
            const { tryContinuousObserve } = await import(
              "../services/observe-cycle.js"
            );
            const observed = tryContinuousObserve({
              projectId: match.id,
              envGoldenRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
              trigger: "github_webhook",
            });
            if (observed) {
              app.atlasLogger.info("observer_cycle_from_webhook", {
                projectId: match.id,
                observeCycleId: observed.id,
                riskBand: observed.risk.band,
              });
            }
          } catch (observeErr) {
            app.atlasLogger.warn("observer_cycle_webhook_skipped", {
              projectId: match.id,
              error:
                observeErr instanceof Error ? observeErr.message : "unknown",
            });
          }
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

    atlasMetrics.record("retrieval_hit_rate", syncResult.synced ? 1 : 0, {
      kind: "github_webhook",
      event,
      synced: syncResult.synced ? "true" : "false",
    });

    app.atlasLogger.info("github_webhook_accepted", {
      event,
      synced: syncResult.synced,
      projectId: syncResult.projectId ?? null,
      reason: syncResult.reason ?? null,
    });

    return reply.status(202).send({
      accepted: true,
      event,
      at: now,
      ...syncResult,
    });
  });
}

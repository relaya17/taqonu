import type { FastifyInstance } from "fastify";
import {
  listGithubReposForToken,
  verifyGithubToken,
} from "@atlas/integrations-github";
import { scanLocalReposRoot } from "@atlas/integrations-local";
import {
  AtlasError,
  connectGithubRequestSchema,
  connectLocalRequestSchema,
  githubConnectionPublicSchema,
  importGithubReposRequestSchema,
  localConnectionPublicSchema,
  scanLocalRequestSchema,
} from "@atlas/shared";
import {
  discoverGitHubPortfolio,
  discoverLocalPortfolio,
} from "../services/portfolio-discovery.js";
import { osStore } from "../store/os-store.js";
import {
  requireSignedInForWrite,
  requireUser,
} from "../middleware/auth-guards.js";

/**
 * KNOWN LIMITATION (flagged, not fixed here — see task scope): the GitHub
 * token and local repos-root path are stored as a single global record each
 * in `os-store.ts` (`githubConnection` / `localConnection`), not keyed per
 * owner/actor. Adding `requireUser`/`requireSignedInForWrite` below closes
 * the "fully unauthenticated" hole (anyone on the network could previously
 * read/replace/delete the shared token with zero auth), but it does NOT
 * isolate the token between two different signed-in accounts on the same
 * server — any signed-in user can still see/replace/import via the one
 * shared connection. Properly scoping this per-owner requires reshaping the
 * persisted store shape (`githubConnection`/`localConnection` -> a map keyed
 * by ownerId, with a migration for existing single-record installs), which
 * is a larger change than fits this pass; tracked as a follow-up rather than
 * silently left unaddressed.
 */

function publicGithub() {
  const raw = osStore.getGithubConnection();
  if (!raw) {
    return null;
  }
  return githubConnectionPublicSchema.parse({
    kind: "github",
    id: raw.id,
    status: raw.status,
    login: raw.login,
    displayLabel: raw.displayLabel,
    tokenConfigured: Boolean(raw.token),
    scopesHint: raw.scopesHint,
    connectedAt: raw.connectedAt,
    updatedAt: raw.updatedAt,
    lastError: raw.lastError,
  });
}

function publicLocal() {
  const raw = osStore.getLocalConnection();
  if (!raw) {
    return null;
  }
  return localConnectionPublicSchema.parse({
    kind: "local",
    id: raw.id,
    status: raw.status,
    reposRoot: raw.reposRoot,
    displayLabel: raw.displayLabel,
    connectedAt: raw.connectedAt,
    updatedAt: raw.updatedAt,
    lastError: raw.lastError,
    lastScanAt: raw.lastScanAt,
    lastScanRepoCount: raw.lastScanRepoCount,
  });
}

export async function registerConnectionRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/api/v1/connections", async (request) => {
    requireUser(app, request);
    return {
      github: publicGithub(),
      local: publicLocal(),
    };
  });

  app.post("/api/v1/connections/github", async (request, reply) => {
    requireSignedInForWrite(app, request);
    const body = connectGithubRequestSchema.parse(request.body);
    const now = new Date().toISOString();
    try {
      const profile = await verifyGithubToken(body.token);
      const existing = osStore.getGithubConnection();
      osStore.setGithubConnection({
        id: existing?.id ?? crypto.randomUUID(),
        status: "CONNECTED",
        login: profile.login,
        displayLabel: body.displayLabel ?? profile.name ?? profile.login,
        token: body.token,
        scopesHint: "read:user + repo (read-only recommended)",
        connectedAt: existing?.connectedAt ?? now,
        updatedAt: now,
        lastError: null,
      });
      osStore.recordEvent({
        type: "connection.github.connected",
        login: profile.login,
        at: now,
      });
      return reply.status(201).send({ github: publicGithub() });
    } catch (error) {
      throw new AtlasError(
        "INTEGRATION_ERROR",
        error instanceof Error ? error.message : "GitHub connect failed",
        { statusCode: 401 },
      );
    }
  });

  app.delete("/api/v1/connections/github", async (request) => {
    requireSignedInForWrite(app, request);
    osStore.setGithubConnection(null);
    osStore.recordEvent({
      type: "connection.github.disconnected",
      at: new Date().toISOString(),
    });
    return { github: null };
  });

  app.get("/api/v1/connections/github/repos", async (request) => {
    requireUser(app, request);
    const connection = osStore.getGithubConnection();
    if (!connection?.token || connection.status !== "CONNECTED") {
      throw new AtlasError(
        "UNAUTHORIZED",
        "Connect your GitHub account first (Integrations → GitHub)",
        { statusCode: 401 },
      );
    }
    try {
      const repos = await listGithubReposForToken(connection.token);
      return {
        login: connection.login,
        items: repos.map((repo) => ({
          fullName: repo.full_name,
          name: repo.name,
          private: repo.private,
          htmlUrl: repo.html_url,
          defaultBranch: repo.default_branch ?? "main",
          description: repo.description ?? null,
          language: repo.language ?? null,
          pushedAt: repo.pushed_at ?? null,
        })),
      };
    } catch (error) {
      const now = new Date().toISOString();
      osStore.setGithubConnection({
        ...connection,
        status: "ERROR",
        updatedAt: now,
        lastError: error instanceof Error ? error.message : "list failed",
      });
      throw new AtlasError(
        "INTEGRATION_ERROR",
        error instanceof Error ? error.message : "Failed to list repos",
        { statusCode: 502 },
      );
    }
  });

  app.post("/api/v1/connections/github/import", async (request, reply) => {
    requireSignedInForWrite(app, request);
    const body = importGithubReposRequestSchema.parse(request.body ?? {});
    const connection = osStore.getGithubConnection();
    if (!connection?.token || connection.status !== "CONNECTED") {
      throw new AtlasError(
        "UNAUTHORIZED",
        "Connect your GitHub account first",
        { statusCode: 401 },
      );
    }
    const repos = await listGithubReposForToken(connection.token);
    const selected = body.fullNames?.length
      ? repos.filter((repo) => body.fullNames!.includes(repo.full_name))
      : repos;
    if (selected.length === 0) {
      return reply.status(200).send({
        imported: 0,
        created: 0,
        updated: 0,
        projects: [],
      });
    }
    const result = discoverGitHubPortfolio({
      repositories: selected.map((repo) => ({
        fullName: repo.full_name,
        defaultBranch: repo.default_branch ?? "main",
        private: repo.private,
        htmlUrl: repo.html_url,
      })),
      reconcile: body.reconcile,
    });
    return reply.status(201).send({
      imported: selected.length,
      ...result,
    });
  });

  app.post("/api/v1/connections/local", async (request, reply) => {
    requireSignedInForWrite(app, request);
    const body = connectLocalRequestSchema.parse(request.body);
    const now = new Date().toISOString();
    try {
      // Validate path is readable by scanning (depth 1 ok even if empty)
      scanLocalReposRoot(body.reposRoot, 1);
      const existing = osStore.getLocalConnection();
      osStore.setLocalConnection({
        id: existing?.id ?? crypto.randomUUID(),
        status: "CONNECTED",
        reposRoot: body.reposRoot,
        displayLabel: body.displayLabel ?? body.reposRoot,
        connectedAt: existing?.connectedAt ?? now,
        updatedAt: now,
        lastError: null,
        lastScanAt: existing?.lastScanAt ?? null,
        lastScanRepoCount: existing?.lastScanRepoCount ?? null,
      });
      osStore.recordEvent({
        type: "connection.local.connected",
        reposRoot: body.reposRoot,
        at: now,
      });
      return reply.status(201).send({ local: publicLocal() });
    } catch (error) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        error instanceof Error ? error.message : "Invalid local path",
        { statusCode: 400 },
      );
    }
  });

  app.delete("/api/v1/connections/local", async (request) => {
    requireSignedInForWrite(app, request);
    osStore.setLocalConnection(null);
    osStore.recordEvent({
      type: "connection.local.disconnected",
      at: new Date().toISOString(),
    });
    return { local: null };
  });

  app.post("/api/v1/connections/local/scan", async (request, reply) => {
    requireSignedInForWrite(app, request);
    const body = scanLocalRequestSchema.parse(request.body ?? {});
    const connection = osStore.getLocalConnection();
    if (!connection?.reposRoot || connection.status === "DISCONNECTED") {
      throw new AtlasError(
        "UNAUTHORIZED",
        "Connect your computer folder first (Integrations → Local)",
        { statusCode: 401 },
      );
    }
    const now = new Date().toISOString();
    try {
      const discovered = discoverLocalPortfolio({
        reposRoot: connection.reposRoot,
        maxDepth: body.maxDepth,
        reconcile: body.reconcile,
        linkLocalRoots: true,
      });
      osStore.setLocalConnection({
        ...connection,
        status: "CONNECTED",
        updatedAt: now,
        lastError: null,
        lastScanAt: now,
        lastScanRepoCount: discovered.scanned,
      });

      return reply.status(discovered.scanned === 0 ? 200 : 201).send({
        scanned: discovered.scanned,
        repos: discovered.repos,
        created: discovered.created,
        updated: discovered.updated,
        linked: discovered.linked,
        projects: discovered.projects,
      });
    } catch (error) {
      osStore.setLocalConnection({
        ...connection,
        status: "ERROR",
        updatedAt: now,
        lastError: error instanceof Error ? error.message : "scan failed",
      });
      throw new AtlasError(
        "INTEGRATION_ERROR",
        error instanceof Error ? error.message : "Local scan failed",
        { statusCode: 500 },
      );
    }
  });
}

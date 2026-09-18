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
import { authorizeEntityAction } from "@atlas/agent-core";
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
 * GitHub PAT and local folder connections are keyed by the signed-in user's
 * id. User A cannot read, replace, or use User B's credentials. Metadata
 * endpoints never return the raw token (`tokenConfigured` only).
 */

function publicGithub(ownerId: string) {
  const raw = osStore.getGithubConnection(ownerId);
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

function publicLocal(ownerId: string) {
  const raw = osStore.getLocalConnection(ownerId);
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
    const user = await requireUser(app, request);
    return {
      github: publicGithub(user.id),
      local: publicLocal(user.id),
    };
  });

  app.post("/api/v1/connections/github", async (request, reply) => {
    const user = await requireSignedInForWrite(app, request);

    // Entity-policy gate: connecting GitHub is CONFIGURATION.CREATE.
    const entityDecision = authorizeEntityAction("CONFIGURATION", "CREATE", {
      mode: "WRITE",
      writeGateOpen: true,
      approved: true,
    });
    if (entityDecision.decision !== "ALLOWED") {
      const reason =
        entityDecision.decision === "DENIED"
          ? entityDecision.reason
          : "CONFIGURATION.CREATE requires explicit approval";
      throw new AtlasError("FORBIDDEN", reason, { statusCode: 403 });
    }

    const body = connectGithubRequestSchema.parse(request.body);
    const now = new Date().toISOString();
    try {
      const profile = await verifyGithubToken(body.token);
      const existing = osStore.getGithubConnection(user.id);
      osStore.setGithubConnection(user.id, {
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
      return reply.status(201).send({ github: publicGithub(user.id) });
    } catch (error) {
      throw new AtlasError(
        "INTEGRATION_ERROR",
        error instanceof Error ? error.message : "GitHub connect failed",
        { statusCode: 401 },
      );
    }
  });

  app.delete("/api/v1/connections/github", async (request) => {
    const user = await requireSignedInForWrite(app, request);

    // Entity-policy gate: disconnecting GitHub is CONFIGURATION.DELETE.
    const entityDecision = authorizeEntityAction("CONFIGURATION", "DELETE", {
      mode: "WRITE",
      writeGateOpen: true,
      approved: true,
    });
    if (entityDecision.decision !== "ALLOWED") {
      const reason =
        entityDecision.decision === "DENIED"
          ? entityDecision.reason
          : "CONFIGURATION.DELETE requires explicit approval";
      throw new AtlasError("FORBIDDEN", reason, { statusCode: 403 });
    }

    osStore.setGithubConnection(user.id, null);
    osStore.recordEvent({
      type: "connection.github.disconnected",
      at: new Date().toISOString(),
    });
    return { github: null };
  });

  app.get("/api/v1/connections/github/repos", async (request) => {
    const user = await requireUser(app, request);
    const connection = osStore.getGithubConnection(user.id);
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
      osStore.setGithubConnection(user.id, {
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
    const user = await requireSignedInForWrite(app, request);

    // Entity-policy gate: importing repos is CONFIGURATION.EXECUTE.
    const entityDecision = authorizeEntityAction("CONFIGURATION", "EXECUTE", {
      mode: "WRITE",
      writeGateOpen: true,
      approved: true,
    });
    if (entityDecision.decision !== "ALLOWED") {
      const reason =
        entityDecision.decision === "DENIED"
          ? entityDecision.reason
          : "CONFIGURATION.EXECUTE requires explicit approval";
      throw new AtlasError("FORBIDDEN", reason, { statusCode: 403 });
    }

    const body = importGithubReposRequestSchema.parse(request.body ?? {});
    const connection = osStore.getGithubConnection(user.id);
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
    }, user.id);
    return reply.status(201).send({
      imported: selected.length,
      ...result,
    });
  });

  app.post("/api/v1/connections/local", async (request, reply) => {
    const user = await requireSignedInForWrite(app, request);

    // Entity-policy gate: connecting local is CONFIGURATION.CREATE.
    const entityDecision = authorizeEntityAction("CONFIGURATION", "CREATE", {
      mode: "WRITE",
      writeGateOpen: true,
      approved: true,
    });
    if (entityDecision.decision !== "ALLOWED") {
      const reason =
        entityDecision.decision === "DENIED"
          ? entityDecision.reason
          : "CONFIGURATION.CREATE requires explicit approval";
      throw new AtlasError("FORBIDDEN", reason, { statusCode: 403 });
    }

    const body = connectLocalRequestSchema.parse(request.body);
    const now = new Date().toISOString();
    try {
      // Validate path is readable by scanning (depth 1 ok even if empty)
      scanLocalReposRoot(body.reposRoot, 1);
      const existing = osStore.getLocalConnection(user.id);
      osStore.setLocalConnection(user.id, {
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
      return reply.status(201).send({ local: publicLocal(user.id) });
    } catch (error) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        error instanceof Error ? error.message : "Invalid local path",
        { statusCode: 400 },
      );
    }
  });

  app.delete("/api/v1/connections/local", async (request) => {
    const user = await requireSignedInForWrite(app, request);

    // Entity-policy gate: disconnecting local is CONFIGURATION.DELETE.
    const entityDecision = authorizeEntityAction("CONFIGURATION", "DELETE", {
      mode: "WRITE",
      writeGateOpen: true,
      approved: true,
    });
    if (entityDecision.decision !== "ALLOWED") {
      const reason =
        entityDecision.decision === "DENIED"
          ? entityDecision.reason
          : "CONFIGURATION.DELETE requires explicit approval";
      throw new AtlasError("FORBIDDEN", reason, { statusCode: 403 });
    }

    osStore.setLocalConnection(user.id, null);
    osStore.recordEvent({
      type: "connection.local.disconnected",
      at: new Date().toISOString(),
    });
    return { local: null };
  });

  app.post("/api/v1/connections/local/scan", async (request, reply) => {
    const user = await requireSignedInForWrite(app, request);

    // Entity-policy gate: scanning local repos is CONFIGURATION.EXECUTE.
    const entityDecision = authorizeEntityAction("CONFIGURATION", "EXECUTE", {
      mode: "WRITE",
      writeGateOpen: true,
      approved: true,
    });
    if (entityDecision.decision !== "ALLOWED") {
      const reason =
        entityDecision.decision === "DENIED"
          ? entityDecision.reason
          : "CONFIGURATION.EXECUTE requires explicit approval";
      throw new AtlasError("FORBIDDEN", reason, { statusCode: 403 });
    }

    const body = scanLocalRequestSchema.parse(request.body ?? {});
    const connection = osStore.getLocalConnection(user.id);
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
      osStore.setLocalConnection(user.id, {
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
      osStore.setLocalConnection(user.id, {
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

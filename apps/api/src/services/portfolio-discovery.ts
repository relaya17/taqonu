import { existsSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import type { Project } from "@atlas/shared";
import {
  AtlasError,
  portfolioDiscoveryStatusSchema,
  projectSchema,
  type PortfolioDiscoveryLinkRequest,
  type PortfolioDiscoveryRefreshRequest,
  type PortfolioDiscoveryRefreshResult,
  type PortfolioDiscoveryStatus,
} from "@atlas/shared";
import {
  githubDiscoverSchema,
  slugFromFullName,
  buildObservationFromSyncPayload,
  listGithubReposForToken,
  listInstallationRepos,
  matchProjectByRepoFullName,
  GitHubAppTokenCache,
  normalizeGithubPrivateKey,
} from "@atlas/integrations-github";
import {
  scanLocalReposRoot,
  type LocalRepoDiscovery,
} from "@atlas/integrations-local";
import { osStore } from "../store/os-store.js";
import {
  ingestGitHubSync,
  runStateReconciliation,
} from "./state-reconciliation.js";

export function discoverGitHubPortfolio(raw: unknown): {
  projects: Project[];
  created: number;
  updated: number;
} {
  const body = githubDiscoverSchema.parse(raw);
  let created = 0;
  let updated = 0;
  const projects: Project[] = [];

  for (const repo of body.repositories) {
    const slug = slugFromFullName(repo.fullName);
    const existing = osStore.getProjectBySlug(slug);
    const now = new Date().toISOString();
    const name = repo.name ?? (repo.fullName.split("/").pop() ?? slug);

    const project = projectSchema.parse({
      id: existing?.id ?? crypto.randomUUID(),
      slug,
      name,
      description: repo.description ?? existing?.description ?? null,
      status: "ACTIVE",
      techStack: repo.techStack ?? existing?.techStack ?? [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });

    if (existing) {
      updated += 1;
    } else {
      created += 1;
    }
    osStore.upsertProject(project);
    projects.push(project);

    const observation = buildObservationFromSyncPayload({
      fullName: repo.fullName,
      defaultBranch: repo.defaultBranch,
      private: repo.private,
      htmlUrl: repo.htmlUrl,
    });
    ingestGitHubSync(project.id, {
      fullName: observation.fullName,
      defaultBranch: observation.defaultBranch,
      private: observation.private,
      htmlUrl: observation.htmlUrl,
      headSha: observation.headSha,
      openPrCount: observation.openPrCount,
      openIssueCount: observation.openIssueCount,
      dependencyManifests: [...observation.dependencyManifests],
      hasCiConfig: observation.hasCiConfig,
      architectureDocPaths: [...observation.architectureDocPaths],
      hasTestDirectory: observation.hasTestDirectory,
      recentCiStatus: observation.recentCiStatus,
      hasDependabot: observation.hasDependabot,
      hasCodeowners: observation.hasCodeowners,
      observedAt: observation.observedAt,
    });

    if (body.reconcile) {
      runStateReconciliation(project.id);
    }
  }

  osStore.recordEvent({
    type: "github.discover.completed",
    created,
    updated,
    count: projects.length,
    installationId: body.installationId ?? null,
    occurredAt: new Date().toISOString(),
  });

  return { projects, created, updated };
}

function projectMatchCandidates() {
  return osStore.listProjects().map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    githubFullName: osStore.github.get(p.id)?.fullName ?? null,
  }));
}

function resolveMatchingProject(repo: LocalRepoDiscovery): Project | undefined {
  const candidates = projectMatchCandidates();
  if (repo.fullName) {
    const match = matchProjectByRepoFullName(repo.fullName, candidates);
    if (match) {
      return osStore.getProject(match.id);
    }
  }
  const folderSlug = slugFromFullName(`local/${repo.folderName}`);
  return osStore.getProjectBySlug(folderSlug);
}

/**
 * Register (or update) projects from a local reposRoot scan and optionally
 * auto-link workspaceRoot to each discovered absolute path.
 * Only scans the configured root — never walks arbitrary disk paths.
 */
export function discoverLocalPortfolio(input: {
  readonly reposRoot: string;
  readonly maxDepth?: number;
  readonly reconcile?: boolean;
  readonly linkLocalRoots?: boolean;
}): {
  scanned: number;
  created: number;
  updated: number;
  linked: number;
  repos: readonly LocalRepoDiscovery[];
  projects: Project[];
} {
  const repos = scanLocalReposRoot(input.reposRoot, input.maxDepth ?? 2);
  let created = 0;
  let updated = 0;
  let linked = 0;
  const projects: Project[] = [];
  const linkRoots = input.linkLocalRoots !== false;

  for (const repo of repos) {
    const existing = resolveMatchingProject(repo);
    const fullName =
      repo.fullName ??
      `local/${repo.folderName}`.toLowerCase().replace(/\s+/g, "-");

    if (existing) {
      updated += 1;
      projects.push(existing);
      if (input.reconcile) {
        const observation = buildObservationFromSyncPayload({
          fullName,
          defaultBranch: "main",
          private: true,
          htmlUrl: repo.remoteUrl?.startsWith("http")
            ? repo.remoteUrl.replace(/\.git$/i, "")
            : null,
        });
        ingestGitHubSync(existing.id, {
          fullName: observation.fullName,
          defaultBranch: observation.defaultBranch,
          private: observation.private,
          htmlUrl: observation.htmlUrl,
          headSha: observation.headSha,
          openPrCount: observation.openPrCount,
          openIssueCount: observation.openIssueCount,
          dependencyManifests: [...observation.dependencyManifests],
          hasCiConfig: observation.hasCiConfig,
          architectureDocPaths: [...observation.architectureDocPaths],
          hasTestDirectory: observation.hasTestDirectory,
          recentCiStatus: observation.recentCiStatus,
          hasDependabot: observation.hasDependabot,
          hasCodeowners: observation.hasCodeowners,
          observedAt: observation.observedAt,
        });
        runStateReconciliation(existing.id);
      }
      if (linkRoots) {
        const current = osStore.getWorkspaceRoot(existing.id);
        if (!current || resolve(current) !== resolve(repo.absolutePath)) {
          osStore.setWorkspaceRoot(existing.id, resolve(repo.absolutePath));
          linked += 1;
        }
      }
      continue;
    }

    const result = discoverGitHubPortfolio({
      repositories: [
        {
          fullName,
          defaultBranch: "main",
          private: true,
          htmlUrl: repo.remoteUrl?.startsWith("http")
            ? repo.remoteUrl.replace(/\.git$/i, "")
            : null,
        },
      ],
      reconcile: input.reconcile ?? true,
    });
    created += result.created;
    updated += result.updated;
    const project = result.projects[0];
    if (project) {
      projects.push(project);
      if (linkRoots) {
        osStore.setWorkspaceRoot(project.id, resolve(repo.absolutePath));
        linked += 1;
      }
    }
  }

  osStore.recordEvent({
    type: "portfolio.local.discover.completed",
    scanned: repos.length,
    created,
    updated,
    linked,
    reposRoot: resolve(input.reposRoot),
    occurredAt: new Date().toISOString(),
  });

  return {
    scanned: repos.length,
    created,
    updated,
    linked,
    repos,
    projects,
  };
}

/** True when candidate is the configured root or a path under it. */
export function isPathInsideConfiguredRoot(
  candidate: string,
  configuredRoot: string,
): boolean {
  const root = resolve(configuredRoot);
  const target = resolve(candidate);
  if (target === root) return true;
  const rel = relative(root, target);
  return Boolean(rel) && !rel.startsWith("..") && !isAbsolute(rel);
}

export function buildPortfolioDiscoveryStatus(input?: {
  readonly githubAppConfigured?: boolean;
}): PortfolioDiscoveryStatus {
  osStore.ensureLoaded();
  const now = new Date().toISOString();
  const local = osStore.getLocalConnection();
  const github = osStore.getGithubConnection();
  const installations = osStore.listGithubAppInstallations();
  const localConnected =
    Boolean(local?.reposRoot) && local?.status !== "DISCONNECTED";

  let localCandidates: PortfolioDiscoveryStatus["localCandidates"] = [];
  const pathHints: string[] = [];

  if (localConnected && local?.reposRoot) {
    pathHints.push(local.reposRoot);
    try {
      const scanned = scanLocalReposRoot(local.reposRoot, 2);
      localCandidates = scanned.map((repo) => {
        const match = resolveMatchingProject(repo);
        const linkedRoot = match
          ? osStore.getWorkspaceRoot(match.id) ?? null
          : null;
        const alreadyLinked = Boolean(
          linkedRoot && resolve(linkedRoot) === resolve(repo.absolutePath),
        );
        return {
          folderName: repo.folderName,
          absolutePath: repo.absolutePath,
          fullName: repo.fullName,
          remoteUrl: repo.remoteUrl,
          matchedProjectId: match?.id ?? null,
          matchedSlug: match?.slug ?? null,
          alreadyLinked,
          registered: Boolean(match),
        };
      });
    } catch {
      // unreadable root — status still returns without candidates
    }
  }

  const projects = osStore.listProjects().map((project) => {
    const workspaceRoot = osStore.getWorkspaceRoot(project.id) ?? null;
    const githubFullName = osStore.github.get(project.id)?.fullName ?? null;
    let linkStatus: "LINKED" | "UNLINKED" | "MISSING_ON_DISK" = "UNLINKED";
    let notes: string | undefined;
    if (workspaceRoot) {
      if (existsSync(resolve(workspaceRoot))) {
        linkStatus = "LINKED";
      } else {
        linkStatus = "MISSING_ON_DISK";
        notes = "workspaceRoot set but path missing on disk";
      }
    } else {
      notes = "No workspaceRoot — link a local folder to enable audits";
    }
    return {
      projectId: project.id,
      slug: project.slug,
      name: project.name,
      githubFullName,
      workspaceRoot,
      linkStatus,
      ...(notes ? { notes } : {}),
    };
  });

  const unlinkedProjects = projects.filter((p) => p.linkStatus !== "LINKED");
  const linkedCount = projects.filter((p) => p.linkStatus === "LINKED").length;
  const missingOnDiskCount = projects.filter(
    (p) => p.linkStatus === "MISSING_ON_DISK",
  ).length;
  const unregisteredLocalCount = localCandidates.filter(
    (c) => !c.registered,
  ).length;

  const hasAnySource =
    localConnected ||
    (github?.status === "CONNECTED" && Boolean(github.token)) ||
    installations.length > 0;

  return portfolioDiscoveryStatusSchema.parse({
    sources: {
      local: {
        connected: localConnected,
        reposRoot: local?.reposRoot ?? null,
        lastScanAt: local?.lastScanAt ?? null,
        lastScanRepoCount: local?.lastScanRepoCount ?? null,
      },
      githubToken: {
        connected: github?.status === "CONNECTED" && Boolean(github.token),
        login: github?.login ?? null,
      },
      githubApp: {
        configured: Boolean(input?.githubAppConfigured),
        installationCount: installations.length,
        installationIds: installations.map((i) => i.installationId),
      },
    },
    summary: {
      projectCount: projects.length,
      linkedCount,
      unlinkedCount: projects.filter((p) => p.linkStatus === "UNLINKED").length,
      missingOnDiskCount,
      localCandidateCount: localCandidates.length,
      unregisteredLocalCount,
    },
    projects,
    unlinkedProjects,
    localCandidates,
    pathHints,
    asOf: now,
    epistemicState: hasAnySource || projects.length > 0 ? "INFERRED" : "UNKNOWN",
    note:
      "Discovery stays inside the configured local reposRoot and GitHub App/PAT permissions — Atlas never scrapes arbitrary disk paths.",
  });
}

export async function refreshPortfolioDiscovery(input: {
  readonly body?: PortfolioDiscoveryRefreshRequest;
  readonly githubAppId?: string | undefined;
  readonly githubPrivateKey?: string | undefined;
}): Promise<PortfolioDiscoveryRefreshResult> {
  osStore.ensureLoaded();
  const body = input.body ?? {
    reconcile: true,
    maxDepth: 2,
    linkLocalRoots: true,
  };
  const want = new Set(
    body.sources ?? (["local", "github_token", "github_app"] as const),
  );

  let localResult: PortfolioDiscoveryRefreshResult["local"] = null;
  let githubTokenResult: PortfolioDiscoveryRefreshResult["githubToken"] = null;
  let githubAppResult: PortfolioDiscoveryRefreshResult["githubApp"] = null;

  if (want.has("local")) {
    const connection = osStore.getLocalConnection();
    if (connection?.reposRoot && connection.status !== "DISCONNECTED") {
      const now = new Date().toISOString();
      try {
        const discovered = discoverLocalPortfolio({
          reposRoot: connection.reposRoot,
          maxDepth: body.maxDepth,
          reconcile: body.reconcile,
          linkLocalRoots: body.linkLocalRoots,
        });
        osStore.setLocalConnection({
          ...connection,
          status: "CONNECTED",
          updatedAt: now,
          lastError: null,
          lastScanAt: now,
          lastScanRepoCount: discovered.scanned,
        });
        localResult = {
          scanned: discovered.scanned,
          created: discovered.created,
          updated: discovered.updated,
          linked: discovered.linked,
        };
      } catch (error) {
        osStore.setLocalConnection({
          ...connection,
          status: "ERROR",
          updatedAt: now,
          lastError: error instanceof Error ? error.message : "scan failed",
        });
        throw new AtlasError(
          "INTEGRATION_ERROR",
          error instanceof Error ? error.message : "Local discovery failed",
          { statusCode: 500 },
        );
      }
    }
  }

  if (want.has("github_token")) {
    const connection = osStore.getGithubConnection();
    if (connection?.token && connection.status === "CONNECTED") {
      const repos = await listGithubReposForToken(connection.token);
      if (repos.length > 0) {
        const result = discoverGitHubPortfolio({
          repositories: repos.map((repo) => ({
            fullName: repo.full_name,
            defaultBranch: repo.default_branch ?? "main",
            private: repo.private,
            htmlUrl: repo.html_url,
            description: repo.description ?? null,
          })),
          reconcile: body.reconcile,
        });
        githubTokenResult = {
          imported: repos.length,
          created: result.created,
          updated: result.updated,
        };
      } else {
        githubTokenResult = { imported: 0, created: 0, updated: 0 };
      }
    }
  }

  if (want.has("github_app")) {
    const appId = input.githubAppId;
    const privateKey = input.githubPrivateKey;
    const installations = osStore.listGithubAppInstallations();
    if (appId && privateKey && installations.length > 0) {
      const cache = new GitHubAppTokenCache({
        appId,
        privateKeyPem: normalizeGithubPrivateKey(privateKey),
      });
      let imported = 0;
      let created = 0;
      let updated = 0;
      const errors: string[] = [];

      for (const installation of installations) {
        if (installation.suspendedAt) {
          errors.push(
            `installation ${installation.installationId} suspended — skipped`,
          );
          continue;
        }
        try {
          const token = await cache.getToken(installation.installationId);
          const repos = await listInstallationRepos({
            installationToken: token,
          });
          if (repos.length === 0) continue;
          const result = discoverGitHubPortfolio({
            installationId: installation.installationId,
            repositories: repos.map((repo) => ({
              fullName: repo.full_name,
              defaultBranch: repo.default_branch ?? "main",
              private: repo.private,
              htmlUrl: repo.html_url,
              description: repo.description ?? null,
            })),
            reconcile: body.reconcile,
          });
          imported += repos.length;
          created += result.created;
          updated += result.updated;
        } catch (error) {
          errors.push(
            `installation ${installation.installationId}: ${
              error instanceof Error ? error.message : "import failed"
            }`,
          );
        }
      }

      githubAppResult = {
        installations: installations.length,
        imported,
        created,
        updated,
        errors,
      };
    } else {
      githubAppResult = null;
    }
  }

  osStore.recordEvent({
    type: "portfolio.discovery.refresh",
    local: localResult,
    githubToken: githubTokenResult,
    githubApp: githubAppResult,
    at: new Date().toISOString(),
  });

  return {
    local: localResult,
    githubToken: githubTokenResult,
    githubApp: githubAppResult,
    status: buildPortfolioDiscoveryStatus({
      githubAppConfigured: Boolean(input.githubAppId && input.githubPrivateKey),
    }),
  };
}

/**
 * Link a project to a local workspace path.
 * When a local reposRoot is configured, the path must sit under that root.
 */
export function linkDiscoveredWorkspaceRoot(
  input: PortfolioDiscoveryLinkRequest,
): {
  projectId: string;
  workspaceRoot: string;
  note: string;
} {
  osStore.ensureLoaded();
  const project = osStore.getProject(input.projectId);
  if (!project) {
    throw new AtlasError("NOT_FOUND", "Project not found");
  }

  const root = resolve(input.workspaceRoot);
  if (!existsSync(root)) {
    throw new AtlasError(
      "VALIDATION_ERROR",
      `workspaceRoot not found: ${root}`,
    );
  }

  const local = osStore.getLocalConnection();
  if (local?.reposRoot && local.status !== "DISCONNECTED") {
    if (!isPathInsideConfiguredRoot(root, local.reposRoot)) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        `workspaceRoot must be inside the configured local reposRoot (${local.reposRoot})`,
        { statusCode: 400 },
      );
    }
  }

  osStore.setWorkspaceRoot(input.projectId, root);
  osStore.recordEvent({
    type: "portfolio.discovery.link",
    projectId: input.projectId,
    workspaceRoot: root,
    at: new Date().toISOString(),
  });

  return {
    projectId: input.projectId,
    workspaceRoot: root,
    note: "Local folder linked — portfolio health and audits can use this root",
  };
}

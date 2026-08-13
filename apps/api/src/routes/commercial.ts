import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  AtlasError,
  buildDefaultStoragePolicy,
  connectExternalRepoSchema,
  importProjectSchema,
  projectSchema,
  usageAnalyticsSchema,
  uuidSchema,
} from "@atlas/shared";
import { z } from "zod";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  fetchGithubRepo,
  fetchGithubRepoTree,
  parseGithubRepoRef,
  slugFromFullName,
  verifyGithubToken,
} from "@atlas/integrations-github";
import { tryPersistProjectToSupabase } from "@atlas/database";
import { osStore } from "../store/os-store.js";
import {
  buildAtlasVerdict,
  buildEvidenceReport,
  collectCaseStudyMetrics,
} from "../services/atlas-verdict.js";
import { appendDomainEvent } from "../services/memory-pipeline.js";
import { analyzeRepoTreeEntries, analyzeRepository } from "@atlas/code-intelligence";
import { discoverGitHubPortfolio } from "../services/portfolio-discovery.js";
import { resolveWorkspaceRoot } from "../services/golden-root.js";
import { assertCloudSlotAvailable } from "../services/plan-quota.js";
import { resolveCloudIdentity } from "../services/cloud-identity.js";
import {
  partnerAuditSpineRequestSchema,
  runPartnerAuditSpine,
} from "../services/partner-audit-spine.js";
import { recordSystemHealthReport } from "./engineering-audit.js";

async function maybeSyncEvidenceCloud(
  app: FastifyInstance,
  project: { id: string; slug: string; name: string; description: string | null; status: string; techStack: string[]; createdAt: string; updatedAt: string },
  sync: boolean | undefined,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<{ cloudSynced: boolean; cloudProjectId: string | null }> {
  if (!sync) {
    return { cloudSynced: false, cloudProjectId: null };
  }
  const identity = await resolveCloudIdentity(app, request);
  if (identity.setCookie) reply.header("Set-Cookie", identity.setCookie);
  await assertCloudSlotAvailable(app.atlasEnv, identity);
  const now = new Date().toISOString();
  const cloud = await tryPersistProjectToSupabase(
    {
      SUPABASE_URL: app.atlasEnv.SUPABASE_URL,
      SUPABASE_ANON_KEY: app.atlasEnv.SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: app.atlasEnv.SUPABASE_SERVICE_ROLE_KEY,
    },
    {
      slug: project.slug,
      name: project.name,
      description: project.description ?? undefined,
      techStack: project.techStack,
      syncToCloud: true,
    },
    identity.ownerId,
    { requireSuccess: true, userAccessToken: identity.userAccessToken },
  );
  if (cloud) {
    osStore.setCloudLink(project.id, {
      cloudProjectId: cloud.id,
      syncedAt: now,
    });
    return { cloudSynced: true, cloudProjectId: cloud.id };
  }
  return { cloudSynced: false, cloudProjectId: null };
}

export async function registerCommercialValidationRoutes(
  app: FastifyInstance,
): Promise<void> {
  /** Product policy: BYO customer cloud (Cloudflare-first); Atlas meters usage. */
  app.get("/api/v1/onboarding/storage-policy", async () => {
    return buildDefaultStoragePolicy();
  });

  app.get("/api/v1/projects/:id/verdict", async (request) => {
    const params = z.object({ id: uuidSchema }).parse(request.params);
    const q = z
      .object({
        workspaceRoot: z.string().max(1000).optional(),
        locale: z.enum(["he", "en", "ar"]).optional(),
      })
      .parse(request.query ?? {});
    if (!osStore.getProject(params.id)) {
      throw new AtlasError("NOT_FOUND", "Project not found");
    }
    const workspaceRoot = resolveWorkspaceRoot({
      queryRoot: q.workspaceRoot ?? null,
      envRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
    });
    return buildAtlasVerdict({
      projectId: params.id,
      workspaceRoot,
      locale: q.locale ?? "en",
    });
  });

  app.get("/api/v1/projects/:id/report", async (request, reply) => {
    const params = z.object({ id: uuidSchema }).parse(request.params);
    const q = z
      .object({
        workspaceRoot: z.string().max(1000).optional(),
        locale: z.enum(["he", "en", "ar"]).optional(),
      })
      .parse(request.query ?? {});
    if (!osStore.getProject(params.id)) {
      throw new AtlasError("NOT_FOUND", "Project not found");
    }
    const workspaceRoot = resolveWorkspaceRoot({
      queryRoot: q.workspaceRoot ?? null,
      envRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
    });
    const report = buildEvidenceReport({
      projectId: params.id,
      workspaceRoot,
      locale: q.locale ?? "en",
    });
    osStore.incrementUsage("reportsGenerated");
    appendDomainEvent({
      type: "evaluation.completed",
      projectId: params.id,
      epistemicState: "OBSERVED",
      payload: { kind: "evidence-report", reportId: report.id },
    });
    return reply.status(200).send(report);
  });

  app.get("/api/v1/case-studies/brokeros-001", async (request) => {
    const q = z
      .object({ workspaceRoot: z.string().max(1000).optional() })
      .parse(request.query ?? {});
    const broker =
      osStore.getProjectBySlug("brokeros") ??
      osStore.listProjects().find((p) => p.slug === "brokeros");
    if (!broker) {
      throw new AtlasError("NOT_FOUND", "BrokerOS project missing from store");
    }
    const workspaceRoot = resolveWorkspaceRoot({
      queryRoot: q.workspaceRoot ?? null,
      envRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
    });
    const metrics = collectCaseStudyMetrics({
      projectId: broker.id,
      workspaceRoot,
    });
    return {
      ...metrics,
      note: "Lab case study only — product accepts any imported repo.",
      narrative: [
        "Atlas Proof Case #001 — BrokerOS (internal lab → public case study).",
        `Release verdict: ${metrics.verdictStatus} · readiness ${metrics.productionReadiness}/100.`,
        `Evidence coverage ${Math.round((metrics.evidenceCoverage ?? 0) * 100)}%.`,
        metrics.benchmarkPassRate != null
          ? `Benchmark pass rate ${Math.round(metrics.benchmarkPassRate * 100)}% · unauthorized writes ${metrics.unauthorizedWrites}.`
          : "Run POST /api/v1/benchmarks/run for suite metrics.",
      ].join(" "),
    };
  });

  /** Legacy Design Partner path — local workspace only. */
  app.post("/api/v1/onboarding/connect-repo", async (request, reply) => {
    const body = connectExternalRepoSchema.parse(request.body);
    const imported = await importLocal(
      app,
      {
        name: body.name,
        slug: body.slug,
        workspaceRoot: body.workspaceRoot,
        ...(body.description ? { description: body.description } : {}),
        ...(body.syncEvidenceToCloud != null
          ? { syncEvidenceToCloud: body.syncEvidenceToCloud }
          : {}),
      },
      request,
      reply,
    );
    return reply.status(201).send(imported);
  });

  /**
   * Unified BYO import: local | github | remote URL.
   * Does not upload full source to Atlas cloud.
   */
  app.post("/api/v1/onboarding/import", async (request, reply) => {
    const body = importProjectSchema.parse(request.body);

    if (body.source === "local") {
      return reply.status(201).send(
        await importLocal(
          app,
          {
            name: body.name,
            slug: body.slug,
            workspaceRoot: body.workspaceRoot,
            ...(body.description ? { description: body.description } : {}),
            ...(body.syncEvidenceToCloud != null
              ? { syncEvidenceToCloud: body.syncEvidenceToCloud }
              : {}),
          },
          request,
          reply,
        ),
      );
    }

    if (body.source === "github") {
      const connection = osStore.getGithubConnection();
      const token =
        body.token?.trim() ||
        (connection?.token && connection.status === "CONNECTED"
          ? connection.token
          : null);
      let owner: string;
      let repoName: string;
      try {
        ({ owner, repo: repoName } = parseGithubRepoRef(body.repo));
      } catch (error) {
        throw new AtlasError(
          "VALIDATION_ERROR",
          error instanceof Error ? error.message : "Invalid repo ref",
        );
      }

      // Persist one-shot PAT when provided so later imports on this instance work.
      if (body.token?.trim()) {
        try {
          const profile = await verifyGithubToken(body.token.trim());
          const existing = osStore.getGithubConnection();
          const now = new Date().toISOString();
          osStore.setGithubConnection({
            id: existing?.id ?? crypto.randomUUID(),
            status: "CONNECTED",
            login: profile.login,
            displayLabel: profile.name ?? profile.login,
            token: body.token.trim(),
            scopesHint: "read:user + repo (from Partners import)",
            connectedAt: existing?.connectedAt ?? now,
            updatedAt: now,
            lastError: null,
          });
        } catch {
          // Still attempt the single-repo fetch with the provided token.
        }
      }

      let repo;
      try {
        repo = await fetchGithubRepo(token, owner, repoName);
      } catch (error) {
        throw new AtlasError(
          "UNAUTHORIZED",
          error instanceof Error
            ? error.message
            : "GitHub fetch failed. For private repos paste a PAT here or connect one under Integrations.",
          { statusCode: token ? 401 : 401 },
        );
      }
      const fullName = repo.full_name;
      const defaultBranch = repo.default_branch ?? "main";
      const slug = body.slug ?? slugFromFullName(fullName);
      if (osStore.getProjectBySlug(slug) && !body.slug) {
        // allow update via discover
      }

      // Real repo structure via GitHub's Git Trees API — no clone, no tarball,
      // no local disk. If this fails (empty repo, huge tree, etc.) we still
      // complete the import with metadata only, same as before.
      let analysis: ReturnType<typeof analyzeRepoTreeEntries> | null = null;
      let analysisNote: string | null = null;
      try {
        const tree = await fetchGithubRepoTree(
          token,
          owner,
          repoName,
          defaultBranch,
        );
        analysis = analyzeRepoTreeEntries(fullName, tree.entries);
        if (tree.truncated) {
          analysisNote = "GitHub truncated the tree listing (very large repo) — structure below is partial.";
        }
      } catch (error) {
        analysisNote = error instanceof Error ? error.message : "Tree analysis failed";
      }

      const techStack = [
        ...(repo.language ? [repo.language] : []),
        ...(analysis?.packages.slice(0, 6) ?? []),
      ];

      const result = discoverGitHubPortfolio({
        repositories: [
          {
            fullName,
            defaultBranch,
            private: repo.private,
            htmlUrl: repo.html_url,
            name: body.name ?? repo.name,
            description: repo.description ?? undefined,
            techStack: techStack.length > 0 ? techStack : undefined,
          },
        ],
        reconcile: body.reconcile ?? true,
      });
      const project = result.projects[0];
      if (!project) {
        throw new AtlasError("INTERNAL_ERROR", "GitHub import produced no project");
      }
      osStore.incrementUsage("reposConnected");
      osStore.incrementUsage("designPartnerSessions");
      const cloud = await maybeSyncEvidenceCloud(
        app,
        project,
        body.syncEvidenceToCloud,
        request,
        reply,
      );
      const verdict = buildAtlasVerdict({
        projectId: project.id,
        workspaceRoot: null,
      });
      return reply.status(201).send({
        source: "github",
        project,
        remote: {
          fullName,
          htmlUrl: repo.html_url,
          defaultBranch,
          private: repo.private,
        },
        analysis: analysis
          ? {
              fileCount: analysis.fileCount,
              apps: analysis.apps,
              packages: analysis.packages,
              graphHint: analysis.graphHint,
            }
          : null,
        analysisNote,
        workspaceRoot: null,
        verdict,
        ...cloud,
        storageNote:
          "Repo structure read directly from GitHub's API (file tree only, no file contents fetched or stored). Full source remains on GitHub.",
        next: [
          "GET /api/v1/projects/:id/verdict",
          "GET /api/v1/projects/:id/report",
          "Optional: clone locally and pass workspaceRoot for file-content-level code intel",
        ],
        note: "Imported from GitHub — validate findings with the champion.",
      });
    }

    // remote — any git host URL, metadata only
    const rootUrl = body.repoUrl.replace(/\.git$/i, "");
    if (osStore.getProjectBySlug(body.slug)) {
      throw new AtlasError("CONFLICT", `Slug already exists: ${body.slug}`);
    }
    const now = new Date().toISOString();
    const project = projectSchema.parse({
      id: crypto.randomUUID(),
      slug: body.slug,
      name: body.name,
      description:
        body.description ??
        `Remote repo linked · code stays at ${rootUrl}`,
      status: "ACTIVE",
      techStack: [],
      createdAt: now,
      updatedAt: now,
    });
    osStore.upsertProject(project);
    osStore.incrementUsage("reposConnected");
    osStore.incrementUsage("designPartnerSessions");
    appendDomainEvent({
      type: "observation.recorded",
      projectId: project.id,
      epistemicState: "OBSERVED",
      payload: {
        kind: "onboarding.import-remote",
        repoUrl: rootUrl,
        note: "Metadata link only — no source uploaded to Atlas",
      },
    });
    const cloud = await maybeSyncEvidenceCloud(
      app,
      project,
      body.syncEvidenceToCloud,
      request,
      reply,
    );
    const verdict = buildAtlasVerdict({
      projectId: project.id,
      workspaceRoot: null,
    });
    return reply.status(201).send({
      source: "remote",
      project,
      remote: { htmlUrl: rootUrl },
      analysis: null,
      workspaceRoot: null,
      verdict,
      ...cloud,
      storageNote:
        "Remote link recorded. Customer pays the git host; Atlas keeps evidence graph only.",
      next: [
        "Clone locally for code analysis, or connect GitHub for richer sync",
        "GET /api/v1/projects/:id/verdict",
      ],
      note: "Remote repo linked — deepen with local path or GitHub when ready.",
    });
  });

  app.get("/api/v1/analytics/usage", async () => {
    const u = osStore.getUsageSnapshot();
    const patches = osStore.listPatches();
    return usageAnalyticsSchema.parse({
      projectsConnected: osStore.listProjects().length,
      certificatesIssued:
        (u.certificatesIssued ?? 0) ||
        osStore.listReadinessCertificates().length,
      verdictsRequested: u.verdictsRequested ?? 0,
      loopRuns: osStore.listLoopRuns().length,
      patchesProposed: patches.length,
      patchesApplied: patches.filter((p) => p.status === "APPLIED").length,
      benchmarkSuites: osStore.listEvalSuites().length,
      evidenceRecords: osStore.countEvidenceRecords(),
      designPartnerSessions: u.designPartnerSessions ?? 0,
      reportsGenerated: u.reportsGenerated ?? 0,
      updatedAt: new Date().toISOString(),
    });
  });

  /**
   * Design Partner audit spine — one-click: audit-engine → Verdict + Health + Readiness
   * deep-link targets + shareable checklist (markdown/JSON). No email automation.
   */
  app.post("/api/v1/partners/audit-spine", async (request, reply) => {
    osStore.ensureLoaded();
    const body = partnerAuditSpineRequestSchema.parse(request.body ?? {});
    const project = osStore.getProject(body.projectId);
    if (!project) {
      throw new AtlasError("NOT_FOUND", "Project not found");
    }
    try {
      const result = runPartnerAuditSpine({
        projectId: body.projectId,
        ...(body.intent !== undefined ? { intent: body.intent } : {}),
        includeConstitution: body.includeConstitution,
        issueCertificate: body.issueCertificate,
        envGoldenRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT,
        recordHealthReport: recordSystemHealthReport,
      });
      return reply.status(201).send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Audit spine failed";
      if (message === "Project not found") {
        throw new AtlasError("NOT_FOUND", message);
      }
      throw new AtlasError("INTERNAL_ERROR", message);
    }
  });
}

async function importLocal(
  app: FastifyInstance,
  body: {
    name: string;
    slug: string;
    workspaceRoot: string;
    description?: string;
    syncEvidenceToCloud?: boolean;
  },
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const root = resolve(body.workspaceRoot);
  if (!existsSync(root)) {
    throw new AtlasError(
      "VALIDATION_ERROR",
      `workspaceRoot not found on the API host: ${root}. Local import only works when the API runs on the same machine as that folder (pnpm dev). On Vercel use Partners → GitHub instead.`,
    );
  }
  if (osStore.getProjectBySlug(body.slug)) {
    throw new AtlasError("CONFLICT", `Slug already exists: ${body.slug}`);
  }
  const now = new Date().toISOString();
  const analysis = analyzeRepository(root);
  const project = projectSchema.parse({
    id: crypto.randomUUID(),
    slug: body.slug,
    name: body.name,
    description:
      body.description ??
      `Local repo onboarded · ${analysis.fileCount} files observed (code stays on disk)`,
    status: "ACTIVE",
    techStack: analysis.packages.slice(0, 8),
    createdAt: now,
    updatedAt: now,
  });
  osStore.upsertProject(project);
  osStore.setWorkspaceRoot(project.id, root);
  osStore.incrementUsage("reposConnected");
  osStore.incrementUsage("designPartnerSessions");
  appendDomainEvent({
    type: "observation.recorded",
    projectId: project.id,
    epistemicState: "OBSERVED",
    payload: {
      kind: "onboarding.connect-repo",
      workspaceRoot: root,
      fileCount: analysis.fileCount,
    },
  });
  const cloud = await maybeSyncEvidenceCloud(
    app,
    project,
    body.syncEvidenceToCloud,
    request,
    reply,
  );
  const verdict = buildAtlasVerdict({
    projectId: project.id,
    workspaceRoot: root,
  });
  return {
    source: "local" as const,
    project,
    workspaceRoot: root,
    analysis: {
      fileCount: analysis.fileCount,
      apps: analysis.apps,
      packages: analysis.packages,
      graphHint: analysis.graphHint,
    },
    verdict,
    ...cloud,
    storageNote:
      "Analyzed on your machine. Atlas did not upload the source tree.",
    next: [
      "GET /api/v1/projects/:id/verdict",
      "GET /api/v1/projects/:id/report",
      "POST /api/v1/readiness/certificate",
    ],
    note: "Baseline ready — validate findings with the champion.",
  };
}

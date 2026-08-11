import type { FastifyInstance } from "fastify";
import {
  AtlasError,
  PLAN_CLOUD_LIMITS,
  connectExternalRepoSchema,
  importProjectSchema,
  projectSchema,
  storagePolicySchema,
  usageAnalyticsSchema,
  uuidSchema,
} from "@atlas/shared";
import { z } from "zod";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  fetchGithubRepo,
  parseGithubRepoRef,
  slugFromFullName,
} from "@atlas/integrations-github";
import { tryPersistProjectToSupabase } from "@atlas/database";
import { osStore } from "../store/os-store.js";
import {
  buildAtlasVerdict,
  buildEvidenceReport,
  collectCaseStudyMetrics,
} from "../services/atlas-verdict.js";
import { appendDomainEvent } from "../services/memory-pipeline.js";
import { analyzeRepository } from "@atlas/code-intelligence";
import { discoverGitHubPortfolio } from "../services/portfolio-discovery.js";
import { resolveWorkspaceRoot } from "../services/golden-root.js";
import {
  assertCloudSlotAvailable,
  resolveOwnerId,
} from "../services/plan-quota.js";

async function maybeSyncEvidenceCloud(
  app: FastifyInstance,
  project: { id: string; slug: string; name: string; description: string | null; status: string; techStack: string[]; createdAt: string; updatedAt: string },
  sync: boolean | undefined,
): Promise<{ cloudSynced: boolean; cloudProjectId: string | null }> {
  if (!sync) {
    return { cloudSynced: false, cloudProjectId: null };
  }
  await assertCloudSlotAvailable(app.atlasEnv);
  const ownerId = resolveOwnerId(app.atlasEnv);
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
    ownerId,
    { requireSuccess: true },
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
  /** Product policy: BYO source, Atlas stores evidence graph (freemium cloud slots). */
  app.get("/api/v1/onboarding/storage-policy", async () => {
    return storagePolicySchema.parse({
      model: "BYO_SOURCE_ATLAS_EVIDENCE",
      atlasStores: [
        "Evidence Graph (claims, evidence refs, conflicts)",
        "Release Verdict + Readiness Certificate",
        "Audit / approvals / governance events",
        "Optional cloud project metadata (freemium slots)",
      ],
      atlasDoesNotStore: [
        "Full source trees / git blobs",
        "Customer CI logs wholesale",
        "Secrets / credentials from the repo",
      ],
      freeCloudProjectSlots: PLAN_CLOUD_LIMITS.free,
      customerPaysProvidersFor: [
        "GitHub / GitLab / Bitbucket hosting",
        "Cloud compute & databases",
        "CI minutes & monitoring",
      ],
      plainLanguage:
        "Import any repo from your machine, GitHub, or another remote. Atlas keeps the evidence graph; your code stays with you or your git host. Free tier includes limited Atlas cloud slots for evidence metadata — beyond that, upgrade Atlas usage; git/cloud bills stay with the other providers.",
    });
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
    const imported = await importLocal(app, {
      name: body.name,
      slug: body.slug,
      workspaceRoot: body.workspaceRoot,
      ...(body.description ? { description: body.description } : {}),
      ...(body.syncEvidenceToCloud != null
        ? { syncEvidenceToCloud: body.syncEvidenceToCloud }
        : {}),
    });
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
        await importLocal(app, {
          name: body.name,
          slug: body.slug,
          workspaceRoot: body.workspaceRoot,
          ...(body.description ? { description: body.description } : {}),
          ...(body.syncEvidenceToCloud != null
            ? { syncEvidenceToCloud: body.syncEvidenceToCloud }
            : {}),
        }),
      );
    }

    if (body.source === "github") {
      const connection = osStore.getGithubConnection();
      if (!connection?.token || connection.status !== "CONNECTED") {
        throw new AtlasError(
          "UNAUTHORIZED",
          "Connect GitHub first (Integrations → GitHub PAT), then import. Code stays on GitHub — Atlas only stores evidence.",
          { statusCode: 401 },
        );
      }
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
      const repo = await fetchGithubRepo(connection.token, owner, repoName);
      const fullName = repo.full_name;
      const slug = body.slug ?? slugFromFullName(fullName);
      if (osStore.getProjectBySlug(slug) && !body.slug) {
        // allow update via discover
      }
      const result = discoverGitHubPortfolio({
        repositories: [
          {
            fullName,
            defaultBranch: repo.default_branch ?? "main",
            private: repo.private,
            htmlUrl: repo.html_url,
            name: body.name ?? repo.name,
            description: repo.description ?? undefined,
            techStack: repo.language ? [repo.language] : undefined,
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
          defaultBranch: repo.default_branch ?? "main",
          private: repo.private,
        },
        analysis: null,
        workspaceRoot: null,
        verdict,
        ...cloud,
        storageNote:
          "Source code remains on GitHub. Atlas stored evidence/observations only.",
        next: [
          "GET /api/v1/projects/:id/verdict",
          "GET /api/v1/projects/:id/report",
          "Optional: clone locally and pass workspaceRoot for deeper code intel",
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
) {
  const root = resolve(body.workspaceRoot);
  if (!existsSync(root)) {
    throw new AtlasError(
      "VALIDATION_ERROR",
      `workspaceRoot not found: ${root}`,
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

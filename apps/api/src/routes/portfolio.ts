import type { FastifyInstance } from "fastify";
import {
  paginatedResponseSchema,
  portfolioDiscoveryLinkRequestSchema,
  portfolioDiscoveryRefreshRequestSchema,
  portfolioHealthReportSchema,
  portfolioOverviewSchema,
  portfolioPatternSchema,
  type PortfolioHealthProjectItem,
} from "@atlas/shared";
import { z } from "zod";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { runContinuousSystemAudit } from "@atlas/code-intelligence";
import { loadTruthCounters } from "@atlas/observer";
import { osStore } from "../store/os-store.js";
import { loadArchitectureContract } from "../services/architecture-contract-store.js";
import { defaultGoldenRoot } from "../services/golden-root.js";
import {
  PORTFOLIO_HEALTH_META_KEY,
  rollupPortfolioHealth,
  skippedPortfolioItem,
  summarizeSystemHealthReport,
  type PortfolioIssueSeed,
} from "../services/portfolio-health.js";
import {
  buildPortfolioDiscoveryStatus,
  linkDiscoveredWorkspaceRoot,
  refreshPortfolioDiscovery,
} from "../services/portfolio-discovery.js";
import { requireSignedInForWrite } from "../middleware/auth-guards.js";

const portfolioPatternsPageSchema = paginatedResponseSchema(
  portfolioPatternSchema,
).extend({
  epistemicState: z.enum(["INFERRED", "UNKNOWN"]),
});

function loadPersistedPortfolioHealth() {
  osStore.ensureLoaded();
  const raw = osStore.getMeta(PORTFOLIO_HEALTH_META_KEY);
  if (!raw) return null;
  try {
    return portfolioHealthReportSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

function persistPortfolioHealth(
  report: ReturnType<typeof portfolioHealthReportSchema.parse>,
): void {
  osStore.setMeta(PORTFOLIO_HEALTH_META_KEY, JSON.stringify(report));
}

export async function registerPortfolioRoutes(app: FastifyInstance): Promise<void> {
  /** Portfolio discovery status: sources, unlinked projects, local candidates. */
  app.get("/api/v1/portfolio/discovery", async () => {
    return buildPortfolioDiscoveryStatus({
      githubAppConfigured: Boolean(
        app.atlasEnv.GITHUB_APP_ID && app.atlasEnv.GITHUB_PRIVATE_KEY,
      ),
    });
  });

  /**
   * Refresh discovery from connected local root + GitHub PAT + App installations.
   * Stays within configured roots / GitHub permissions.
   */
  app.post("/api/v1/portfolio/discovery/refresh", async (request, reply) => {
    const body = portfolioDiscoveryRefreshRequestSchema.parse(request.body ?? {});
    const result = await refreshPortfolioDiscovery({
      body,
      githubAppId: app.atlasEnv.GITHUB_APP_ID,
      githubPrivateKey: app.atlasEnv.GITHUB_PRIVATE_KEY,
    });
    app.atlasLogger.info("portfolio_discovery_refresh", {
      localScanned: result.local?.scanned ?? 0,
      localLinked: result.local?.linked ?? 0,
      githubImported: result.githubToken?.imported ?? 0,
      appImported: result.githubApp?.imported ?? 0,
      appInstallations: result.githubApp?.installations ?? 0,
      appErrors: result.githubApp?.errors.length ?? 0,
      unlinked: result.status.summary.unlinkedCount,
    });
    return reply.status(200).send(result);
  });

  /** Link a discovered local path to a registered project (under configured root). */
  app.post("/api/v1/portfolio/discovery/link", async (request, reply) => {
    requireSignedInForWrite(app, request);
    const body = portfolioDiscoveryLinkRequestSchema.parse(request.body);
    const result = linkDiscoveredWorkspaceRoot(body);
    return reply.status(200).send(result);
  });

  app.get("/api/v1/portfolio/overview", async () => {
    osStore.ensureLoaded();
    const now = new Date().toISOString();
    const projects = osStore.listProjects();

    return portfolioOverviewSchema.parse({
      ownerId: "00000000-0000-4000-8000-000000000001",
      projectCount: projects.length,
      projects: projects.map((project) => {
        const snapshot = osStore.getSnapshot(project.id);
        const risks = snapshot?.slices.find((s) => s.key === "RISKS");
        return {
          id: project.id,
          slug: project.slug,
          name: project.name,
          stateEpistemic: snapshot?.overallEpistemicState ?? null,
          openRiskCount:
            risks && risks.epistemicState !== "UNKNOWN"
              ? risks.summary.split(" · ").filter(Boolean).length
              : 0,
          lastReconciledAt: snapshot?.reconciledAt ?? null,
        };
      }),
      topPatterns: [],
      asOf: now,
      epistemicState: projects.length === 0 ? "UNKNOWN" : "INFERRED",
    });
  });

  /** Last persisted cross-portfolio health snapshot (if any). */
  app.get("/api/v1/portfolio/health", async (_request, reply) => {
    const snap = loadPersistedPortfolioHealth();
    if (!snap) {
      return reply.status(200).send({
        projectCount: 0,
        audited: 0,
        skipped: 0,
        averageScore: null,
        criticalTotal: 0,
        aggregate: {
          averageScore: null,
          worstOfScore: null,
          criticalTotal: 0,
          highTotal: 0,
          constitutionWorst: null,
          constitutionAverage: null,
          openBlockers: 0,
          worstDimensions: [],
          sharedPatterns: [],
          portfolioVerdict: "UNKNOWN",
          verdictSpread: {
            READY: 0,
            CONDITIONAL: 0,
            BLOCKED: 0,
            UNKNOWN: 0,
          },
          constitutionPassRate: null,
          missingWorkspaceRoot: 0,
        },
        items: [],
        epistemicState: "UNKNOWN",
        asOf: new Date().toISOString(),
        note: "No portfolio health snapshot yet — POST /api/v1/portfolio/health to run",
        persisted: false,
      });
    }
    return reply.status(200).send({ ...snap, persisted: true });
  });

  /**
   * Cross-project health: prefer per-project workspaceRoot (explicit permission),
   * else golden root only for the golden slug. Rolls up System Health /
   * Constitution / Verdict-hint signals with worst-of + shared patterns.
   */
  app.post("/api/v1/portfolio/health", async (_request, reply) => {
    osStore.ensureLoaded();
    const projects = osStore.listProjects().slice(0, 12);
    const golden =
      app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT || defaultGoldenRoot();
    const goldenSlug = app.atlasEnv.ATLAS_GOLDEN_PROJECT_SLUG ?? "brokeros";

    const items: PortfolioHealthProjectItem[] = [];
    const issueSeeds: PortfolioIssueSeed[] = [];

    for (const project of projects) {
      const stored = osStore.getWorkspaceRoot(project.id);
      const root =
        stored ??
        (project.slug === goldenSlug || project.slug.includes(goldenSlug)
          ? golden
          : null);

      if (!root || !existsSync(resolve(root))) {
        items.push(
          skippedPortfolioItem({
            projectId: project.id,
            slug: project.slug,
            name: project.name,
            workspaceRoot: stored ?? null,
            notes: stored
              ? "workspaceRoot missing on disk"
              : "No explicit workspaceRoot — set PUT /projects/:id/workspace-root",
          }),
        );
        continue;
      }
      try {
        const report = runContinuousSystemAudit({
          workspaceRoot: resolve(root),
          projectId: project.id,
          projectName: project.name,
          contract: loadArchitectureContract(project.id),
          includeConstitution: true,
        });
        const { item, issueSeeds: seeds } = summarizeSystemHealthReport(report, {
          slug: project.slug,
          name: project.name,
          workspaceRoot: root,
        });
        items.push(item);
        issueSeeds.push(...seeds);
      } catch (error) {
        items.push(
          skippedPortfolioItem({
            projectId: project.id,
            slug: project.slug,
            name: project.name,
            workspaceRoot: root,
            notes: error instanceof Error ? error.message : "audit failed",
          }),
        );
      }
    }

    const rolled = rollupPortfolioHealth({
      items,
      issueSeeds,
      projectCount: projects.length,
      asOf: new Date().toISOString(),
      note: "Cross-portfolio rollup: worst-of score, constitution, blockers, shared drift/issue patterns. Audits only on linked folders (or golden lab).",
      persisted: true,
    });

    persistPortfolioHealth(rolled);
    osStore.recordEvent({
      type: "portfolio.health",
      audited: rolled.audited,
      skipped: rolled.skipped,
      worstOf: rolled.aggregate.worstOfScore,
      critical: rolled.criticalTotal,
      verdict: rolled.aggregate.portfolioVerdict,
      sharedPatterns: rolled.aggregate.sharedPatterns.length,
      at: rolled.asOf,
    });

    return reply.status(200).send(rolled);
  });

  /** P2.2 — Design Partner truth counters side-by-side (linked workspaces only). */
  app.get("/api/v1/portfolio/truth-benchmark", async () => {
    const projects = osStore.listProjects();
    const items = [];
    for (const project of projects) {
      const root = osStore.getWorkspaceRoot(project.id);
      if (!root || !existsSync(root)) {
        items.push({
          projectId: project.id,
          name: project.name,
          slug: project.slug,
          linked: false,
          counters: null,
        });
        continue;
      }
      const counters = loadTruthCounters(root);
      items.push({
        projectId: project.id,
        name: project.name,
        slug: project.slug,
        linked: true,
        counters,
      });
    }
    const linked = items.filter((i) => i.linked && i.counters);
    const totals = linked.reduce(
      (acc, i) => {
        const c = i.counters!;
        return {
          analyzed: acc.analyzed + c.analyzed,
          meaningfulRisks: acc.meaningfulRisks + c.meaningfulRisks,
          confirmedRegressions:
            acc.confirmedRegressions + c.confirmedRegressions,
          caughtBeforeProd: acc.caughtBeforeProd + c.caughtBeforeProd,
          cycles: acc.cycles + c.cycles,
        };
      },
      {
        analyzed: 0,
        meaningfulRisks: 0,
        confirmedRegressions: 0,
        caughtBeforeProd: 0,
        cycles: 0,
      },
    );
    return {
      asOf: new Date().toISOString(),
      items,
      totals,
      linkedCount: linked.length,
      note: "Per-workspace Truth counters · no public team ranking · consent required for external publish",
    };
  });

  app.get("/api/v1/portfolio/patterns", async () => {
    const projects = osStore.listProjects();
    const stacks = new Map<string, string[]>();
    for (const project of projects) {
      for (const tech of project.techStack) {
        const list = stacks.get(tech) ?? [];
        list.push(project.id);
        stacks.set(tech, list);
      }
    }

    const items = [...stacks.entries()]
      .filter(([, ids]) => ids.length >= 2)
      .map(([tech, projectIds]) =>
        portfolioPatternSchema.parse({
          id: crypto.randomUUID(),
          kind: "SHARED_ARCHITECTURE",
          title: `Shared technology: ${tech}`,
          summary: `${projectIds.length} projects use ${tech}. Consider extracting a shared package if duplication grows.`,
          projectIds,
          epistemicState: "INFERRED",
          confidence: 0.6,
          detectedAt: new Date().toISOString(),
        }),
      );

    return portfolioPatternsPageSchema.parse({
      items,
      page: 1,
      pageSize: 20,
      total: items.length,
      epistemicState: items.length > 0 ? "INFERRED" : "UNKNOWN",
    });
  });
}

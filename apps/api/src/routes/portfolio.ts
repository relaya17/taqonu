import type { FastifyInstance } from "fastify";
import { portfolioOverviewSchema } from "@atlas/shared";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { runContinuousSystemAudit } from "@atlas/code-intelligence";
import { osStore } from "../store/os-store.js";
import { loadArchitectureContract } from "../services/architecture-contract-store.js";
import { defaultGoldenRoot } from "../services/golden-root.js";

export async function registerPortfolioRoutes(app: FastifyInstance): Promise<void> {
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

  /**
   * Cross-project health: prefer per-project workspaceRoot (explicit permission),
   * else golden root only for the golden slug.
   */
  app.post("/api/v1/portfolio/health", async (_request, reply) => {
    osStore.ensureLoaded();
    const projects = osStore.listProjects().slice(0, 12);
    const golden =
      app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT || defaultGoldenRoot();
    const goldenSlug = app.atlasEnv.ATLAS_GOLDEN_PROJECT_SLUG ?? "brokeros";
    const items: Array<{
      projectId: string;
      slug: string;
      name: string;
      workspaceRoot: string | null;
      overallScore: number | null;
      criticalIssues: number;
      constitutionScore: number | null;
      epistemicState: string;
      notes: string;
    }> = [];

    for (const project of projects) {
      const stored = osStore.getWorkspaceRoot(project.id);
      const root =
        stored ??
        (project.slug === goldenSlug || project.slug.includes(goldenSlug)
          ? golden
          : null);

      if (!root || !existsSync(resolve(root))) {
        items.push({
          projectId: project.id,
          slug: project.slug,
          name: project.name,
          workspaceRoot: stored ?? null,
          overallScore: null,
          criticalIssues: 0,
          constitutionScore: null,
          epistemicState: "UNKNOWN",
          notes: stored
            ? "workspaceRoot missing on disk"
            : "No explicit workspaceRoot — set PUT /projects/:id/workspace-root",
        });
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
        items.push({
          projectId: project.id,
          slug: project.slug,
          name: project.name,
          workspaceRoot: root,
          overallScore: report.overallScore,
          criticalIssues: report.criticalIssues,
          constitutionScore: report.constitution?.overallScore ?? null,
          epistemicState: "OBSERVED",
          notes: `drift ${report.driftFindings.length} · issues ${report.issues.length}`,
        });
      } catch (error) {
        items.push({
          projectId: project.id,
          slug: project.slug,
          name: project.name,
          workspaceRoot: root,
          overallScore: null,
          criticalIssues: 0,
          constitutionScore: null,
          epistemicState: "UNKNOWN",
          notes: error instanceof Error ? error.message : "audit failed",
        });
      }
    }

    const scored = items.filter((i) => i.overallScore != null);
    const avg =
      scored.length === 0
        ? null
        : Math.round(
            scored.reduce((a, b) => a + (b.overallScore ?? 0), 0) /
              scored.length,
          );

    return reply.status(200).send({
      projectCount: projects.length,
      audited: scored.length,
      skipped: items.length - scored.length,
      averageScore: avg,
      criticalTotal: items.reduce((a, b) => a + b.criticalIssues, 0),
      items,
      epistemicState: scored.length > 0 ? "OBSERVED" : "UNKNOWN",
      asOf: new Date().toISOString(),
      note: "Audits only run on explicitly linked folders (or golden lab project)",
    });
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
      .map(([tech, projectIds]) => ({
        id: crypto.randomUUID(),
        kind: "SHARED_ARCHITECTURE" as const,
        title: `Shared technology: ${tech}`,
        summary: `${projectIds.length} projects use ${tech}. Consider extracting a shared package if duplication grows.`,
        projectIds,
        evidenceIds: [],
        graphNodeIds: [],
        epistemicState: "INFERRED" as const,
        confidence: 0.6,
        detectedAt: new Date().toISOString(),
      }));

    return {
      items,
      page: 1,
      pageSize: 20,
      total: items.length,
      epistemicState: items.length > 0 ? "INFERRED" : "UNKNOWN",
    };
  });
}

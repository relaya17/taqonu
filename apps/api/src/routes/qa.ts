import type { FastifyInstance } from "fastify";
import { orchestrateQaAnalyze } from "@atlas/qa-core";
import { createQaRunSchema } from "@atlas/shared";
import { z } from "zod";
import { osStore } from "../store/os-store.js";
import { resolveWorkspaceRoot } from "../services/golden-root.js";

const reports: Array<ReturnType<typeof orchestrateQaAnalyze>> = [];

function loadLearnedKeys(): string[] {
  const raw = osStore.getMeta("qa.learnedPatternKeys");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

function saveLearnedKeys(keys: readonly string[]): void {
  const merged = [...new Set([...loadLearnedKeys(), ...keys])].slice(-200);
  osStore.setMeta("qa.learnedPatternKeys", JSON.stringify(merged));
}

export async function registerQaRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/qa/runs", async () => ({
    items: reports.map((r) => r.run),
    page: 1,
    pageSize: 20,
    total: reports.length,
    learnedPatternKeys: loadLearnedKeys(),
  }));

  app.post("/api/v1/qa/runs", async (request, reply) => {
    osStore.ensureLoaded();
    const body = createQaRunSchema.parse(request.body);
    const q = z
      .object({ workspaceRoot: z.string().max(1000).optional() })
      .parse(
        typeof request.body === "object" && request.body
          ? (request.body as Record<string, unknown>)
          : {},
      );
    const allProjects = osStore.listProjects();

    let resolvedProjectIds: string[] = [];
    if (body.scope === "ENTIRE_PORTFOLIO") {
      resolvedProjectIds = allProjects.map((p) => p.id);
    } else if (body.scope === "SELECTED_PROJECTS") {
      resolvedProjectIds = body.projectIds ?? [];
    } else {
      resolvedProjectIds = body.projectId
        ? [body.projectId]
        : allProjects[0]
          ? [allProjects[0].id]
          : [];
    }

    const golden = resolveWorkspaceRoot({
      queryRoot: q.workspaceRoot ?? null,
      envRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
    });
    const workspaceRoots: Record<string, string> = {};
    if (golden) {
      for (const id of resolvedProjectIds) {
        workspaceRoots[id] = golden;
      }
    }

    const priorKeys = loadLearnedKeys();
    const report = orchestrateQaAnalyze({
      request: body,
      resolvedProjectIds,
      workspaceRoots,
      priorLearnedPatternKeys: priorKeys,
    });
    saveLearnedKeys(report.learnedPatternKeys);
    reports.unshift(report);
    osStore.recordEvent({
      type: "qa.run.completed",
      runId: report.run.id,
      scope: report.run.scope,
      profile: report.run.profile,
      findingCount: report.findings.length,
      learnedKeys: report.learnedPatternKeys.length,
      at: new Date().toISOString(),
    });

    app.atlasLogger.info("qa_run_analyzed", {
      runId: report.run.id,
      scope: report.run.scope,
      profile: report.run.profile,
      findings: report.findings.length,
      patterns: report.portfolioPatterns.length,
      learnedKeys: report.learnedPatternKeys.length,
    });

    return reply.status(201).send(report);
  });
}

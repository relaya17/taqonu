import type { FastifyInstance } from "fastify";
import {
  filterPortfolioPatterns,
  orchestrateQaAnalyze,
  runProcessInternalAudit,
} from "@atlas/qa-core";
import {
  createProcessAuditSchema,
  createQaRunSchema,
  qaPortfolioPatternSchema,
  type QaPortfolioPattern,
  type QaReport,
} from "@atlas/shared";
import { z } from "zod";
import { osStore } from "../store/os-store.js";
import {
  assertProcessAuditQuota,
  recordProcessAuditUsage,
} from "../services/plan-quota.js";
import { resolveWorkspaceRoot } from "../services/golden-root.js";
import {
  buildMemoryContext,
  seedPortfolioPatternMemories,
} from "../services/memory-pipeline.js";
import { atlasMetrics } from "./metrics.js";
import {
  rememberProcessAuditId,
  syncProcessAuditToMemory,
} from "../services/central-opinion.js";
import { requireSignedInForWrite } from "../middleware/auth-guards.js";
import { assertProjectWriteAccess } from "../services/project-access.js";
import { authorizeEntityAction } from "@atlas/agent-core";
import { AtlasError } from "@atlas/shared";

/**
 * ENTITY-LEVEL gate for the 4 mutating routes below, independent of the
 * `requireSignedInForWrite`/`assertProjectWriteAccess` identity gates
 * already applied by each one. Same self-approved signed-in-human-write
 * pattern as `plugins.ts`/`memory.ts`/`projects.ts`: `writeGateOpen`/
 * `approved` hardcoded `true`, both `DENIED`/`APPROVAL_REQUIRED` collapse
 * to 403 `FORBIDDEN`.
 */
function enforceQaEntityAuthz(
  entityType: "CONFIGURATION" | "RECORD",
  action: "UPDATE" | "EXECUTE",
  routeLabel: string,
): void {
  const entityAuthz = authorizeEntityAction(entityType, action, {
    mode: "WRITE",
    writeGateOpen: true,
    approved: true,
  });
  if (entityAuthz.decision !== "ALLOWED") {
    const reason =
      entityAuthz.decision === "DENIED"
        ? entityAuthz.reason
        : `${routeLabel} (${entityType}.${action}) was not ALLOWED.`;
    throw new AtlasError("FORBIDDEN", reason, { statusCode: 403 });
  }
}


const QA_RUNS_META = "qa.runs";
const QA_PATTERNS_META = "qa.portfolioPatterns";
const QA_LEARNED_META = "qa.learnedPatternKeys";
const MAX_STORED_RUNS = 20;
const MAX_STORED_PATTERNS = 100;
const MAX_LEARNED_KEYS = 200;
const QA_MEMORY_BUDGET = 12;

const learnBodySchema = z.object({
  patternKey: z.string().min(1).max(200),
});

const patternsQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  /** When true (default), only patterns seen in ≥2 projects. */
  portfolioOnly: z
    .union([z.literal("true"), z.literal("false"), z.boolean()])
    .optional()
    .transform((v) => {
      if (v === undefined) return true;
      if (typeof v === "boolean") return v;
      return v === "true";
    }),
  minProjects: z.coerce.number().int().min(1).max(100).optional(),
});

type StoredQaReport = QaReport & {
  learnedPatternKeys?: readonly string[];
  emittedPatternKeys?: readonly string[];
  durablePatterns?: readonly QaPortfolioPattern[];
  contextPatterns?: readonly QaPortfolioPattern[];
  patternLessons?: readonly string[];
};

function loadLearnedKeys(): string[] {
  const raw = osStore.getMeta(QA_LEARNED_META);
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
  const merged = [...new Set(keys)].slice(-MAX_LEARNED_KEYS);
  osStore.setMeta(QA_LEARNED_META, JSON.stringify(merged));
}

function loadStoredRuns(): StoredQaReport[] {
  const raw = osStore.getMeta(QA_RUNS_META);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as StoredQaReport[]) : [];
  } catch {
    return [];
  }
}

function saveStoredRun(report: StoredQaReport): void {
  const next = [report, ...loadStoredRuns()].slice(0, MAX_STORED_RUNS);
  osStore.setMeta(QA_RUNS_META, JSON.stringify(next));
}

function loadPortfolioPatterns(): QaPortfolioPattern[] {
  const raw = osStore.getMeta(QA_PATTERNS_META);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        const result = qaPortfolioPatternSchema.safeParse(item);
        return result.success ? result.data : null;
      })
      .filter((x): x is QaPortfolioPattern => x != null);
  } catch {
    return [];
  }
}

function mergePortfolioPatterns(incoming: readonly QaPortfolioPattern[]): void {
  if (incoming.length === 0) return;
  const byKey = new Map(
    loadPortfolioPatterns().map((p) => [p.patternKey, p] as const),
  );
  for (const p of incoming) {
    const prev = byKey.get(p.patternKey);
    if (!prev) {
      byKey.set(p.patternKey, p);
      continue;
    }
    const projectIds = [...new Set([...prev.projectIds, ...p.projectIds])];
    byKey.set(p.patternKey, {
      ...p,
      id: prev.id,
      projectIds,
      findingIds: [...new Set([...prev.findingIds, ...p.findingIds])].slice(
        -100,
      ),
      summary:
        projectIds.length >= 2
          ? `${p.title} — seen in ${projectIds.length} projects (architecture regression pattern). [pattern:${p.patternKey}]`
          : p.summary,
      epistemicState: projectIds.length >= 2 ? "INFERRED" : p.epistemicState,
      createdAt: prev.createdAt,
      updatedAt: p.updatedAt,
    });
  }
  osStore.setMeta(
    QA_PATTERNS_META,
    JSON.stringify([...byKey.values()].slice(-MAX_STORED_PATTERNS)),
  );
}

function resolveProjectWorkspaceRoots(opts: {
  projectIds: readonly string[];
  goldenSlug: string;
  queryRoot: string | null;
  envRoot: string | null;
}): Record<string, string> {
  const golden = resolveWorkspaceRoot({
    queryRoot: opts.queryRoot,
    envRoot: opts.envRoot,
  });
  const workspaceRoots: Record<string, string> = {};
  for (const id of opts.projectIds) {
    const stored = osStore.getWorkspaceRoot(id);
    if (stored) {
      workspaceRoots[id] = stored;
      continue;
    }
    const project = osStore.getProject(id);
    if (
      golden &&
      project &&
      (project.slug === opts.goldenSlug ||
        project.slug.includes(opts.goldenSlug))
    ) {
      workspaceRoots[id] = golden;
    }
  }
  return workspaceRoots;
}

export async function registerQaRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/qa/runs", async () => {
    osStore.ensureLoaded();
    const reports = loadStoredRuns();
    return {
      items: reports.map((r) => r.run),
      page: 1,
      pageSize: MAX_STORED_RUNS,
      total: reports.length,
      learnedPatternKeys: loadLearnedKeys(),
    };
  });

  app.get("/api/v1/qa/patterns", async (request) => {
    osStore.ensureLoaded();
    const q = patternsQuerySchema.parse(request.query ?? {});
    const all = loadPortfolioPatterns();
    const items = filterPortfolioPatterns({
      patterns: all,
      projectId: q.projectId ?? null,
      portfolioOnly: q.portfolioOnly,
      ...(q.minProjects !== undefined ? { minProjects: q.minProjects } : {}),
    });
    const crossProjectCount = all.filter((p) => p.projectIds.length >= 2).length;
    return {
      items,
      total: items.length,
      crossProjectCount,
      storedCount: all.length,
      portfolioOnly: q.portfolioOnly,
      projectId: q.projectId ?? null,
      learnedPatternKeys: loadLearnedKeys(),
    };
  });

  app.post("/api/v1/qa/learn", async (request, reply) => {
    // Auth gate (P0 fix): mutates persisted "learned pattern" state — never
    // usable anonymously (mirrors requireSignedInForWrite convention used
    // for other WRITE routes, see memory.ts / code.ts).
    await requireSignedInForWrite(app, request);
    enforceQaEntityAuthz("CONFIGURATION", "UPDATE", "qa.learn.suppress");
    osStore.ensureLoaded();
    const body = learnBodySchema.parse(request.body);
    const keys = loadLearnedKeys();
    if (!keys.includes(body.patternKey)) {
      keys.push(body.patternKey);
      saveLearnedKeys(keys);
    }
    osStore.recordEvent({
      type: "qa.learn.suppressed",
      patternKey: body.patternKey,
      at: new Date().toISOString(),
    });
    return reply.status(201).send({
      patternKey: body.patternKey,
      learnedPatternKeys: loadLearnedKeys(),
    });
  });

  app.delete("/api/v1/qa/learn", async (request, reply) => {
    // Auth gate (P0 fix): mutates persisted "learned pattern" state — never
    // usable anonymously (mirrors requireSignedInForWrite convention used
    // for other WRITE routes, see memory.ts / code.ts).
    await requireSignedInForWrite(app, request);
    enforceQaEntityAuthz("CONFIGURATION", "UPDATE", "qa.learn.unsuppress");
    osStore.ensureLoaded();
    const body = learnBodySchema.parse(request.body);
    const next = loadLearnedKeys().filter((k) => k !== body.patternKey);
    saveLearnedKeys(next);
    osStore.recordEvent({
      type: "qa.learn.unsuppressed",
      patternKey: body.patternKey,
      at: new Date().toISOString(),
    });
    return reply.send({
      patternKey: body.patternKey,
      learnedPatternKeys: next,
    });
  });

  app.post("/api/v1/qa/runs", async (request, reply) => {
    // Auth gate (P0 fix): runs analysis + persists reports/patterns/memories
    // — never usable anonymously (mirrors requireSignedInForWrite
    // convention used for other WRITE routes, see memory.ts / code.ts).
    const user = await requireSignedInForWrite(app, request);
    enforceQaEntityAuthz("RECORD", "EXECUTE", "qa.runs.create");
    const started = Date.now();
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

    const goldenSlug = app.atlasEnv.ATLAS_GOLDEN_PROJECT_SLUG ?? "brokeros";
    const workspaceRoots = resolveProjectWorkspaceRoots({
      projectIds: resolvedProjectIds,
      goldenSlug,
      queryRoot: q.workspaceRoot ?? null,
      envRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
    });

    const priorKeys = loadLearnedKeys();
    const priorPatterns = loadPortfolioPatterns();
    const report = orchestrateQaAnalyze({
      request: body,
      resolvedProjectIds,
      workspaceRoots,
      priorLearnedPatternKeys: priorKeys,
      priorPortfolioPatterns: priorPatterns,
      patternContextBudget: 8,
    });

    // Persist durable (incl. single-project) so next project can promote to portfolio.
    mergePortfolioPatterns(report.durablePatterns);
    const afterMerge = loadPortfolioPatterns();
    const newlyCrossProject = afterMerge.filter(
      (p) =>
        p.projectIds.length >= 2 &&
        report.durablePatterns.some((d) => d.patternKey === p.patternKey),
    );
    saveStoredRun(report);
    const seededMemories = seedPortfolioPatternMemories(newlyCrossProject);

    const primaryProjectId = resolvedProjectIds[0] ?? null;
    // Tenant boundary (P0 fix): scope memory retrieval to the caller so one
    // tenant's QA run never surfaces another tenant's memories. Admins
    // bypass, same convention as memory.ts.
    const callerOwnerId = user.role === "admin" ? undefined : user.id;
    const memoryContextResult = buildMemoryContext({
      projectId: primaryProjectId,
      query: body.userRequest ?? report.emittedPatternKeys.join(" "),
      budget: QA_MEMORY_BUDGET,
      ...(callerOwnerId !== undefined ? { ownerId: callerOwnerId } : {}),
    });
    const { memories: _memories, ...memoryContext } = memoryContextResult;
    void _memories;

    osStore.recordEvent({
      type: "qa.run.completed",
      runId: report.run.id,
      scope: report.run.scope,
      profile: report.run.profile,
      findingCount: report.findings.length,
      learnedKeys: priorKeys.length,
      regressionRules: report.regressionRulesTriggered.length,
      durablePatterns: report.durablePatterns.length,
      contextPatterns: report.contextPatterns.length,
      seededPortfolioMemories: seededMemories.map((m) => m.id),
      at: new Date().toISOString(),
    });

    atlasMetrics.record("agent_run_duration", Date.now() - started, {
      kind: "qa",
    });
    atlasMetrics.record(
      "web_verification_rate",
      report.findings.length === 0 ? 1 : 0,
      { kind: "qa", profile: String(report.run.profile) },
    );

    app.atlasLogger.info("qa_run_analyzed", {
      runId: report.run.id,
      scope: report.run.scope,
      profile: report.run.profile,
      findings: report.findings.length,
      patterns: report.portfolioPatterns.length,
      durablePatterns: report.durablePatterns.length,
      contextPatterns: report.contextPatterns.length,
      learnedKeys: priorKeys.length,
      regressionRules: report.regressionRulesTriggered.length,
      seededPortfolioMemories: seededMemories.length,
    });

    return reply.status(201).send({
      ...report,
      memoryContext: {
        ...memoryContext,
        patternLessons: report.patternLessons,
        contextPatternCount: report.contextPatterns.length,
      },
      seededPortfolioMemories: seededMemories.map((m) => ({
        id: m.id,
        statement: m.statement,
        epistemicState: m.epistemicState,
        patternKey:
          m.reason
            .find((r) => r.startsWith("patternKey:"))
            ?.slice("patternKey:".length) ?? null,
      })),
    });
  });

  /**
   * Process agent — enters the customer's app class profile and audits
   * internal journeys (auth/RBAC/tenant/E2E/AI-HITL/UI-UX/perf/providers).
   * Returns a structured GO / CONDITIONAL_GO / NO_GO document.
   */
  app.post("/api/v1/qa/process-audit", async (request, reply) => {
    const started = Date.now();
    osStore.ensureLoaded();
    assertProcessAuditQuota(app.atlasEnv);
    const body = createProcessAuditSchema.parse(request.body ?? {});
    // Auth + ownership gate (P0 fix): this route runs an audit and writes
    // data (report + memory sync) — never usable anonymously. When the
    // caller supplies a projectId it must be one they own (or admin);
    // otherwise just require a real signed-in caller. Mirrors the
    // client-supplied-projectId-trust precedent used by
    // observer.ts / sentinel.ts / code.ts via project-access.ts.
    if (body.projectId) {
      await assertProjectWriteAccess(app, request, body.projectId);
    } else {
      await requireSignedInForWrite(app, request);
    }
    enforceQaEntityAuthz("RECORD", "EXECUTE", "qa.process-audit");
    const project = body.projectId ? osStore.getProject(body.projectId) : null;
    const allProjects = osStore.listProjects();
    const projectId =
      body.projectId ?? allProjects[0]?.id ?? null;
    const resolvedProject = projectId
      ? (osStore.getProject(projectId) ?? project)
      : null;

    const goldenSlug = app.atlasEnv.ATLAS_GOLDEN_PROJECT_SLUG ?? "brokeros";
    const workspaceRoots = resolveProjectWorkspaceRoots({
      projectIds: projectId ? [projectId] : [],
      goldenSlug,
      queryRoot: null,
      envRoot: app.atlasEnv.ATLAS_GOLDEN_PROJECT_ROOT ?? null,
    });
    const workspaceRoot = projectId ? workspaceRoots[projectId] : undefined;

    const document = runProcessInternalAudit({
      request: body,
      projectId,
      workspaceRoot,
      projectName: resolvedProject?.name,
    });

    osStore.setMeta(
      `qa.processAudit.${document.id}`,
      JSON.stringify(document),
    );
    rememberProcessAuditId(document.id);
    const memory = syncProcessAuditToMemory(document);
    recordProcessAuditUsage();
    osStore.setMeta(
      "admin.processAudit.last",
      JSON.stringify({ at: document.completedAt, auditId: document.id }),
    );

    osStore.recordEvent({
      type: "qa.process_audit.completed",
      auditId: document.id,
      projectId,
      appProfile: document.appProfile,
      verdict: document.verdict,
      itemCount: document.items.length,
      memoryId: memory.id,
      at: document.completedAt,
    });

    atlasMetrics.record("agent_run_duration", Date.now() - started, {
      kind: "process_audit",
    });
    app.atlasLogger.info("qa_process_audit_completed", {
      auditId: document.id,
      projectId,
      appProfile: document.appProfile,
      verdict: document.verdict,
      items: document.items.length,
      memoryId: memory.id,
    });

    return reply.status(201).send({
      ...document,
      syncedMemoryId: memory.id,
      note: "Audit synced to Memory — manager-partner agent can remind you later. Use central-opinion PDF/HTML for one consolidated client opinion.",
    });
  });
}


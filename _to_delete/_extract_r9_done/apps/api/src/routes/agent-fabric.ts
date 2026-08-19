import type { FastifyInstance } from "fastify";
import {
  agentDispatchRequestSchema,
  agentPlanRequestSchema,
  fabricAgentPublicSchema,
  judgeEvaluateRequestSchema,
  knowledgeIngestRequestSchema,
  knowledgeSearchRequestSchema,
  lessonLearnedSchema,
  VERIFIED_TECH_SOURCES,
  VERIFIED_LEGAL_MEDIA_SOURCES,
  TECH_SOURCE_DOMAINS,
  buildVerifiedTechSourcesPack,
  buildVerifiedTechSourcesMarkdown,
  isAuthorizedOfficialKnowledgeUrl,
  AtlasError,
} from "@atlas/shared";
import {
  dispatchAgentPlan,
  evaluateJudge,
  listFabricAgents,
  planAgentWork,
} from "@atlas/agent-core";
import {
  getKnowledgeCorpusPersistPath,
  getKnowledgeCorpusSource,
  hydrateKnowledgeCorpus,
  listKnowledgeCorpus,
  listPortfolioLessons,
} from "@atlas/knowledge";
import { z } from "zod";
import { osStore } from "../store/os-store.js";
import {
  appendDomainEvent,
  buildMemoryContext,
  type MemoryContextPayload,
} from "../services/memory-pipeline.js";
import {
  ingestKnowledgeClosedLoop,
  searchKnowledgeClosedLoop,
} from "../services/hybrid-rag.js";
import { atlasMetrics } from "./metrics.js";
import { requireSignedInForWrite } from "../middleware/auth-guards.js";
import { runLegalMediaSpecialistViaReview } from "../services/legal-media-dispatch.js";
import { runSecuritySpecialistViaSentinel } from "../services/security-sentinel-dispatch.js";
import {
  knowledgeRefreshIsDue,
  readKnowledgeRefreshLedger,
  refreshVerifiedKnowledge,
} from "../services/verified-knowledge-refresh.js";

const AGENT_MEMORY_BUDGET = 12;

function toPublicMemoryContext(
  ctx: ReturnType<typeof buildMemoryContext>,
): MemoryContextPayload {
  return {
    items: ctx.items,
    budget: ctx.budget,
    truncated: ctx.truncated,
    epistemicState: ctx.epistemicState,
    note: ctx.note,
  };
}

function ensureKnowledgeCorpusHydrated(): void {
  hydrateKnowledgeCorpus({ enablePersist: true });
}

export async function registerAgentFabricRoutes(
  app: FastifyInstance,
): Promise<void> {
  ensureKnowledgeCorpusHydrated();

  app.get("/api/v1/agents", async () => ({
    model: "ONE_BRAIN_MANY_SPECIALISTS_ONE_JUDGE",
    note: "Agent ≠ Model. Typed handoffs on Evidence Bus — not multi-LLM chat.",
    knowledge: {
      corpusDocs: listKnowledgeCorpus().length,
      corpusSource: getKnowledgeCorpusSource(),
      officialSources:
        VERIFIED_TECH_SOURCES.length + VERIFIED_LEGAL_MEDIA_SOURCES.length,
      specialists: listFabricAgents().length,
      policy: "Dispatch injects allow-listed excerpts. Not textbooks. No blogs.",
    },
    items: listFabricAgents().map((a) =>
      fabricAgentPublicSchema.parse({ ...a, trustLevel: "LAB" }),
    ),
  }));

  app.get("/api/v1/agents/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const agent = listFabricAgents().find((a) => a.id === id);
    if (!agent) {
      return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Agent not found" } });
    }
    return fabricAgentPublicSchema.parse({ ...agent, trustLevel: "LAB" });
  });

  app.post("/api/v1/agents/plan", async (request) => {
    // Tenant boundary (P0 fix): this endpoint calls buildMemoryContext()
    // below, which returns evidence-tagged memory *statements* directly in
    // the HTTP response — without a signed-in caller + ownerId scope it
    // would leak every tenant's memories to any anonymous requester.
    const user = await requireSignedInForWrite(app, request);
    const body = agentPlanRequestSchema.parse(request.body);
    const started = Date.now();
    const memoryContext = toPublicMemoryContext(
      buildMemoryContext({
        projectId: body.projectId ?? null,
        query: body.request,
        budget: AGENT_MEMORY_BUDGET,
        ownerId: user.id,
      }),
    );
    atlasMetrics.record(
      "retrieval_hit_rate",
      memoryContext.items.length > 0 ? 1 : 0,
      { surface: "memory", kind: "agents.plan" },
    );
    const plan = planAgentWork({
      request: body.request,
      ...(body.projectId !== undefined ? { projectId: body.projectId } : {}),
      ...(body.agentIds !== undefined ? { agentIds: body.agentIds } : {}),
      maxAgents: body.maxAgents,
      budgetUsd: body.budgetUsd,
    });
    atlasMetrics.record("agent_run_duration", Date.now() - started, {
      kind: "plan",
    });
    const at = new Date().toISOString();
    osStore.appendAudit({
      type: "agents.plan",
      planId: plan.id,
      projectId: body.projectId ?? null,
      steps: plan.steps.length,
      at,
    });
    appendDomainEvent({
      type: "observation.recorded",
      projectId: body.projectId ?? null,
      epistemicState: memoryContext.epistemicState,
      payload: {
        kind: "agents.plan",
        planId: plan.id,
        steps: plan.steps.length,
        memoryContext: {
          budget: memoryContext.budget,
          truncated: memoryContext.truncated,
          epistemicState: memoryContext.epistemicState,
          note: memoryContext.note,
          items: memoryContext.items.map((m) => ({
            id: m.id,
            type: m.type,
            epistemicState: m.epistemicState,
            statement: m.statement,
            evidence: m.evidence,
          })),
        },
      },
    });
    return {
      ...plan,
      memoryContext,
    };
  });

  app.post("/api/v1/agents/dispatch", async (request, reply) => {
    // Tenant boundary (P0 fix): same reasoning as /api/v1/agents/plan above
    // — dispatch also returns buildMemoryContext() statements directly in
    // the HTTP response (and in the audit/domain-event payloads below), so
    // it must require a signed-in caller and scope retrieval to their
    // ownerId.
    const user = await requireSignedInForWrite(app, request);
    const body = agentDispatchRequestSchema.parse(request.body);
    const started = Date.now();
    const memoryContext = toPublicMemoryContext(
      buildMemoryContext({
        projectId: body.projectId ?? null,
        query: body.request,
        budget: AGENT_MEMORY_BUDGET,
        ownerId: user.id,
      }),
    );
    atlasMetrics.record(
      "retrieval_hit_rate",
      memoryContext.items.length > 0 ? 1 : 0,
      { surface: "memory", kind: "agents.dispatch" },
    );
    const result = dispatchAgentPlan({
      request: body.request,
      ...(body.projectId !== undefined ? { projectId: body.projectId } : {}),
      ...(body.agentIds !== undefined ? { agentIds: body.agentIds } : {}),
      maxAgents: body.maxAgents,
      budgetUsd: body.budgetUsd,
      runJudge: body.runJudge,
      specialistOverride: (agentId, request) => {
        if (agentId === "SECURITY") {
          return runSecuritySpecialistViaSentinel({
            request,
            projectId: body.projectId ?? null,
          });
        }
        if (agentId === "LEGAL_MEDIA_COMMS") {
          return runLegalMediaSpecialistViaReview({
            request,
            projectId: body.projectId ?? null,
          });
        }
        return null;
      },
    });
    atlasMetrics.record("agent_run_duration", Date.now() - started, {
      kind: "dispatch",
    });
    const failed = result.runs.filter((r) => r.status === "FAILED").length;
    atlasMetrics.record(
      "tool_failure_rate",
      result.runs.length === 0 ? 0 : failed / result.runs.length,
      { kind: "dispatch" },
    );
    osStore.recordEvent({
      type: "agents.dispatch",
      id: result.id,
      traceId: result.traceId,
      judge: result.judge?.decision ?? null,
      at: result.createdAt,
    });
    // `result.runs[].costUsd` is already real/accurate where the underlying
    // specialist path computes it (see dispatch.ts / security-sentinel-dispatch.ts
    // / legal-media-dispatch.ts) and is already returned to the HTTP caller
    // below — but until now it was dropped before reaching the audit log, so
    // apps/api/src/services/cost-intelligence.ts had nothing durable to
    // aggregate. `totalCostUsd` + `runCosts` persist exactly what the
    // response already contains, without changing the response shape.
    // Named `runCosts` (not `runs`) because this audit entry already has a
    // `runs` field holding the run *count* — reusing that name for the
    // per-run breakdown array would silently corrupt the existing
    // `runCount` aggregation for every past and future audit entry.
    const totalCostUsd = Number(
      result.runs.reduce((sum, r) => sum + r.costUsd, 0).toFixed(6),
    );
    const runCosts = result.runs.map((r) => ({
      agentId: r.agentId,
      costUsd: r.costUsd,
    }));
    osStore.appendAudit({
      type: "agents.dispatch",
      id: result.id,
      traceId: result.traceId,
      projectId: body.projectId ?? null,
      judge: result.judge?.decision ?? null,
      runs: result.runs.length,
      failed,
      totalCostUsd,
      runCosts,
      at: result.createdAt,
    });
    appendDomainEvent({
      type: "evaluation.completed",
      projectId: body.projectId ?? null,
      epistemicState: memoryContext.epistemicState,
      payload: {
        kind: "agents.dispatch",
        id: result.id,
        judge: result.judge?.decision ?? null,
        runs: result.runs.length,
        memoryContext: {
          budget: memoryContext.budget,
          truncated: memoryContext.truncated,
          epistemicState: memoryContext.epistemicState,
          note: memoryContext.note,
          items: memoryContext.items.map((m) => ({
            id: m.id,
            type: m.type,
            epistemicState: m.epistemicState,
            statement: m.statement,
            evidence: m.evidence,
          })),
        },
      },
    });
    return reply.status(201).send({
      ...result,
      memoryContext,
    });
  });

  app.post("/api/v1/judge/evaluate", async (request) => {
    const body = judgeEvaluateRequestSchema.parse(request.body);
    return evaluateJudge({
      runs: body.runs,
      ...(body.request ? { request: body.request } : {}),
    });
  });

  app.post("/api/v1/knowledge/search", async (request) => {
    ensureKnowledgeCorpusHydrated();
    const body = knowledgeSearchRequestSchema.parse(request.body);
    const result = await searchKnowledgeClosedLoop(app.atlasEnv, {
      query: body.query,
      maxResults: body.maxResults,
      minAuthority: body.minAuthority,
      allowStale: body.allowStale,
    });
    atlasMetrics.record(
      "retrieval_hit_rate",
      result.hits.length > 0 ? 1 : 0,
      {
        surface: "knowledge",
        corpus: getKnowledgeCorpusSource(),
        backend: result.retrievalBackend ?? "local",
      },
    );
    const withCite = result.hits.filter(
      (h) => Boolean(h.url) || Boolean(h.contentHash),
    ).length;
    atlasMetrics.record(
      "citation_rate",
      result.hits.length === 0 ? 0 : withCite / result.hits.length,
      { surface: "knowledge" },
    );
    return result;
  });

  app.post("/api/v1/knowledge/ingest", async (request, reply) => {
    await requireSignedInForWrite(app, request);
    ensureKnowledgeCorpusHydrated();
    const body = knowledgeIngestRequestSchema.parse(request.body);
    if (body.url && !isAuthorizedOfficialKnowledgeUrl(body.url)) {
      throw new AtlasError(
        "FORBIDDEN",
        "External knowledge URL is not on the verified/authorized allow-list. Agents may only ingest official vendor, standards, government, or university sources.",
        { statusCode: 403 },
      );
    }
    if (!body.url && !body.projectScoped) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        "Non-project knowledge ingest requires a verified source URL.",
        { statusCode: 400 },
      );
    }
    const { document: doc, corpus, pgvector } = await ingestKnowledgeClosedLoop(
      app.atlasEnv,
      {
        title: body.title,
        excerpt: body.excerpt,
        sourceClass: body.sourceClass,
        ...(body.url !== undefined ? { url: body.url } : {}),
        ...(body.sourceUpdatedAt !== undefined
          ? { sourceUpdatedAt: body.sourceUpdatedAt }
          : {}),
        ...(body.projectScoped != null
          ? { projectScoped: body.projectScoped }
          : {}),
      },
    );
    osStore.setMeta(
      "knowledge.corpusPath",
      getKnowledgeCorpusPersistPath() ??
        hydrateKnowledgeCorpus({ enablePersist: true }).path,
    );
    appendDomainEvent({
      type: "observation.recorded",
      projectId: null,
      epistemicState: "OBSERVED",
      payload: {
        kind: "knowledge.ingest",
        id: doc.id,
        contentHash: doc.contentHash,
        corpus,
        pgvector,
      },
    });
    return reply.status(201).send({
      document: doc,
      corpus,
      pgvector,
      note: pgvector
        ? "Dual-wrote file corpus + pgvector knowledge_chunks."
        : "Persisted to local .atlas/knowledge/corpus.json (pgvector offline — set live SUPABASE_* / DATABASE_URL).",
    });
  });

  async function assertKnowledgeRefreshAllowed(
    request: Parameters<typeof requireSignedInForWrite>[1],
  ): Promise<void> {
    const secret =
      process.env.CRON_SECRET?.trim() ||
      process.env.ATLAS_CRON_SECRET?.trim() ||
      "";
    const auth = request.headers.authorization ?? "";
    if (secret && auth === `Bearer ${secret}`) return;
    await requireSignedInForWrite(app, request);
  }

  const runRefresh = async (
    request: Parameters<typeof requireSignedInForWrite>[1],
    reply: { status: (code: number) => { send: (body: unknown) => unknown } },
  ) => {
    await assertKnowledgeRefreshAllowed(request);
    ensureKnowledgeCorpusHydrated();
    const report = await refreshVerifiedKnowledge({ env: app.atlasEnv });
    appendDomainEvent({
      type: "observation.recorded",
      projectId: null,
      epistemicState: "OBSERVED",
      payload: {
        kind: "knowledge.refresh",
        ok: report.ok,
        failed: report.failed,
        pgvectorWrites: report.pgvectorWrites,
      },
    });
    return reply.status(200).send(report);
  };

  app.get("/api/v1/knowledge/refresh/status", async () => {
    const ledger = readKnowledgeRefreshLedger();
    return {
      due: knowledgeRefreshIsDue(),
      intervalHours: 24,
      lastFinishedAt: ledger?.lastFinishedAt ?? null,
      lastOk: ledger?.lastOk ?? 0,
      lastFailed: ledger?.lastFailed ?? 0,
      policy:
        "Daily allow-listed fetch of official vendor, government, and standards pages. Snapshots persist to corpus + knowledge_chunks when Supabase is live.",
    };
  });

  app.get("/api/v1/knowledge/refresh", async (request, reply) =>
    runRefresh(request, reply),
  );
  app.post("/api/v1/knowledge/refresh", async (request, reply) =>
    runRefresh(request, reply),
  );

  app.get("/api/v1/knowledge/corpus", async (request) => {
    await requireSignedInForWrite(app, request);
    ensureKnowledgeCorpusHydrated();
    return {
      items: listKnowledgeCorpus(),
      corpus: getKnowledgeCorpusSource(),
      path: getKnowledgeCorpusPersistPath(),
      note: "Corpus listing for ops — agents receive filtered packages only.",
    };
  });

  app.get("/api/v1/knowledge/verified-sources", async () => ({
    domains: TECH_SOURCE_DOMAINS,
    items: VERIFIED_TECH_SOURCES,
    policy:
      "Authorized verified knowledge only. Agents and the app must not treat blogs/forums/unlisted hosts as evidence.",
    download: {
      json: "/api/v1/knowledge/verified-sources/download?format=json",
      markdown: "/api/v1/knowledge/verified-sources/download?format=markdown",
    },
    note:
      "Allow-list of official vendor docs, standards bodies, government cyber guidance, and university CS portals. Agents must cite these — no blogs or invented sources.",
  }));

  /** Download verified allow-list to the user's computer (JSON or Markdown). */
  app.get("/api/v1/knowledge/verified-sources/download", async (request, reply) => {
    const q = z
      .object({
        format: z.enum(["json", "markdown"]).default("json"),
      })
      .parse(request.query ?? {});
    const stamp = new Date().toISOString().slice(0, 10);
    if (q.format === "markdown") {
      const body = buildVerifiedTechSourcesMarkdown();
      return reply
        .header(
          "Content-Disposition",
          `attachment; filename="atlas-verified-sources-${stamp}.md"`,
        )
        .type("text/markdown; charset=utf-8")
        .send(body);
    }
    const pack = buildVerifiedTechSourcesPack();
    return reply
      .header(
        "Content-Disposition",
        `attachment; filename="atlas-verified-sources-${stamp}.json"`,
      )
      .type("application/json; charset=utf-8")
      .send(pack);
  });

  app.get("/api/v1/knowledge/lessons", async () => ({
    items: listPortfolioLessons().map((l) => lessonLearnedSchema.parse(l)),
    note: "Cross-project lessons only — no raw project evidence leakage.",
  }));
}

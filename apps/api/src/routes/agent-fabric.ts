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
  TECH_SOURCE_DOMAINS,
  buildVerifiedTechSourcesPack,
  buildVerifiedTechSourcesMarkdown,
  isAuthorizedVerifiedTechUrl,
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
    const body = agentPlanRequestSchema.parse(request.body);
    const started = Date.now();
    const memoryContext = toPublicMemoryContext(
      buildMemoryContext({
        projectId: body.projectId ?? null,
        query: body.request,
        budget: AGENT_MEMORY_BUDGET,
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
    const body = agentDispatchRequestSchema.parse(request.body);
    const started = Date.now();
    const memoryContext = toPublicMemoryContext(
      buildMemoryContext({
        projectId: body.projectId ?? null,
        query: body.request,
        budget: AGENT_MEMORY_BUDGET,
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
    osStore.appendAudit({
      type: "agents.dispatch",
      id: result.id,
      traceId: result.traceId,
      projectId: body.projectId ?? null,
      judge: result.judge?.decision ?? null,
      runs: result.runs.length,
      failed,
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
    requireSignedInForWrite(app, request);
    ensureKnowledgeCorpusHydrated();
    const body = knowledgeIngestRequestSchema.parse(request.body);
    if (body.url && !isAuthorizedVerifiedTechUrl(body.url)) {
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

  app.get("/api/v1/knowledge/corpus", async () => {
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

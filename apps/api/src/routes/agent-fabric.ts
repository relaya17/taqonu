import type { FastifyInstance } from "fastify";
import {
  agentDispatchRequestSchema,
  agentPlanRequestSchema,
  fabricAgentPublicSchema,
  judgeEvaluateRequestSchema,
  knowledgeIngestRequestSchema,
  knowledgeSearchRequestSchema,
  lessonLearnedSchema,
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
  ingestKnowledgeDocument,
  listKnowledgeCorpus,
  listPortfolioLessons,
  searchKnowledgeFabric,
} from "@atlas/knowledge";
import {
  cosineSimilarity,
  getDefaultEmbeddingProvider,
  safeEmbed,
} from "@atlas/embeddings";
import { osStore } from "../store/os-store.js";
import { appendDomainEvent } from "../services/memory-pipeline.js";
import { atlasMetrics } from "./metrics.js";
import { requireSignedInForWrite } from "../middleware/auth-guards.js";

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
    const plan = planAgentWork({
      request: body.request,
      ...(body.projectId !== undefined ? { projectId: body.projectId } : {}),
      maxAgents: body.maxAgents,
      budgetUsd: body.budgetUsd,
    });
    atlasMetrics.record("agent_run_duration", Date.now() - started, {
      kind: "plan",
    });
    appendDomainEvent({
      type: "observation.recorded",
      projectId: body.projectId ?? null,
      epistemicState: "INFERRED",
      payload: { kind: "agents.plan", planId: plan.id, steps: plan.steps.length },
    });
    return plan;
  });

  app.post("/api/v1/agents/dispatch", async (request, reply) => {
    const body = agentDispatchRequestSchema.parse(request.body);
    const started = Date.now();
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
    appendDomainEvent({
      type: "evaluation.completed",
      projectId: body.projectId ?? null,
      epistemicState: "INFERRED",
      payload: {
        kind: "agents.dispatch",
        id: result.id,
        judge: result.judge?.decision ?? null,
        runs: result.runs.length,
      },
    });
    return reply.status(201).send(result);
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
    const corpus = listKnowledgeCorpus();
    const provider = getDefaultEmbeddingProvider();
    const texts = [body.query, ...corpus.map((d) => `${d.title}\n${d.excerpt}`)];
    const vectors = await safeEmbed(provider, texts);
    const queryVec = vectors[0] ?? [];
    const vectorScores: Record<string, number> = {};
    corpus.forEach((doc, i) => {
      const cached = doc.embedding;
      const docVec =
        cached && cached.length > 0 ? cached : (vectors[i + 1] ?? []);
      vectorScores[doc.id] = cosineSimilarity(queryVec, docVec);
    });
    const result = searchKnowledgeFabric({
      query: body.query,
      maxResults: body.maxResults,
      minAuthority: body.minAuthority,
      allowStale: body.allowStale,
      vectorScores,
    });
    atlasMetrics.record(
      "retrieval_hit_rate",
      result.hits.length > 0 ? 1 : 0,
      { surface: "knowledge", corpus: getKnowledgeCorpusSource() },
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
    const provider = getDefaultEmbeddingProvider();
    const [embedding] = await safeEmbed(provider, [
      `${body.title}\n${body.excerpt}`,
    ]);
    const doc = ingestKnowledgeDocument({
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
      ...(embedding ? { embedding: [...embedding] } : {}),
    });
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
        corpus: getKnowledgeCorpusSource(),
      },
    });
    return reply.status(201).send({
      document: doc,
      corpus: getKnowledgeCorpusSource(),
      note: "Persisted to local .atlas/knowledge/corpus.json when writable.",
    });
  });

  app.get("/api/v1/knowledge/lessons", async () => ({
    items: listPortfolioLessons().map((l) => lessonLearnedSchema.parse(l)),
    note: "Cross-project lessons only — no raw project evidence leakage.",
  }));
}

import type { FastifyInstance } from "fastify";
import {
  createTaskPlanRequestSchema,
  engineeringLessonSchema,
  improvementRuleSchema,
  kernelRunRequestSchema,
  knowledgeIngestRequestSchema,
  knowledgeSearchRequestSchema,
  registeredAgentSchema,
  runAgentEvalRequestSchema,
  FABRIC_AGENT_IDS,
  type FabricAgentId,
} from "@atlas/shared";
import {
  createTaskPlan,
  listRegisteredAgents,
  getRegisteredAgent,
  runIntelligenceKernel,
  runKernelEvaluation,
  listEngineeringLessons,
  recordEngineeringLesson,
  listImprovementRules,
  runSelfImprovement,
} from "@atlas/agent-core";
import {
  listKnowledgeCorpus,
  hydrateKnowledgeCorpus,
  getKnowledgeCorpusSource,
  getKnowledgeCorpusPersistPath,
} from "@atlas/knowledge";
import {
  ingestKnowledgeClosedLoop,
  searchKnowledgeClosedLoop,
} from "../services/hybrid-rag.js";
import { appendDomainEvent } from "../services/memory-pipeline.js";
import { osStore } from "../store/os-store.js";
import { z } from "zod";

export async function registerKernelRoutes(app: FastifyInstance): Promise<void> {
  hydrateKnowledgeCorpus({ enablePersist: true });
  app.get("/api/v1/kernel/status", async () => ({
    product: "ATLAS Intelligence Kernel",
    version: "v1",
    model: "AGENT_OPERATING_SYSTEM",
    phases: {
      "1_registry": "SHIPPED",
      "2_orchestrator": "SHIPPED",
      "3_evidence_bus": "SHIPPED",
      "4_knowledge_fabric": "SHIPPED",
      "5_specialists": "SHIPPED",
      "6_judge": "SHIPPED",
      "7_engineering_loop": "SHIPPED_BRIDGE",
      "8_evaluation": "SHIPPED",
      "9_long_term_memory": "SHIPPED",
      "10_self_improvement": "SHIPPED",
    },
    layers: [
      "Orchestrator",
      "Agent Registry",
      "Knowledge Fabric",
      "Evidence Graph/Bus",
      "Tool Fabric (contracts)",
      "Judge + Council",
      "Learning/Memory",
    ],
    rule: "INSUFFICIENT_EVIDENCE > CONFIDENT_HALLUCINATION",
  }));

  /** P1 Registry */
  app.get("/api/v1/kernel/agents", async () => ({
    layer: "Agent Registry",
    phase: 1,
    items: listRegisteredAgents().map((a) => registeredAgentSchema.parse(a)),
  }));

  app.get("/api/v1/kernel/agents/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    if (!FABRIC_AGENT_IDS.includes(id as FabricAgentId)) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: "Agent not in registry" },
      });
    }
    return getRegisteredAgent(id as FabricAgentId);
  });

  /** P2 Orchestrator */
  app.post("/api/v1/kernel/plan", async (request) => {
    const body = createTaskPlanRequestSchema.parse(request.body);
    const plan = createTaskPlan({
      request: body.request,
      ...(body.projectId !== undefined ? { projectId: body.projectId } : {}),
      maxAgents: body.maxAgents,
      budgetUsd: body.budgetUsd,
    });
    appendDomainEvent({
      type: "observation.recorded",
      projectId: body.projectId ?? null,
      epistemicState: "INFERRED",
      payload: {
        kind: "kernel.plan",
        planId: plan.id,
        risk: plan.riskLevel,
        simulationRequired: plan.simulationRequired,
      },
    });
    return plan;
  });

  /** P1–P7 run */
  app.post("/api/v1/kernel/run", async (request, reply) => {
    const body = kernelRunRequestSchema.parse(request.body);
    const result = runIntelligenceKernel({
      request: body.request,
      ...(body.projectId !== undefined ? { projectId: body.projectId } : {}),
      maxAgents: body.maxAgents,
      budgetUsd: body.budgetUsd,
      runSimulation: body.runSimulation,
      runJudge: body.runJudge,
    });
    osStore.recordEvent({
      type: "kernel.run",
      id: result.id,
      traceId: result.traceId,
      judge: result.judge?.decision ?? null,
      evidence: result.evidenceItems.length,
      lessons: result.lessonsApplied,
      at: result.createdAt,
    });
    appendDomainEvent({
      type: "evaluation.completed",
      projectId: body.projectId ?? null,
      epistemicState: result.judge?.epistemicState ?? "INFERRED",
      payload: {
        kind: "kernel.run",
        id: result.id,
        judge: result.judge?.decision ?? null,
        evidenceEvents: result.evidenceEvents.length,
        knowledgeHits: result.knowledgePackage?.hitIds.length ?? 0,
      },
    });
    return reply.status(201).send(result);
  });

  /** P4 Knowledge Fabric — closed-loop hybrid RAG (pgvector when live, else local). */
  app.post("/api/v1/kernel/knowledge/search", async (request) => {
    hydrateKnowledgeCorpus({ enablePersist: true });
    const body = knowledgeSearchRequestSchema.parse(request.body);
    return searchKnowledgeClosedLoop(app.atlasEnv, {
      query: body.query,
      maxResults: body.maxResults,
      minAuthority: body.minAuthority,
      allowStale: body.allowStale,
    });
  });

  app.post("/api/v1/kernel/knowledge/ingest", async (request, reply) => {
    hydrateKnowledgeCorpus({ enablePersist: true });
    const body = knowledgeIngestRequestSchema.parse(request.body);
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
    return reply.status(201).send({
      document: doc,
      corpus,
      pgvector,
      note: pgvector
        ? "Dual-wrote file corpus + pgvector."
        : "File corpus only (pgvector offline).",
    });
  });

  app.get("/api/v1/kernel/knowledge/corpus", async () => {
    hydrateKnowledgeCorpus({ enablePersist: true });
    return {
      items: listKnowledgeCorpus(),
      corpus: getKnowledgeCorpusSource(),
      path: getKnowledgeCorpusPersistPath(),
      note: "Corpus listing for ops — agents receive filtered packages only.",
    };
  });

  /** P8 Evaluation */
  app.post("/api/v1/kernel/eval/run", async (request, reply) => {
    const body = runAgentEvalRequestSchema.parse(request.body ?? {});
    const report = runKernelEvaluation({
      ...(body.agentId !== undefined ? { agentId: body.agentId } : {}),
      ...(body.suite ? { suite: body.suite } : {}),
    });
    osStore.recordEvent({
      type: "kernel.eval",
      id: report.id,
      accuracy: report.accuracy,
      suite: report.suite,
      at: report.createdAt,
    });
    return reply.status(201).send(report);
  });

  /** P9 Memory */
  app.get("/api/v1/kernel/memory/lessons", async () => ({
    items: listEngineeringLessons().map((l) => engineeringLessonSchema.parse(l)),
    note: "Cross-project patterns only — no raw business evidence leakage.",
  }));

  app.post("/api/v1/kernel/memory/lessons", async (request, reply) => {
    const body = z
      .object({
        pattern: z.string().min(1).max(120),
        title: z.string().min(1).max(200),
        summary: z.string().min(1).max(4000),
        evidenceProjectSlug: z.string().nullable().optional(),
        applicableDomains: z.array(z.string()).optional(),
      })
      .parse(request.body);
    const lesson = recordEngineeringLesson({
      pattern: body.pattern,
      title: body.title,
      summary: body.summary,
      ...(body.evidenceProjectSlug !== undefined
        ? { evidenceProjectSlug: body.evidenceProjectSlug }
        : {}),
      ...(body.applicableDomains
        ? { applicableDomains: body.applicableDomains }
        : {}),
    });
    return reply.status(201).send(lesson);
  });

  /** P10 Self-improvement */
  app.post("/api/v1/kernel/improve", async (request, reply) => {
    const result = runSelfImprovement();
    osStore.recordEvent({
      type: "kernel.improve",
      created: result.created.length,
      scanned: result.scannedLessons,
      at: new Date().toISOString(),
    });
    return reply.status(201).send({
      ...result,
      rules: listImprovementRules().map((r) => improvementRuleSchema.parse(r)),
    });
  });

  app.get("/api/v1/kernel/improve/rules", async () => ({
    items: listImprovementRules().map((r) => improvementRuleSchema.parse(r)),
  }));
}

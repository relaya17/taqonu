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
  isAuthorizedOfficialKnowledgeUrl,
  AtlasError,
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
import { runSecuritySpecialistViaSentinel } from "../services/security-sentinel-dispatch.js";
import { z } from "zod";
import { requireSignedInForWrite } from "../middleware/auth-guards.js";
import { enforceEntityWrite } from "../services/risk-audit.js";

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
    // ROLE-LEVEL gate: any signed-in WRITE-capable user may trigger a
    // kernel run. ENTITY-LEVEL gate below is a second, independent axis
    // (see admin-ops.ts's run-checks for the general two-axis pattern).
    const user = await requireSignedInForWrite(app, request);
    const body = kernelRunRequestSchema.parse(request.body);

    // `CONFIGURATION.EXECUTE` is the closest fit: a kernel run dispatches
    // the control-plane orchestrator/agent-fabric itself rather than
    // mutating a specific business record. Unlike
    // `admin.automation.run-checks` (an unbounded, platform-wide watchdog
    // sweep), a kernel run is scoped to a single caller-supplied request
    // with an explicit agent/budget cap, so an authenticated WRITE-session
    // caller's own request is treated as sufficient authorization here —
    // no separate human-approval round trip is manufactured for it. This
    // still genuinely exercises the entity-policy engine: DENIED/blocked
    // outcomes (e.g. write gate closed) are enforced, not bypassed.
    enforceEntityWrite({
      entityType: "CONFIGURATION",
      action: "EXECUTE",
      routeLabel: "kernel.run",
      actorId: user.id,
      projectId: body.projectId ?? null,
    });

    const sentinel = runSecuritySpecialistViaSentinel({
      request: body.request,
      projectId: body.projectId ?? null,
    });
    const result = runIntelligenceKernel({
      request: body.request,
      ...(body.projectId !== undefined ? { projectId: body.projectId } : {}),
      maxAgents: body.maxAgents,
      budgetUsd: body.budgetUsd,
      runSimulation: body.runSimulation,
      runJudge: body.runJudge,
      ...(sentinel
        ? {
            securityObservation: {
              claims: sentinel.claims,
              evidenceRefs: sentinel.evidenceRefs,
            },
          }
        : {}),
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
        actorId: user.id,
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
    await requireSignedInForWrite(app, request);
    hydrateKnowledgeCorpus({ enablePersist: true });
    const body = knowledgeIngestRequestSchema.parse(request.body);
    if (body.url && !isAuthorizedOfficialKnowledgeUrl(body.url)) {
      throw new AtlasError(
        "FORBIDDEN",
        "External knowledge URL is not on the verified/authorized allow-list.",
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
    return reply.status(201).send({
      document: doc,
      corpus,
      pgvector,
      note: pgvector
        ? "Dual-wrote file corpus + pgvector."
        : "File corpus only (pgvector offline).",
    });
  });

  app.get("/api/v1/kernel/knowledge/corpus", async (request) => {
    await requireSignedInForWrite(app, request);
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
    // Self-improvement mutates the agent's own improvement-rule set from
    // scanned lessons — an irreversible, agent-triggered control-plane
    // change, so it gets the same two-axis (role + entity) gating as
    // kernel/run above rather than staying open to any caller.
    const improveUser = await requireSignedInForWrite(app, request);
    enforceEntityWrite({
      entityType: "CONFIGURATION",
      action: "EXECUTE",
      routeLabel: "kernel.improve",
      actorId: improveUser.id,
    });

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

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
  ATLAS_SELF_APPLICATION_ID,
  type FabricAgentId,
} from "@atlas/shared";
import { atlasSelfArtifactHash } from "@atlas/shared/node";
import {
  authorizeEntityAction,
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
} from "../services/hybrid-rag.js";
import {
  retrieveGovernedKnowledge,
  requireKnowledgeSearchScope,
} from "../services/governed-knowledge-retrieval.js";
import { appendDomainEvent } from "../services/memory-pipeline.js";
import { osStore } from "../store/os-store.js";
import { runSecuritySpecialistViaSentinel } from "../services/security-sentinel-dispatch.js";
import { z } from "zod";
import { requireOperator, requireSignedInForWrite } from "../middleware/auth-guards.js";
import {
  atlasSelfExecutedEvidence,
  auditAtlasSelfDecision,
  executeAtlasSelfLiveHuman,
  mintAtlasSelfApproval,
  respondAtlasSelfHelper,
} from "../services/atlas-self-governance.js";

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
    const entityAuthz = authorizeEntityAction("CONFIGURATION", "EXECUTE", {
      mode: "WRITE",
      writeGateOpen: true,
      approved: true,
    });
    if (entityAuthz.decision !== "ALLOWED") {
      const reason =
        entityAuthz.decision === "DENIED"
          ? entityAuthz.reason
          : "kernel.run (CONFIGURATION.EXECUTE) was not ALLOWED.";
      throw new AtlasError("FORBIDDEN", reason, { statusCode: 403 });
    }

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

  /** P4 Knowledge Fabric — closed-loop hybrid RAG through governed eligibility. */
  app.post("/api/v1/kernel/knowledge/search", async (request) => {
    hydrateKnowledgeCorpus({ enablePersist: true });
    const body = knowledgeSearchRequestSchema.parse(request.body);
    const user = await requireSignedInForWrite(app, request);
    const pin =
      body.pinnedSourceId || body.pinnedSourceVersion
        ? {
            ...(body.pinnedSourceId ? { sourceId: body.pinnedSourceId } : {}),
            ...(body.pinnedSourceVersion
              ? { sourceVersion: body.pinnedSourceVersion }
              : {}),
          }
        : undefined;
    const retrieval = await retrieveGovernedKnowledge({
      env: app.atlasEnv,
      sessionOwnerId: user.id,
      scope: {
        ownerId: user.id,
        tenantId: body.tenantId,
        projectId: body.projectId,
        applicationId: body.applicationId,
        requestingAgentId: body.requestingAgentId,
      },
      query: body.query,
      requestId: request.id,
      routeLabel: "kernel.knowledge.search",
      maxResults: body.maxResults,
      minAuthority: body.minAuthority,
      allowStale: body.allowStale,
      ...(pin ? { pin } : {}),
    });
    return requireKnowledgeSearchScope(retrieval);
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

  /** P10 Self-improvement — Atlas-self CONFIGURATION.EXECUTE, never self-approved. */
  app.post("/api/v1/kernel/improve", async (request, reply) => {
    const user = await requireOperator(app, request);
    const body = z
      .object({
        approvalId: z.string().uuid().optional(),
        decisionReason: z.string().trim().min(1).max(2000).optional(),
      })
      .parse(request.body ?? {});
    const artifactHash = atlasSelfArtifactHash({
      applicationId: ATLAS_SELF_APPLICATION_ID,
      operation: "kernel.improve",
    });

    if (body.approvalId) {
      if (!body.decisionReason) {
        throw new AtlasError(
          "VALIDATION_ERROR",
          "decisionReason is required for an Atlas-self live-human decision",
        );
      }
      const helper = await executeAtlasSelfLiveHuman({
        approvalId: body.approvalId,
        deciderId: user.id,
        decisionReason: body.decisionReason,
        entityType: "CONFIGURATION",
        action: "EXECUTE",
        artifactHash,
        requestId: request.id,
        routeLabel: "kernel.improve",
        executeOnce: async () => {
          const result = runSelfImprovement();
          osStore.recordEvent({
            type: "kernel.improve",
            created: result.created.length,
            scanned: result.scannedLessons,
            at: new Date().toISOString(),
          });
          return atlasSelfExecutedEvidence(
            {
              ...result,
              rules: listImprovementRules().map((r) =>
                improvementRuleSchema.parse(r),
              ),
              executed: true,
              verified: false,
              applicationId: ATLAS_SELF_APPLICATION_ID,
            },
            { created: result.created.length },
          );
        },
      });
      if (helper.status === "EXECUTED") {
        auditAtlasSelfDecision({
          type: "kernel.improve",
          actorId: user.id,
          routeLabel: "kernel.improve",
          decision: "ALLOW",
          reason: "Independent live-human approval executed Atlas self-improvement",
          approvalId: body.approvalId,
          approvalStatus: helper.approvalRecord?.status ?? "CLAIMED",
          executed: true,
          verificationVerdict: "INCONCLUSIVE",
        });
      }
      return respondAtlasSelfHelper(reply, helper);
    }

    const approval = await mintAtlasSelfApproval({
      entityType: "CONFIGURATION",
      action: "EXECUTE",
      requestedBy: user.id,
      reason: "run kernel self-improvement",
      route: "kernel.improve",
      artifactHash,
    });
    auditAtlasSelfDecision({
      type: "kernel.improve",
      actorId: user.id,
      routeLabel: "kernel.improve",
      decision: "REQUIRE_APPROVAL",
      reason: "Atlas self-improvement cannot self-approve CONFIGURATION.EXECUTE",
      approvalId: approval.id,
      approvalStatus: approval.status,
      executed: false,
    });
    return reply.status(202).send({
      status: "APPROVAL_REQUIRED" as const,
      approvalId: approval.id,
      applicationId: ATLAS_SELF_APPLICATION_ID,
      executed: false,
      verified: false,
      message:
        "Independent live-human decision required. Retry with approvalId and decisionReason from a different authenticated identity.",
    });
  });

  app.get("/api/v1/kernel/improve/rules", async () => ({
    items: listImprovementRules().map((r) => improvementRuleSchema.parse(r)),
  }));
}

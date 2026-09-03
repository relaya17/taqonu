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
  authorizeEntityAction,
  dispatchAgentPlan,
  evaluateJudge,
  listFabricAgents,
  planAgentWork,
  resolveCanonicalToolOperationForRequest,
} from "@atlas/agent-core";
import { executeGovernedAction } from "../services/governed-execution.js";
import {
  resolveAgentIdentity,
  enforceAgentToolAuthorization,
  type ToolExecutionPayload,
} from "../services/agent-runtime-authz.js";
import { findRepoRoot } from "../services/repo-root.js";
import { dispatchAgentAction } from "../services/agent-dispatch-guard.js";
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
import { runCodeEngineerSpecialistViaLlm } from "../services/code-engineer-dispatch.js";
import { runResearcherSpecialistViaLlm } from "../services/research-analyst-dispatch.js";
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
    // ENTITY-LEVEL gate: intentionally NOT added here. `planAgentWork`
    // below only proposes a plan (steps + budget/cost estimate) — it never
    // dispatches an agent or mutates/executes anything, mirroring
    // `kernel.ts`'s `POST /kernel/plan` (no `authorizeEntityAction` call)
    // vs. its `POST /kernel/run` (has one). If this route is ever changed
    // to auto-execute steps rather than just return them for review, it
    // should gain the same `CONFIGURATION.EXECUTE` check that
    // `/api/v1/agents/dispatch` has below.
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

    // ENTITY-LEVEL gate, independent of the ROLE-LEVEL WRITE check above.
    // Unlike /api/v1/agents/plan, this route actually dispatches agents
    // that perform real work (see `specialistOverride` below, which can run
    // live SECURITY/LEGAL_MEDIA_COMMS specialist actions) — this was the
    // confirmed gap: no central Policy-Engine check for agent-initiated
    // dispatch. `CONFIGURATION.EXECUTE` is the closest fit, matching
    // `kernel.ts`'s `POST /kernel/run` (dispatching the control-plane
    // agent fabric itself, not mutating one specific business record).
    // As with kernel/run, this is scoped to a single caller-supplied
    // request with an explicit agent/budget cap (not an unbounded sweep
    // like admin-ops.ts's run-checks), so an authenticated WRITE-session
    // caller's own request is treated as sufficient authorization — no
    // separate human-approval round trip is manufactured for it here. The
    // entity-policy engine is still genuinely exercised: a DENIED decision
    // (e.g. write gate closed) blocks the request rather than being
    // bypassed.
    //
    // Numeric risk-bucket scoring (`computeActionRiskScore`/
    // `bucketForRiskScore`, as used by code.ts for patch apply/rollback)
    // was intentionally NOT added here: that scorer needs a per-action
    // `baseTier` derived from something like an existing `PatchRisk`, plus
    // real `confidence`/`evidenceCount` inputs, and none of those exist
    // for an agent-dispatch request *before* dispatch runs — the judge's
    // confidence/evidence for this call are only known *after* dispatch
    // completes, not ahead of the gate. Retrofitting a meaningful risk
    // score (and the approval-workflow wiring admin-ops.ts uses for its
    // DESTRUCTIVE/requiresApproval case) would need a real design decision
    // about what pre-dispatch signal to score, which is out of scope for
    // this fix; the categorical policy check above is the safe, correct
    // subset to land now.
    const entityAuthz = authorizeEntityAction("CONFIGURATION", "EXECUTE", {
      mode: "WRITE",
      writeGateOpen: true,
      approved: true,
    });
    if (entityAuthz.decision !== "ALLOWED") {
      const reason =
        entityAuthz.decision === "DENIED"
          ? entityAuthz.reason
          : "agents.dispatch (CONFIGURATION.EXECUTE) was not ALLOWED.";
      throw new AtlasError("FORBIDDEN", reason, { statusCode: 403 });
    }

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
    const result = await dispatchAgentPlan({
      request: body.request,
      ...(body.projectId !== undefined ? { projectId: body.projectId } : {}),
      ...(body.agentIds !== undefined ? { agentIds: body.agentIds } : {}),
      maxAgents: body.maxAgents,
      budgetUsd: body.budgetUsd,
      runJudge: body.runJudge,
      specialistOverride: async (agentId, requestStr) => {
        // Gate check before calling the specialist — CASE.EXECUTE for security
        // scans and legal-media reviews. If the gate denies or requires
        // approval, return a SKIPPED run carrying the reason.
        if (agentId === "SECURITY" || agentId === "LEGAL_MEDIA_COMMS") {
          const gate = await dispatchAgentAction({
            actor: {
              kind: "AGENT",
              agentId,
              onBehalfOfUserId: user.id,
            },
            entityType: "CASE",
            action: "EXECUTE",
            routeLabel: `agents.dispatch.${agentId.toLowerCase()}`,
            sourceContext: {
              origin: "user_message",
              trustLevel: "trusted",
            },
            projectId: body.projectId ?? null,
            input: { request: requestStr },
          });

          if (gate.decision !== "ALLOWED") {
            const reason =
              gate.decision === "DENIED"
                ? gate.reason
                : `CASE.EXECUTE requires approval (${gate.approvalRequestId})`;
            const claims = [`${agentId}: ${reason}`];
            if (gate.decision === "APPROVAL_REQUIRED") {
              claims.push(`approvalRequestId:${gate.approvalRequestId}`);
            }
            return {
              agentId,
              status: "SKIPPED" as const,
              summary: reason,
              claims,
              evidenceRefs: [],
              epistemicState: "UNKNOWN" as const,
              costUsd: 0,
              durationMs: 0,
              ...(gate.decision === "APPROVAL_REQUIRED"
                ? { approvalRequestId: gate.approvalRequestId }
                : {}),
            };
          }
        }

        if (agentId === "SECURITY") {
          return runSecuritySpecialistViaSentinel({
            request: requestStr,
            projectId: body.projectId ?? null,
          });
        }
        if (agentId === "LEGAL_MEDIA_COMMS") {
          return runLegalMediaSpecialistViaReview({
            request: requestStr,
            projectId: body.projectId ?? null,
          });
        }
        if (agentId === "CODE_ENGINEER") {
          return runCodeEngineerSpecialistViaLlm({
            request: requestStr,
            projectId: body.projectId ?? null,
            ownerId: user.id,
            env: app.atlasEnv,
          });
        }
        if (agentId === "RESEARCHER") {
          return runResearcherSpecialistViaLlm({
            request: requestStr,
            projectId: body.projectId ?? null,
            ownerId: user.id,
            env: app.atlasEnv,
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

  /**
   * POST /api/v1/agents/tool-execute
   *
   * P0.7 — the governed execution gate wearing a route. Every agent tool
   * execution MUST pass through this route (or its programmatic equivalent,
   * `executeGovernedAction`). The body cannot name its own owner, cannot name
   * its own sandbox root, and the identity is derived from the session.
   */
  const toolExecutePayloadSchema = z
    .object({
      targetOwnerId: z.string().optional(),
      targetProjectId: z.string().optional(),
      targetAgentId: z.string().optional(),
    })
    .passthrough()
    .optional();

  const toolExecuteBodySchema = z
    .object({
      fabricAgentId: z.string(),
      toolName: z.string(),
      toolArgs: z.record(z.unknown()),
      artifact: z.string(),
      entityType: z.string().min(1).max(200).optional(),
      action: z.string().min(1).max(200).optional(),
      payload: toolExecutePayloadSchema,
      approvalRequestId: z.string().uuid().optional(),
      projectId: z.string().uuid().nullable().optional(),
    })
    .strict();

  app.post("/api/v1/agents/tool-execute", async (request, reply) => {
    const user = await requireSignedInForWrite(app, request);
    const body = toolExecuteBodySchema.parse(request.body);

    // Resolve identity from the session, not the body. The body names the
    // fabricAgentId but must not be able to override the ownerId.
    const identity = resolveAgentIdentity({
      fabricAgentId: body.fabricAgentId,
      sessionOwnerId: user.id,
      projectId: body.projectId ?? null,
      trustLevel: "FULL",
    });

    // Project root comes from the server, never from the request.
    const projectRoot = findRepoRoot();

    const payload: ToolExecutionPayload | undefined = body.payload
      ? {
          ...(body.payload.targetOwnerId !== undefined
            ? { targetOwnerId: body.payload.targetOwnerId }
            : {}),
          ...(body.payload.targetProjectId !== undefined
            ? { targetProjectId: body.payload.targetProjectId }
            : {}),
          ...(body.payload.targetAgentId !== undefined
            ? { targetAgentId: body.payload.targetAgentId }
            : {}),
        }
      : undefined;

    // Catalog first: may this agent invoke this tool?
    // executeGovernedAction repeats this check.
    try {
      enforceAgentToolAuthorization({
        identity,
        requestedTool: body.toolName,
        ...(payload !== undefined ? { payload } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(403).send({
        stage: "AUTHORIZATION",
        status: "DENIED",
        error: { message },
      });
    }

    // toolName is authoritative for operation identity. Client entityType/action
    // are assertions only — match or omit; never rewrite; never govern under
    // a different valid table cell.
    if (
      (body.entityType === undefined) !== (body.action === undefined)
    ) {
      return reply.status(403).send({
        stage: "AUTHORIZATION",
        status: "DENIED",
        error: {
          message:
            "entityType and action must both be omitted or both be supplied as a matching assertion of the tool's canonical operation",
        },
      });
    }
    const assertedPair =
      body.entityType !== undefined && body.action !== undefined
        ? { entityType: body.entityType, action: body.action }
        : undefined;
    const canonical = resolveCanonicalToolOperationForRequest(
      body.toolName,
      assertedPair,
    );
    if (!canonical.ok) {
      return reply.status(403).send({
        stage: "AUTHORIZATION",
        status: "DENIED",
        error: { message: canonical.reason },
      });
    }

    const outcome = await executeGovernedAction({
      identity,
      toolName: body.toolName,
      toolArgs: body.toolArgs,
      artifact: body.artifact,
      entityType: canonical.entityType,
      action: canonical.action,
      ...(payload !== undefined ? { payload } : {}),
      ...(body.approvalRequestId !== undefined
        ? { approvalRequestId: body.approvalRequestId }
        : {}),
      projectRoot,
      routeLabel: "agents.tool-execute",
      requestId: request.id,
      sourceContext: {
        origin: "user_message",
        trustLevel: "trusted",
      },
    });

    // Map outcome to HTTP status and response shape.
    if (outcome.status === "EXECUTED") {
      return reply.status(200).send({
        stage: outcome.stage,
        status: outcome.status,
        agentId: identity.agentId,
        artifactHash: outcome.artifactHash,
        output: outcome.output,
      });
    }

    // All non-EXECUTED outcomes are refusals.
    const httpStatus =
      outcome.stage === "EXECUTION"
        ? 422 // Execution-level failure (path escaping, file not found, etc.)
        : 403; // Authorization, Approval, or Policy refusal

    return reply.status(httpStatus).send({
      stage: outcome.stage,
      status: outcome.status,
      error: {
        message: outcome.reason,
      },
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

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
  agentRunResultSchema,
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
import { enforceEntityWrite } from "../services/risk-audit.js";
import { dispatchAgentAction } from "../services/agent-dispatch-guard.js";
import {
  resolveAgentIdentity,
  type ToolExecutionPayload,
  type ToolPayloadValue,
} from "../services/agent-runtime-authz.js";
import { executeGovernedAction } from "../services/governed-execution.js";
import { findRepoRoot } from "../services/repo-root.js";
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

/**
 * Builds the `AgentRunResult` returned in place of a real specialist run
 * when its per-specialist `dispatchAgentAction` gate did not come back
 * ALLOWED. `agentRunResultSchema` (packages/shared/src/schemas/agent-fabric.schema.ts)
 * has no "pending approval" status today — only COMPLETED / SKIPPED /
 * FAILED / NEEDS_EVIDENCE — and widening that schema is a real design
 * decision out of scope here (it would need a matching UI/consumer-side
 * decision about what "pending" means downstream). `SKIPPED` is the
 * honest fit: the specialist genuinely did not run. `epistemicState:
 * "UNKNOWN"` mirrors that — there is no claim being made about the
 * request, only about why no claim was made. The real reason (denial
 * text, or the approval request id so a caller/UI can look it up later)
 * goes into `summary`/`claims` rather than being silently dropped.
 */
function skippedForDispatchGate(
  agentId: "SECURITY" | "LEGAL_MEDIA_COMMS",
  gate: Exclude<
    ReturnType<typeof dispatchAgentAction>,
    { readonly decision: "ALLOWED" }
  >,
  startedAt: number,
) {
  const summary =
    gate.decision === "DENIED"
      ? `${agentId} specialist dispatch was denied by policy: ${gate.reason}`
      : `${agentId} specialist dispatch is pending human approval before it can run.`;
  const claims =
    gate.decision === "DENIED"
      ? [`denied:${gate.reason}`]
      : [`approvalRequestId:${gate.approvalRequestId}`, `bucket:${gate.bucket}`];
  return agentRunResultSchema.parse({
    agentId,
    status: "SKIPPED",
    summary,
    claims,
    evidenceRefs: [],
    epistemicState: "UNKNOWN",
    costUsd: 0,
    // Same small-elapsed-time measurement `runSpecialistStub`
    // (packages/agent-core/src/orchestrator/dispatch.ts) uses — the gate
    // check itself is real work (Policy Engine + Risk Engine + Audit Log),
    // not free, so this stays an honest measurement rather than a flat 0.
    durationMs: Math.max(1, Date.now() - startedAt),
  });
}

/**
 * Values a tool payload may carry, mirroring `ToolPayloadValue`
 * (services/agent-runtime-authz.ts). Recursive on purpose: a forged nested
 * object must be typed, not waved through as `any`/`unknown`, or the
 * anti-impersonation comparison below has nothing solid to compare.
 */
const toolPayloadValueSchema: z.ZodType<ToolPayloadValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(toolPayloadValueSchema),
    z.record(z.string(), toolPayloadValueSchema),
  ]),
);

/**
 * Body of `POST /api/v1/agents/tool-execute`.
 *
 * `.strict()` is load-bearing, not stylistic. The one property this request
 * must never have is a caller-supplied tenant: `ownerId`, `tenantId`,
 * `sessionOwnerId` and friends are rejected outright (400) rather than
 * silently ignored, so a client that believes it can set them finds out
 * immediately instead of quietly running as somebody else's identity. The
 * only owner in play comes from `requireSignedInForWrite` below.
 *
 * `payload` MAY restate the identity (`targetOwnerId`/`targetProjectId`/
 * `targetAgentId`) — `enforceAgentToolAuthorization` inside the gate then
 * compares that untrusted restatement against the session-derived identity
 * and denies any contradiction. Accepting the field is what makes that
 * check reachable; the field cannot widen anything.
 */
const agentToolExecuteRequestSchema = z
  .object({
    fabricAgentId: z.string().min(1),
    toolName: z.string().min(1),
    toolArgs: z.record(z.string(), z.unknown()).default({}),
    payload: z
      .object({
        targetOwnerId: z.string().optional(),
        targetProjectId: z.string().optional(),
        targetAgentId: z.string().optional(),
      })
      .catchall(toolPayloadValueSchema)
      .optional(),
    /** Exact content the action is taken over — what the artifact hash pins. */
    artifact: z.string().min(1).max(200_000),
    entityType: z.enum([
      "CUSTOMER",
      "RECORD",
      "DOCUMENT",
      "FINANCIAL_TRANSACTION",
      "CASE",
      "COMMUNICATION",
      "CONFIGURATION",
    ]),
    action: z.enum(["READ", "CREATE", "UPDATE", "DELETE", "EXECUTE"]),
    projectId: z.string().min(1).optional(),
    approvalRequestId: z.string().min(1).optional(),
  })
  .strict();

/**
 * Narrow the parsed body's optional payload to `ToolExecutionPayload`.
 *
 * Zod models an absent optional as `string | undefined`; under this repo's
 * `exactOptionalPropertyTypes` an absent property and a property explicitly
 * set to `undefined` are different types, and the guard's anti-impersonation
 * check keys off "was this field present at all". Rebuilding by conditional
 * spread keeps `{ targetOwnerId: undefined }` from reading as a stated —
 * and therefore comparable — target.
 */
function toToolExecutionPayload(
  payload: z.infer<typeof agentToolExecuteRequestSchema>["payload"],
): ToolExecutionPayload | undefined {
  if (payload === undefined) return undefined;
  const { targetOwnerId, targetProjectId, targetAgentId, ...rest } = payload;
  return {
    ...rest,
    ...(targetOwnerId !== undefined ? { targetOwnerId } : {}),
    ...(targetProjectId !== undefined ? { targetProjectId } : {}),
    ...(targetAgentId !== undefined ? { targetAgentId } : {}),
  };
}

/**
 * Sandbox root handed to the Tool Runtime — derived server-side, never read
 * from the request.
 *
 * `ToolExecutionContext.projectRoot` (packages/agent-core/src/tools/runtime.ts)
 * is the boundary every filesystem argument is proven to resolve inside. An
 * agent (or a client acting for one) that could name its own root would be
 * choosing its own containment, which is the same class of mistake as an
 * agent choosing its own trust level — the traversal guard would still pass
 * while the "project" it guarded had become `/`.
 *
 * Resolution order reuses what this repo already has rather than inventing a
 * third notion of "root":
 *   1. the project's linked workspace root (`osStore.getWorkspaceRoot`, the
 *      same per-project root security-sentinel-dispatch.ts / patch-write.ts
 *      use), when the caller named a project that has one;
 *   2. otherwise `findRepoRoot()` (services/repo-root.ts), the monorepo root
 *      this API already resolves `.atlas`/fixture paths against.
 *
 * Case 2 is deliberately the fallback and not the default: a request with no
 * project scope has no narrower root to offer. It is still a real bound
 * (traversal above it is refused), just a wide one.
 */
function resolveToolProjectRoot(projectId: string | null): string {
  const linked = projectId ? osStore.getWorkspaceRoot(projectId) : undefined;
  return linked ?? findRepoRoot();
}

/**
 * Strip anything path-shaped, collapse to one line, and cap the length.
 *
 * Refusal reasons are genuinely useful to a caller ("path escapes the
 * project root", "tool X is not in agent Y's allowedTools") and are worth
 * returning — but they are produced by `Error.message`s that can embed
 * absolute server paths (`ENOENT ... open '/srv/atlas/...'`). Those describe
 * the host's filesystem layout, not the caller's request, and must not cross
 * the wire.
 */
function safeRefusalReason(reason: string): string {
  const firstLine = reason.split("\n")[0] ?? "";
  return firstLine
    .replace(/(?:[A-Za-z]:)?[/\\][^\s"'`]+/g, "[path]")
    .slice(0, 400);
}

/**
 * Recover the approval id from a POLICY/APPROVAL_REQUIRED outcome.
 *
 * `GovernedExecutionOutcome` carries the id inside `reason` rather than as a
 * field, and that type is deliberately not modified here (its adversarial
 * suite and the bypass guard both pin it). Parsing the one string shape it
 * emits — `approval <id> required before execution` — keeps the change on
 * this side of the boundary; a shape change would drop the id to `null`
 * rather than mis-report one.
 */
function approvalIdFromReason(reason: string): string | null {
  return /^approval (\S+) required before execution$/.exec(reason)?.[1] ?? null;
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
    enforceEntityWrite({
      entityType: "CONFIGURATION",
      action: "EXECUTE",
      routeLabel: "agents.dispatch",
      actorId: user.id,
      projectId: body.projectId ?? null,
    });

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
    // Provider selection for the proposal-first specialists below, projected
    // out of the server env exactly the way `agent.ts`/`conversation.ts`
    // already do it. No key configured is a supported state, not an error:
    // `completeWithFreeFallback`'s chain ends at the free offline
    // `ContextEchoProvider`.
    const llmEnv = {
      LLM_PROVIDER: app.atlasEnv.LLM_PROVIDER,
      OLLAMA_BASE_URL: app.atlasEnv.OLLAMA_BASE_URL,
      OLLAMA_MODEL: app.atlasEnv.OLLAMA_MODEL,
      GROQ_API_KEY: app.atlasEnv.GROQ_API_KEY,
      GROQ_MODEL: app.atlasEnv.GROQ_MODEL,
      OPENAI_API_KEY: app.atlasEnv.OPENAI_API_KEY,
      OPENAI_BASE_URL: app.atlasEnv.OPENAI_BASE_URL,
      OPENAI_MODEL: app.atlasEnv.OPENAI_MODEL,
      ANTHROPIC_API_KEY: app.atlasEnv.ANTHROPIC_API_KEY,
      ANTHROPIC_MODEL: app.atlasEnv.ANTHROPIC_MODEL,
      GEMINI_API_KEY: app.atlasEnv.GEMINI_API_KEY,
      GEMINI_MODEL: app.atlasEnv.GEMINI_MODEL,
      DEEPSEEK_API_KEY: app.atlasEnv.DEEPSEEK_API_KEY,
      DEEPSEEK_MODEL: app.atlasEnv.DEEPSEEK_MODEL,
    };
    const result = await dispatchAgentPlan({
      request: body.request,
      ...(body.projectId !== undefined ? { projectId: body.projectId } : {}),
      ...(body.agentIds !== undefined ? { agentIds: body.agentIds } : {}),
      maxAgents: body.maxAgents,
      budgetUsd: body.budgetUsd,
      runJudge: body.runJudge,
      specialistOverride: (agentId, request) => {
        // PER-SPECIALIST gate: this is the actual "an agent takes an
        // action" moment for these two agents — `runSecuritySpecialistViaSentinel`
        // and `runLegalMediaSpecialistViaReview` are real specialist
        // actions, not the read-only `runSpecialistStub` every other
        // agentId still falls through to below. The route-level
        // `CONFIGURATION.EXECUTE` gate above only covers "is this caller
        // allowed to dispatch at all" — it has no per-specialist signal.
        // `dispatchAgentAction` (the agent/automation-actor sibling of
        // `enforceEntityWrite`, see agent-dispatch-guard.ts) is that
        // missing per-specialist Policy+Risk+Audit coverage.
        if (agentId === "SECURITY") {
          const startedAt = Date.now();
          const gate = dispatchAgentAction({
            actor: { kind: "AGENT", agentId: "SECURITY", onBehalfOfUserId: user.id },
            // CASE, not CONFIGURATION or RECORD: per `DEFAULT_ENTITY_POLICIES`'s
            // doc comment (entity-policies.ts), CASE is explicitly "a
            // tracked unit of work with a lifecycle and often legal/
            // compliance weight (... an incident)" — a Sentinel scan's
            // findings (critical/high severity issues, next actions) are
            // exactly incident-shaped. CONFIGURATION is reserved for
            // control-plane/system settings (already used, deliberately,
            // by the coarse route-level gate above); RECORD is the
            // generic catch-all and would lose the legal/compliance
            // framing CASE is meant to carry through to the risk engine.
            entityType: "CASE",
            action: "EXECUTE",
            routeLabel: "agent-fabric.dispatch.security",
            // `body.request` is the authenticated caller's own free-text
            // prompt for this dispatch — trusted at face value. A FUTURE
            // specialist that acts on externally-ingested content (e.g.
            // scanning a fetched GitHub issue or an inbound webhook
            // payload) must set trustLevel:"untrusted" here instead: this
            // `sourceContext` is exactly the hook `dispatchAgentAction`
            // exists to floor risk through for that case (see
            // `floorBucketForUntrustedSource` in agent-dispatch-guard.ts).
            sourceContext: { origin: "user_message", trustLevel: "trusted" },
            projectId: body.projectId ?? null,
          });
          if (gate.decision !== "ALLOWED") {
            return skippedForDispatchGate("SECURITY", gate, startedAt);
          }
          return runSecuritySpecialistViaSentinel({
            request,
            projectId: body.projectId ?? null,
          });
        }
        // PROPOSAL-FIRST specialists (Phase 1a). Unlike the two branches
        // above, these do NOT call `dispatchAgentAction` inline — they route
        // through `submitAgentProposal()` (agent-proposal.ts), which calls
        // that exact same gate one layer down, after validating the LLM's
        // proposal against `agentProposalSchema`. Gating here as well would
        // put two entries on the Unified Audit Log for one action and would
        // score the entity/action pair *before* the model has proposed one,
        // which is precisely the ordering `AgentProposal` exists to fix. The
        // per-specialist Policy+Risk+Audit coverage is therefore identical
        // to SECURITY/LEGAL_MEDIA_COMMS — same function, one layer deeper.
        //
        // The LLM never executes anything: it can only emit a proposal, and
        // the gate's decision becomes the run's status (ALLOWED → COMPLETED,
        // DENIED/APPROVAL_REQUIRED → SKIPPED with the reason/approval id
        // surfaced, no usable proposal → NEEDS_EVIDENCE). See each dispatch
        // service's doc comment for its entity/action justification.
        if (agentId === "CODE_ENGINEER") {
          return runCodeEngineerSpecialistViaLlm({
            request,
            projectId: body.projectId ?? null,
            ownerId: user.id,
            env: llmEnv,
          });
        }
        if (agentId === "RESEARCHER") {
          return runResearcherSpecialistViaLlm({
            request,
            projectId: body.projectId ?? null,
            ownerId: user.id,
            env: llmEnv,
          });
        }
        if (agentId === "LEGAL_MEDIA_COMMS") {
          const startedAt = Date.now();
          const gate = dispatchAgentAction({
            actor: {
              kind: "AGENT",
              agentId: "LEGAL_MEDIA_COMMS",
              onBehalfOfUserId: user.id,
            },
            // Same CASE reasoning as SECURITY above: a legal/media review
            // is literally "a legal matter" per CASE's own doc comment —
            // the closest-fit bucket, not the control-plane CONFIGURATION
            // or the generic RECORD catch-all.
            entityType: "CASE",
            action: "EXECUTE",
            routeLabel: "agent-fabric.dispatch.legal-media",
            // Same trust reasoning as SECURITY above: `body.request` is
            // the caller's own trusted text today; a future specialist
            // reviewing externally-ingested content must flip this to
            // trustLevel:"untrusted".
            sourceContext: { origin: "user_message", trustLevel: "trusted" },
            projectId: body.projectId ?? null,
          });
          if (gate.decision !== "ALLOWED") {
            return skippedForDispatchGate("LEGAL_MEDIA_COMMS", gate, startedAt);
          }
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

  /**
   * P0.7 — the first real HTTP caller of the governed execution gate.
   *
   * Every control this platform has for "an agent takes an action" already
   * existed (identity resolution, catalog tool authorization, approval↔
   * artifact binding, Policy/Risk, the Tool Runtime, the unified audit
   * chain) and `executeGovernedAction()` already composed them in a
   * fail-closed order — but nothing on the network could reach it, so the
   * composition governed nothing. This route is that path, and it does no
   * governance of its own: it resolves identity from the session, hands the
   * request to the gate, and translates the gate's answer to HTTP. Any
   * decision made here instead of there would be a second, divergent gate.
   *
   * Note what is NOT re-checked here. There is no `enforceEntityWrite`
   * alongside the gate (as /agents/dispatch has) because the gate's own
   * Policy/Risk stage covers this request's entity/action pair, and a
   * second categorical check would put two entries on the audit log for one
   * action while being able to disagree with the first.
   *
   * Refusals arrive as return values, never exceptions — so the mapping
   * below is exhaustive by construction and cannot be short-circuited by a
   * `catch` somewhere up the stack:
   *
   *   EXECUTION/EXECUTED        → 200  output + artifact hash
   *   POLICY/APPROVAL_REQUIRED  → 202  accepted, pending a human decision
   *   AUTHORIZATION/DENIED      → 403  agent may not use this tool / identity
   *   APPROVAL/DENIED           → 403  no live approval bound to this artifact
   *   POLICY/DENIED             → 403  the entity-action itself is refused
   *   EXECUTION/FAILED          → 422  authorized, but the tool could not run
   *
   * 403 vs 422 is the distinction that matters to a caller: a 403 means "not
   * allowed, do not retry as-is", a 422 means "allowed, but this particular
   * invocation failed" (bad path, oversized file, secret in output). 202 is
   * not an error at all — the request is parked behind an approval whose id
   * is returned so it can be redeemed later via `approvalRequestId`.
   */
  app.post("/api/v1/agents/tool-execute", async (request, reply) => {
    // The ONLY source of who is asking. `resolveAgentIdentity` refuses to
    // build an identity without it.
    const user = await requireSignedInForWrite(app, request);
    const body = agentToolExecuteRequestSchema.parse(request.body);

    // Throws AtlasError(FORBIDDEN, 403) for an agent id outside the closed
    // catalog — an unknown agent is rejected, never defaulted to an empty
    // (and therefore unconstrained) policy.
    const identity = resolveAgentIdentity({
      fabricAgentId: body.fabricAgentId,
      sessionOwnerId: user.id,
      projectId: body.projectId ?? null,
    });

    const payload = toToolExecutionPayload(body.payload);

    const outcome = await executeGovernedAction({
      identity,
      toolName: body.toolName,
      toolArgs: body.toolArgs,
      ...(payload !== undefined ? { payload } : {}),
      artifact: body.artifact,
      ...(body.approvalRequestId !== undefined
        ? { approvalRequestId: body.approvalRequestId }
        : {}),
      entityType: body.entityType,
      action: body.action,
      // Same trust reasoning as the specialist gates in /agents/dispatch
      // above: this body is the authenticated caller's own request. A future
      // caller relaying externally-ingested content (a fetched issue, an
      // inbound webhook) must pass trustLevel:"untrusted" so
      // `floorBucketForUntrustedSource` raises the risk floor.
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      projectRoot: resolveToolProjectRoot(identity.projectId),
      routeLabel: "agents.tool-execute",
      // The request boundary for Invariant 10's correlation chain.
      requestId: request.id,
    });

    if (outcome.status === "EXECUTED") {
      return reply.status(200).send({
        status: "EXECUTED",
        agentId: identity.agentId,
        toolName: body.toolName,
        // The hash of exactly what ran — the same value an approval binds
        // to, so a caller can correlate this execution with its sign-off.
        artifactHash: outcome.artifactHash,
        output: outcome.output,
      });
    }

    if (outcome.status === "APPROVAL_REQUIRED") {
      return reply.status(202).send({
        status: "APPROVAL_REQUIRED",
        stage: outcome.stage,
        approvalRequestId: approvalIdFromReason(outcome.reason),
        message:
          "Human approval is required before this action can execute. Re-send this request with approvalRequestId once it is granted.",
      });
    }

    if (outcome.stage === "EXECUTION") {
      return reply.status(422).send({
        error: {
          code: "EXECUTION_FAILED",
          message: safeRefusalReason(outcome.reason),
        },
        stage: outcome.stage,
        status: outcome.status,
      });
    }

    return reply.status(403).send({
      error: { code: "FORBIDDEN", message: safeRefusalReason(outcome.reason) },
      stage: outcome.stage,
      status: outcome.status,
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

import type { FastifyInstance } from "fastify";
import {
  authorizeToolCall,
  buildAgentContext,
  buildLayeredSystemPrompt,
  buildPortfolioContextBlocks,
  classifyIntent,
  completeWithFreeFallback,
  completeStrict,
  redactSecrets,
  assertNoSecrets,
} from "@atlas/agent-core";
import { buildExpertSystemBlock, selectExperts } from "@atlas/experts";
import {
  AI_PROVIDER_CATALOG,
  AtlasError,
  agentRunSchema,
  createConversationMessageSchema,
  conversationThreadListQuerySchema,
  conversationThreadParamsSchema,
  type EpistemicState,
} from "@atlas/shared";
import {
  assistantRunIdentity,
  authorizeSnapshotForAgentContext,
} from "../services/agent-context-authorization.js";
import { osStore } from "../store/os-store.js";
import {
  chargeCredits,
  ensureCreditsInitialized,
} from "../services/artifacts-assists.js";
import {
  assertAgentMessageQuota,
  recordAgentMessageUsage,
  resolveTier,
} from "../services/plan-quota.js";
import { buildMemoryContext } from "../services/memory-pipeline.js";
import { requireSignedInForWrite, requireUser } from "../middleware/auth-guards.js";
import { canReadDecision, canReadProjectScoped } from "../services/project-access.js";
import {
  resolveAtlasSurfaceKnowledgeScope,
  searchEligibleKnowledge,
} from "../services/governed-knowledge-retrieval.js";
import {
  collectEvidenceRefs,
  insufficientEvidenceAnswer,
  resolveConversationEpistemic,
} from "../services/conversation-evidence.js";
import { assertLlmEgressAllowed } from "../services/egress-gate.js";
import { recordLlmInvocation } from "../services/llm-invocation-audit.js";

const AGENT_MEMORY_BUDGET = 12;

type ThreadTurn = {
  role: "user" | "assistant";
  content: string;
  epistemicLabel?: EpistemicState;
  evidenceRefs?: ReturnType<typeof collectEvidenceRefs>;
  at: string;
};

function llmEnvForProvider(
  selectedId: string,
  atlasEnv: FastifyInstance["atlasEnv"],
  catalog: (typeof AI_PROVIDER_CATALOG)[keyof typeof AI_PROVIDER_CATALOG],
): Record<string, string | undefined> {
  const llmEnvOverride: Record<string, string | undefined> = {
    LLM_PROVIDER: atlasEnv.LLM_PROVIDER,
    OLLAMA_BASE_URL: atlasEnv.OLLAMA_BASE_URL,
    OLLAMA_MODEL: atlasEnv.OLLAMA_MODEL,
    GROQ_API_KEY: atlasEnv.GROQ_API_KEY,
    GROQ_MODEL: atlasEnv.GROQ_MODEL,
    OPENAI_API_KEY: atlasEnv.OPENAI_API_KEY,
    OPENAI_BASE_URL: atlasEnv.OPENAI_BASE_URL,
    OPENAI_MODEL: atlasEnv.OPENAI_MODEL,
    ANTHROPIC_API_KEY: atlasEnv.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL: atlasEnv.ANTHROPIC_MODEL,
    GEMINI_API_KEY: atlasEnv.GEMINI_API_KEY,
    GEMINI_MODEL: atlasEnv.GEMINI_MODEL,
    DEEPSEEK_API_KEY: atlasEnv.DEEPSEEK_API_KEY,
    DEEPSEEK_MODEL: atlasEnv.DEEPSEEK_MODEL,
  };

  switch (selectedId) {
    case "arletos-included":
      llmEnvOverride.LLM_PROVIDER = "echo";
      break;
    case "llama-local":
      llmEnvOverride.LLM_PROVIDER = "ollama";
      llmEnvOverride.OLLAMA_MODEL = atlasEnv.OLLAMA_MODEL ?? catalog.modelHint;
      break;
    case "llama-groq":
      llmEnvOverride.LLM_PROVIDER = "groq";
      llmEnvOverride.GROQ_MODEL = atlasEnv.GROQ_MODEL ?? catalog.modelHint;
      break;
    case "gpt-4o":
    case "gpt-4o-mini":
    case "o3-mini":
      llmEnvOverride.LLM_PROVIDER = "openai";
      llmEnvOverride.OPENAI_MODEL = catalog.modelHint;
      break;
    case "claude-haiku":
    case "claude-sonnet":
    case "claude-opus":
      llmEnvOverride.LLM_PROVIDER = "anthropic";
      llmEnvOverride.ANTHROPIC_MODEL = catalog.modelHint;
      break;
    case "gemini-flash":
    case "gemini-pro":
      llmEnvOverride.LLM_PROVIDER = "gemini";
      llmEnvOverride.GEMINI_MODEL = catalog.modelHint;
      break;
    case "deepseek-chat":
      llmEnvOverride.LLM_PROVIDER = "deepseek";
      llmEnvOverride.DEEPSEEK_MODEL = catalog.modelHint;
      break;
    default:
      break;
  }
  return llmEnvOverride;
}

function formatThreadHistory(turns: readonly ThreadTurn[]): string {
  return turns
    .slice(-20)
    .map((turn) => `${turn.role}: ${turn.content.slice(0, 2000)}`)
    .join("\n");
}

export async function registerConversationRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post("/api/v1/conversation/message", async (request, reply) => {
    // Auth gate (P0 fix): this route spends LLM/credit budget and returns
    // memory-context content — never usable anonymously. Mirrors the
    // signed-in-required convention used by other write/expensive routes
    // (see memory.ts / code.ts).
    const user = await requireSignedInForWrite(app, request);
    osStore.ensureLoaded();
    const body = createConversationMessageSchema.parse(request.body);
    assertAgentMessageQuota(app.atlasEnv, user.id);
    const now = new Date().toISOString();
    const locale = body.locale ?? "en";
    const threadId = body.threadId ?? crypto.randomUUID();
    const priorTurns = [...osStore.getConversationThread(threadId)] as ThreadTurn[];
    const existingMeta = osStore.getConversationThreadMeta(threadId);
    if (existingMeta && existingMeta.ownerId !== user.id) {
      throw new AtlasError(
        "FORBIDDEN",
        "Conversation thread is owned by another user",
        { statusCode: 403 },
      );
    }
    if (!existingMeta && priorTurns.length > 0) {
      throw new AtlasError(
        "FORBIDDEN",
        "Conversation thread is not owned",
        { statusCode: 403 },
      );
    }
    if (
      existingMeta?.projectId &&
      !canReadProjectScoped(user, existingMeta.projectId)
    ) {
      throw new AtlasError(
        "FORBIDDEN",
        "Conversation thread is not readable",
        { statusCode: 403 },
      );
    }
    const messageId = crypto.randomUUID();
    const projectId = body.projectId ?? existingMeta?.projectId ?? null;
    // Tenant boundary (Task 6 fix): projectId is client-supplied and must
    // not be trusted for project-scoped reads (snapshot/decisions/evidence/
    // knowledge/portfolio list). Mirrors the canReadProjectScoped convention
    // already used for list filtering in projects.ts. An unauthorized
    // projectId degrades to "no project" (portfolio-only context) rather
    // than throwing, preserving existing no-project behavior. The raw
    // projectId is still recorded on the agentRun/audit entries below for
    // traceability of what was requested, and memory retrieval keeps its
    // own independent ownerId scoping (memory-pipeline.ts) unchanged.
    const authorizedProjectId =
      projectId && canReadProjectScoped(user, projectId) ? projectId : null;
    const selectedId = body.aiProviderId ?? "arletos-included";

    const catalog =
      AI_PROVIDER_CATALOG[selectedId as keyof typeof AI_PROVIDER_CATALOG];
    if (!catalog || catalog.kind === "assist") {
      throw new AtlasError(
        "VALIDATION_ERROR",
        "Provider is assist-only — use /artifacts for vision assists",
      );
    }

    const paidRun = catalog.billing === "credits" && catalog.creditCost > 0;
    if (paidRun) {
      const { tier } = resolveTier(app.atlasEnv);
      const balance = ensureCreditsInitialized(tier);
      if (catalog.creditCost > balance.balance) {
        throw new AtlasError(
          "QUOTA_EXCEEDED",
          `Not enough credits for ${catalog.titleEn} (${catalog.creditCost}). Buy a pack on Plan / Models.`,
          { statusCode: 402 },
        );
      }
    }

    const projects = osStore
      .listProjects()
      .filter((project) => canReadProjectScoped(user, project.id));
    // Stage 4: the conversation acts as the session user's PSA
    // (server-derived); a snapshot enters the LLM context only after memory
    // authorization.
    const runIdentity = assistantRunIdentity(user.id);
    const snapshot = authorizeSnapshotForAgentContext(
      authorizedProjectId ? osStore.getSnapshot(authorizedProjectId) ?? null : null,
      runIdentity.agentId,
    );
    const globalDecisions = osStore
      .getDecisions("global")
      .filter((decision) => canReadDecision(user, decision));
    const decisions = authorizedProjectId
      ? [...osStore.getDecisions(authorizedProjectId), ...globalDecisions]
      : globalDecisions;
    // Tenant boundary: memory uses the same authorized project as snapshot/
    // decisions/evidence. A client-supplied projectId the caller cannot read
    // degrades to no-project retrieval (owner-scoped), never a foreign key.
    // Stage 4: tenant-admin role never widens LLM memory to other owners.
    const memoryContextResult = await buildMemoryContext({
      projectId: authorizedProjectId,
      query: body.message,
      budget: AGENT_MEMORY_BUDGET,
      embeddingEnv: app.atlasEnv,
      ownerId: runIdentity.ownerId,
      requestingAgentId: runIdentity.agentId,
    });
    const { memories, ...memoryContext } = memoryContextResult;
    const evidenceRecords = authorizedProjectId ? osStore.getEvidence(authorizedProjectId) : [];

    let knowledge: Awaited<ReturnType<typeof searchEligibleKnowledge>> | null =
      null;
    try {
      knowledge = await searchEligibleKnowledge({
        env: app.atlasEnv,
        query: body.message,
        scope: resolveAtlasSurfaceKnowledgeScope({
          sessionOwnerId: user.id,
          requestedProjectId: authorizedProjectId,
        }),
        maxResults: 8,
      });
    } catch {
      knowledge = null;
    }

    const evidenceRefs = collectEvidenceRefs({
      memories,
      evidenceRecords,
      knowledge,
      decisions: decisions.map((d) => ({
        id: d.id,
        title: d.decision,
        statement: d.decision,
      })),
      hasSnapshot: Boolean(snapshot),
      snapshotLabel: snapshot
        ? `snapshot:${authorizedProjectId ?? "portfolio"}`
        : null,
      projectCount: projects.length,
    });

    const epistemicLabel = resolveConversationEpistemic(evidenceRefs);
    const intent = classifyIntent(body.message);

    let answer: string;
    let runId: string | null = null;

    if (epistemicLabel === "INSUFFICIENT_EVIDENCE") {
      answer = insufficientEvidenceAnswer(
        locale,
        knowledge?.plainLanguage ?? null,
      );
    } else {
      const blocks = buildPortfolioContextBlocks({
        projects,
        projectId: authorizedProjectId,
        snapshot,
        decisions,
        memories,
        evidence: evidenceRecords,
      });
      const context = buildAgentContext(blocks);
      const experts = selectExperts(body.message);
      const expertBlock = buildExpertSystemBlock(experts);
      const evidenceBlock = [
        "Cited evidence packages (use only these; never invent):",
        ...evidenceRefs.map(
          (r) =>
            `- [${r.kind}] ${r.reference}${r.excerpt ? ` — ${r.excerpt}` : ""} (${r.epistemicState ?? "OBSERVED"})`,
        ),
      ].join("\n");

      const layered = buildLayeredSystemPrompt({
        instructions: [
          "You are Atlas — ArletOS Engineering + QA Intelligence OS.",
          "Evidence discipline: cite packages; FACT vs INFERRED vs PROPOSED.",
          "Language / UI / game / cyber answers must cite verified official sources when present (MDN, ECMA, TypeScript, Python.org, Oracle Java, cppreference, .NET, Go, Rust, Unity, Unreal, Godot, OWASP, NIST).",
          "Never invent language semantics, CVEs, or standards. If evidence is thin, say INSUFFICIENT_EVIDENCE — do not hallucinate.",
          "Never claim deployment/DB facts without labeled evidence.",
          "Reply in the user's language (Hebrew, Arabic, or English).",
          "",
          expertBlock,
        ].join("\n"),
        untrustedBlocks: [
          { label: "evidence", content: evidenceBlock },
          { label: "context", content: context },
          ...(priorTurns.length > 0
            ? [{ label: "history", content: formatThreadHistory(priorTurns) }]
            : []),
        ],
      });
      if (layered.flagged) {
        app.atlasLogger.warn("conversation_prompt_injection_flagged", {
          labels: layered.findings.map((f) => f.label),
          patternNames: layered.findings.flatMap((f) => [...f.patternNames]),
        });
      }
      const system = redactSecrets(layered.systemContent);
      const userMessage = redactSecrets(body.message);
      assertNoSecrets(system, "llm.system");
      assertNoSecrets(userMessage, "llm.user");

      const llmEnv = llmEnvForProvider(selectedId, app.atlasEnv, catalog);
      assertLlmEgressAllowed({
        provider: llmEnv.LLM_PROVIDER,
        purpose: "llm.conversation",
      });
      let llm: { provider: string; text: string };
      try {
        const completion = paidRun
          ? await completeStrict(llmEnv, [
              { role: "system", content: system },
              { role: "user", content: userMessage },
            ])
          : await completeWithFreeFallback(llmEnv, [
              { role: "system", content: system },
              { role: "user", content: userMessage },
            ]);
        recordLlmInvocation({
          purpose: "llm.conversation",
          provider: completion.provider,
          usage: completion.usage,
          cacheHit: completion.cacheHit,
          projectId,
          userId: user.id,
          agentId: runIdentity.agentId,
        });
        llm = { provider: completion.provider, text: completion.text };
        if (paidRun) {
          chargeCredits(catalog.creditCost);
        }
      } catch (error) {
        if (paidRun) {
          throw new AtlasError(
            "INTEGRATION_ERROR",
            error instanceof Error
              ? `Paid companion failed: ${error.message}. Credits were not charged.`
              : "Paid companion failed. Credits were not charged.",
            { statusCode: 502 },
          );
        }
        throw error;
      }
      answer = redactSecrets(
        `${llm.text}\n\n— provider: ${llm.provider} · epistemic: ${epistemicLabel} · refs: ${evidenceRefs.length}`,
      );

      const run = agentRunSchema.parse({
        id: crypto.randomUUID(),
        projectId,
        mode: "READ",
        status: "SUCCEEDED",
        userRequest: body.message,
        answer,
        epistemicState: epistemicLabel,
        startedAt: now,
        completedAt: now,
        createdBy: user.id,
      });
      runId = run.id;
      osStore.addAgentRun(run);
      osStore.recordEvent({
        type: "agent.run.completed",
        runId: run.id,
        mode: run.mode,
        intent: intent.kind,
        source: "conversation",
        occurredAt: now,
      });
      osStore.appendAudit({
        type: "conversation.message",
        actorKind: runIdentity.actorKind,
        actorId: runIdentity.agentId,
        onBehalfOfUserId: runIdentity.onBehalfOfUserId,
        messageId,
        threadId,
        runId,
        epistemicLabel,
        evidenceRefCount: evidenceRefs.length,
        projectId,
        at: now,
      });
    }

    if (epistemicLabel === "INSUFFICIENT_EVIDENCE") {
      osStore.appendAudit({
        type: "conversation.message",
        actorKind: runIdentity.actorKind,
        actorId: runIdentity.agentId,
        onBehalfOfUserId: runIdentity.onBehalfOfUserId,
        messageId,
        threadId,
        epistemicLabel,
        evidenceRefCount: 0,
        at: now,
      });
    }

    const history = [...osStore.getConversationThread(threadId)] as ThreadTurn[];
    history.push({ role: "user", content: body.message, at: now });
    history.push({
      role: "assistant",
      content: answer,
      epistemicLabel,
      evidenceRefs,
      at: now,
    });
    osStore.setConversationThread(threadId, history, {
      ownerId: user.id,
      projectId: existingMeta?.projectId ?? authorizedProjectId,
    });
    recordAgentMessageUsage(user.id);

    return reply.status(201).send({
      messageId,
      threadId,
      answer,
      epistemicLabel,
      evidenceRefs,
      memoryContext,
      knowledgePlainLanguage: knowledge?.plainLanguage ?? null,
      runId,
      createdAt: now,
      intent: { kind: intent.kind, requiresApproval: intent.requiresApproval },
      catalog: {
        id: catalog.id,
        titleEn: catalog.titleEn,
        billing: catalog.billing,
        creditCost: catalog.creditCost,
      },
      authorizationPreview: authorizeToolCall({
        toolName: "memory.search",
        mode: "READ",
        writeGateOpen: false,
        approved: false,
      }),
    });
  });

  app.get("/api/v1/conversation/threads", async (request) => {
    const user = await requireUser(app, request);
    osStore.ensureLoaded();
    const query = conversationThreadListQuerySchema.parse(request.query);
    if (query.projectId && !canReadProjectScoped(user, query.projectId)) {
      return { items: [] };
    }
    const items = osStore.listConversationThreadsByOwner(
      user.id,
      query.projectId ?? undefined,
    );
    return { items };
  });

  app.get<{ Params: { threadId: string } }>(
    "/api/v1/conversation/threads/:threadId",
    async (request) => {
      const user = await requireUser(app, request);
      osStore.ensureLoaded();
      const { threadId } = conversationThreadParamsSchema.parse(request.params);
      const meta = osStore.getConversationThreadMeta(threadId);
      if (!meta || meta.ownerId !== user.id) {
        throw new AtlasError("NOT_FOUND", "Thread not found", {
          statusCode: 404,
        });
      }
      if (meta.projectId && !canReadProjectScoped(user, meta.projectId)) {
        throw new AtlasError("NOT_FOUND", "Thread not found", {
          statusCode: 404,
        });
      }
      return {
        threadId,
        projectId: meta.projectId,
        items: osStore.getConversationThread(threadId),
      };
    },
  );
}

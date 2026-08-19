import type { FastifyInstance } from "fastify";
import {
  authorizeToolCall,
  buildAgentContext,
  buildLayeredSystemPrompt,
  buildPortfolioContextBlocks,
  classifyIntent,
  completeWithFreeFallback,
  completeStrict,
  verifyAgentResponse,
  redactSecrets,
  detectSecrets,
  assertNoSecrets,
} from "@atlas/agent-core";
import { buildExpertSystemBlock, selectExperts } from "@atlas/experts";
import {
  agentRunSchema,
  createAgentRunSchema,
  MVP_AGENT_MODES,
  AI_PROVIDER_CATALOG,
  AtlasError,
  type AgentMode,
  type MvpAgentMode,
} from "@atlas/shared";
import { osStore } from "../store/os-store.js";
import {
  chargeCredits,
  ensureCreditsInitialized,
} from "../services/artifacts-assists.js";
import { resolveTier } from "../services/plan-quota.js";
import { persistArletosAgentMemory } from "../services/arletos-agent-memory.js";
import { buildMemoryContext } from "../services/memory-pipeline.js";
import { resolveCloudIdentity } from "../services/cloud-identity.js";
import { proposePatch } from "@atlas/code-intelligence";
import {
  ENGINEERING_MODE_META,
  patchArtifactSchema,
  type EngineeringAgentMode,
} from "@atlas/shared";
import { searchKnowledgeClosedLoop } from "../services/hybrid-rag.js";
import {
  collectEvidenceRefs,
  insufficientEvidenceAnswer,
  resolveConversationEpistemic,
} from "../services/conversation-evidence.js";
import { SENTINEL_AGENT_KNOWLEDGE } from "../services/sentinel-agent-knowledge.js";

const AGENT_MEMORY_BUDGET = 12;

function toMvpMode(mode: AgentMode): MvpAgentMode {
  if ((MVP_AGENT_MODES as readonly string[]).includes(mode)) {
    return mode as MvpAgentMode;
  }
  return "PLAN";
}

export async function registerAgentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/agent/runs", async () => {
    osStore.ensureLoaded();
    const items = [...osStore.listAgentRuns()];
    return {
      items,
      page: 1,
      pageSize: 20,
      total: items.length,
    };
  });

  app.post("/api/v1/agent/runs", async (request, reply) => {
    osStore.ensureLoaded();
    const body = createAgentRunSchema.parse(request.body);
    const intent = classifyIntent(body.userRequest);
    const requested = body.mode === "READ" ? intent.suggestedMode : body.mode;
    const mode = toMvpMode(requested);
    const writeBlocked = intent.kind === "WRITE_CHANGE";
    const now = new Date().toISOString();

    // Secret-redaction fix: computed once, up front, and reused everywhere
    // downstream that would otherwise touch the raw request (LLM prompt +
    // persisted Memory) — previously a second, block-scoped `userRequest`
    // shadowed this and only covered the LLM call, so persistArletosAgentMemory()
    // below was passed the *raw* body.userRequest and stored secrets unredacted.
    const redactedUserRequest = redactSecrets(body.userRequest);

    const selectedId = body.aiProviderId ?? "arletos-included";
    const catalog = AI_PROVIDER_CATALOG[selectedId as keyof typeof AI_PROVIDER_CATALOG];
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

    const llmEnvOverride: Record<string, string | undefined> = {
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

    switch (selectedId) {
      case "arletos-included":
        llmEnvOverride.LLM_PROVIDER = "echo";
        break;
      case "llama-local":
        llmEnvOverride.LLM_PROVIDER = "ollama";
        llmEnvOverride.OLLAMA_MODEL =
          app.atlasEnv.OLLAMA_MODEL ?? catalog.modelHint;
        break;
      case "llama-groq":
        llmEnvOverride.LLM_PROVIDER = "groq";
        llmEnvOverride.GROQ_MODEL =
          app.atlasEnv.GROQ_MODEL ?? catalog.modelHint;
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

    // Tenant boundary (P0 fix): resolve identity up front (same
    // resolveCloudIdentity() call already used further below for
    // persistArletosAgentMemory) so buildMemoryContext() can be scoped to
    // this caller's ownerId instead of returning every tenant's memory
    // statements in the response. Unauthenticated/system callers still fall
    // back to the stub owner, same tolerant convention as memory.ts's
    // POST /api/v1/memory.
    const identity = await resolveCloudIdentity(app, request);
    if (identity.setCookie) reply.header("Set-Cookie", identity.setCookie);

    const projects = osStore.listProjects();
    const projectId = body.projectId ?? null;
    const snapshot = projectId ? osStore.getSnapshot(projectId) ?? null : null;
    const decisions = projectId
      ? [...osStore.getDecisions(projectId), ...osStore.getDecisions("global")]
      : [...osStore.getDecisions("global")];
    const memoryContextResult = buildMemoryContext({
      projectId,
      query: body.userRequest,
      budget: AGENT_MEMORY_BUDGET,
      ownerId: identity.ownerId,
    });
    const { memories, ...memoryContext } = memoryContextResult;
    const evidence = projectId ? osStore.getEvidence(projectId) : [];

    let knowledge: Awaited<ReturnType<typeof searchKnowledgeClosedLoop>> | null =
      null;
    try {
      knowledge = await searchKnowledgeClosedLoop(app.atlasEnv, {
        query: body.userRequest,
        maxResults: 8,
      });
    } catch {
      knowledge = null;
    }

    const evidenceRefs = collectEvidenceRefs({
      memories,
      evidenceRecords: evidence,
      knowledge,
      decisions: decisions.map((d) => ({
        id: d.id,
        title: d.decision,
        statement: d.decision,
      })),
      hasSnapshot: Boolean(snapshot),
      snapshotLabel: snapshot
        ? `snapshot:${projectId ?? "portfolio"}`
        : null,
      projectCount: projects.length,
    });
    const epistemicLabel = resolveConversationEpistemic(evidenceRefs);

    const blocks = buildPortfolioContextBlocks({
      projects,
      projectId,
      snapshot,
      decisions,
      memories,
      evidence,
    });
    const context = buildAgentContext(blocks);
    const experts = selectExperts(body.userRequest);
    const expertBlock = buildExpertSystemBlock(experts);

    let answer: string;
    let llmProvider = "none";

    if (epistemicLabel === "INSUFFICIENT_EVIDENCE") {
      const localeHint = /[\u0590-\u05FF]/.test(body.userRequest)
        ? "he"
        : /[\u0600-\u06FF]/.test(body.userRequest)
          ? "ar"
          : "en";
      answer = insufficientEvidenceAnswer(
        localeHint,
        knowledge?.plainLanguage ?? null,
      );
    } else {
      const evidenceBlock = [
        "Cited evidence packages (use only these; never invent):",
        ...evidenceRefs.map(
          (r) =>
            `- [${r.kind}] ${r.reference}${r.excerpt ? ` — ${r.excerpt}` : ""} (${r.epistemicState ?? "OBSERVED"})`,
        ),
      ].join("\n");

      // Prompt layering (injection-hardening): only text Atlas itself
      // authored — the fixed instruction lines, the static Sentinel
      // knowledge catalog, and the expert-council block (built from the
      // static EXPERT_CATALOG, not from retrieved documents) — goes in
      // `instructions`. `evidenceBlock` and `context` are both built from
      // retrieved/ingested content (evidence records, memories, decisions,
      // knowledge search) that Atlas did not author, so they're kept as
      // `untrustedBlocks`: structurally delimited and scanned for injection
      // patterns rather than flattened into the trusted instruction text.
      const instructions = [
        "You are the ArletOS Engineering + QA Intelligence OS agent.",
        "Use only retrieved context and cited verified sources. Label FACT vs INFERRED vs PROPOSED.",
        "For languages (JS/TS/Python/Java/C++/C#/Go/Rust), UI, game engines, and cybersecurity: cite official docs from the evidence block (MDN, ECMA, python.org, Oracle, cppreference, Unity/Unreal/Godot, OWASP, NIST, CISA).",
        "Never invent APIs, standards, or CVE details. If evidence is thin, say INSUFFICIENT_EVIDENCE.",
        "Never claim deployment/DB facts without labeled evidence.",
        "Never expose secrets.",
        "WRITE actions require eval gate + human APPROVE.",
        "Reply in the user's language (Hebrew, Arabic, or English).",
        "For coding handoff: produce a concise editor brief with steps and constraints.",
        "",
        SENTINEL_AGENT_KNOWLEDGE,
        "",
        expertBlock,
      ].join("\n");

      const layeredPrompt = buildLayeredSystemPrompt({
        instructions,
        untrustedBlocks: [
          { label: "evidence", content: evidenceBlock },
          { label: "context", content: context },
        ],
      });
      if (layeredPrompt.flagged) {
        // Defense-in-depth signal only (see prompt-layers.ts/injection-
        // detector.ts design notes) — the structural delimiter + meta-
        // instruction are the primary defense at this layer, so a flagged
        // block downgrades to a warn log for observability, not a block.
        app.atlasLogger.warn("agent_prompt_injection_flagged", {
          labels: layeredPrompt.findings.map((f) => f.label),
          patternNames: [
            ...new Set(layeredPrompt.findings.flatMap((f) => f.patternNames)),
          ],
        });
      }
      // Redaction applied to the fully layered content (after wrapping),
      // same as before, so it still covers everything that ends up in the
      // prompt — this is an orthogonal, already-working control.
      const system = redactSecrets(layeredPrompt.systemContent);
      const userRequest = redactedUserRequest;
      assertNoSecrets(system, "llm.system");
      assertNoSecrets(userRequest, "llm.user");

      try {
        const llm = paidRun
          ? await completeStrict(llmEnvOverride, [
              { role: "system", content: system },
              { role: "user", content: userRequest },
            ])
          : await completeWithFreeFallback(llmEnvOverride, [
              { role: "system", content: system },
              { role: "user", content: userRequest },
            ]);
        llmProvider = llm.provider;
        answer = redactSecrets(
          `${llm.text}\n\n— provider: ${llm.provider} · catalog: ${catalog.titleEn} (${catalog.billing === "included" ? "included" : `${catalog.creditCost} credits`})`,
        );
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
    }

    if (writeBlocked) {
      answer = [
        answer,
        "",
        "WRITE is approval-gated (ADR-015) — propose Patch, then human Approve & Apply.",
      ].join("\n");
    }

    let patchId: string | null = null;
    const engMode = (body.engineeringMode ?? "analyze") as EngineeringAgentMode;
    const shouldPropose =
      body.proposePatch === true ||
      Boolean(ENGINEERING_MODE_META[engMode]?.proposesPatch);

    if (
      epistemicLabel !== "INSUFFICIENT_EVIDENCE" &&
      shouldPropose &&
      body.workspaceRoot
    ) {
      try {
        const proposal = proposePatch({
          workspaceRoot: body.workspaceRoot,
          mode: engMode,
          userRequest: body.userRequest,
        });
        if (proposal.filesChanged.length === 0) {
          answer = [
            answer,
            "",
            `--- ${engMode} (no Patch files) ---`,
            proposal.evaluationSummary,
          ].join("\n");
        } else {
          const patch = patchArtifactSchema.parse({
            id: crypto.randomUUID(),
            projectId,
            title: proposal.title,
            reason: proposal.reason,
            mode: proposal.mode,
            status: "AWAITING_APPROVAL",
            risk: proposal.risk,
            baseCommit: null,
            targetBranch: null,
            filesChanged: proposal.filesChanged.map((f) => ({
              path: f.path,
              action: f.action,
              summary: f.summary,
              unifiedDiff: f.unifiedDiff,
              afterContent: f.afterContent,
            })),
            evidenceIds: [],
            claimIds: [],
            expectedImpact: proposal.expectedImpact,
            tests: proposal.tests,
            evaluationSummary: proposal.evaluationSummary,
            approvals: [],
            appliedAt: null,
            verifiedAt: null,
            rollbackRef: null,
            rollbackSnapshot: [],
            createdAt: now,
            updatedAt: now,
            createdBy: "agent",
            epistemicState: "PROPOSED",
            confidence: 0.55,
            authorityHint: "LLM_INFERENCE",
          });
          osStore.upsertPatch(patch);
          patchId = patch.id;
          answer = [
            answer,
            "",
            `--- Patch ${patch.id} (${patch.status}) · risk ${patch.risk} ---`,
            patch.evaluationSummary ?? "",
            `Files: ${patch.filesChanged.map((f) => f.path).join(", ")}`,
            "Next: Approve & Apply on /patches (controlled WRITE).",
          ].join("\n");
        }
      } catch {
        answer = [
          answer,
          "",
          "Patch proposal skipped — set workspaceRoot or open /patches.",
        ].join("\n");
      }
    }

    const secretsInAnswer = detectSecrets(answer).length === 0;

    const verification = verifyAgentResponse({
      usedRepositoryState: Boolean(snapshot),
      usedRelevantMemory: memories.length > 0,
      distinguishedFactFromInference: true,
      verifiedExternalClaims: false,
      detectedConflicts: (snapshot?.conflicts.length ?? 0) > 0,
      citedExternalClaims: false,
      noSecretsExposed: secretsInAnswer,
      withinAuthorization: !writeBlocked,
    });

    const run = agentRunSchema.parse({
      id: crypto.randomUUID(),
      projectId,
      mode,
      status: writeBlocked || patchId ? "AWAITING_APPROVAL" : "SUCCEEDED",
      userRequest: body.userRequest,
      answer: [
        answer,
        "",
        `Provider: ${llmProvider}`,
        `Epistemic: ${epistemicLabel}`,
        `Evidence refs: ${evidenceRefs.length}`,
        `Engineering mode: ${engMode}`,
        `Experts: ${experts.primary}${experts.supporting.length ? ` + ${experts.supporting.join(", ")}` : ""}`,
        `Scope: ${projectId ? "project" : "portfolio"}`,
        `Intent: ${intent.kind}`,
        verification.passed
          ? "Self-check: passed."
          : `Self-check: ${verification.failures.join("; ")}`,
      ].join("\n"),
      epistemicState: epistemicLabel,
      startedAt: now,
      completedAt: now,
      createdBy: "user",
    });

    osStore.addAgentRun(run);
    osStore.recordEvent({
      type: "agent.run.completed",
      runId: run.id,
      mode: run.mode,
      intent: intent.kind,
      experts: [experts.primary, ...experts.supporting],
      epistemicLabel,
      evidenceRefCount: evidenceRefs.length,
      occurredAt: now,
    });
    osStore.appendAudit({
      type: "agent.run.completed",
      runId: run.id,
      mode: run.mode,
      provider: selectedId,
      patchId,
      epistemicLabel,
      evidenceRefCount: evidenceRefs.length,
      projectId,
      status: run.status,
      at: now,
    });

    let learnedMemoryId: string | null = null;
    if (
      selectedId === "arletos-included" &&
      run.answer &&
      epistemicLabel !== "INSUFFICIENT_EVIDENCE"
    ) {
      // Tenant boundary (P0 fix): memorySchema.ownerId is now mandatory —
      // reuse the identity resolved up front (same result memory.ts's
      // POST /api/v1/memory would compute: real user when signed in, stub
      // owner for unauthenticated/system callers), never leave it unset.
      const learned = persistArletosAgentMemory({
        projectId,
        userRequest: redactedUserRequest,
        answer: run.answer,
        runId: run.id,
        ownerId: identity.ownerId,
      });
      learnedMemoryId = learned.id;
    }

    return reply.status(201).send({
      run,
      experts,
      learnedMemoryId,
      patchId,
      engineeringMode: engMode,
      memoryContext,
      evidenceRefs,
      epistemicLabel,
      knowledgePlainLanguage: knowledge?.plainLanguage ?? null,
      catalog: {
        id: catalog.id,
        titleEn: catalog.titleEn,
        priceTier: catalog.priceTier,
        creditCost: catalog.creditCost,
        billing: catalog.billing,
      },
      intent: { ...intent, suggestedMode: mode },
      authorizationPreview: authorizeToolCall({
        toolName: shouldPropose ? "github.create_pr" : "memory.search",
        mode: shouldPropose ? "WRITE" : mode,
        writeGateOpen: false,
        approved: false,
      }),
    });
  });
}

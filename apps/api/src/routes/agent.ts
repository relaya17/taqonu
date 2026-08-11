import type { FastifyInstance } from "fastify";
import {
  authorizeToolCall,
  buildAgentContext,
  buildPortfolioContextBlocks,
  classifyIntent,
  completeWithFreeFallback,
  verifyAgentResponse,
  redactSecrets,
  detectSecrets,
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
import { proposePatch } from "@atlas/code-intelligence";
import {
  ENGINEERING_MODE_META,
  patchArtifactSchema,
  type EngineeringAgentMode,
} from "@atlas/shared";

const runs: Array<ReturnType<typeof agentRunSchema.parse>> = [];

function toMvpMode(mode: AgentMode): MvpAgentMode {
  if ((MVP_AGENT_MODES as readonly string[]).includes(mode)) {
    return mode as MvpAgentMode;
  }
  return "PLAN";
}

export async function registerAgentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/agent/runs", async () => ({
    items: runs,
    page: 1,
    pageSize: 20,
    total: runs.length,
  }));

  app.post("/api/v1/agent/runs", async (request, reply) => {
    osStore.ensureLoaded();
    const body = createAgentRunSchema.parse(request.body);
    const intent = classifyIntent(body.userRequest);
    const requested = body.mode === "READ" ? intent.suggestedMode : body.mode;
    const mode = toMvpMode(requested);
    const writeBlocked = intent.kind === "WRITE_CHANGE";
    const now = new Date().toISOString();

    const selectedId = body.aiProviderId ?? "arletos-included";
    const catalog = AI_PROVIDER_CATALOG[selectedId as keyof typeof AI_PROVIDER_CATALOG];
    if (!catalog || catalog.kind === "assist") {
      throw new AtlasError(
        "VALIDATION_ERROR",
        "Provider is assist-only — use /artifacts for vision assists",
      );
    }

    if (catalog.billing === "credits" && catalog.creditCost > 0) {
      const { tier } = resolveTier(app.atlasEnv);
      ensureCreditsInitialized(tier);
      try {
        chargeCredits(catalog.creditCost);
      } catch {
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

    const projects = osStore.listProjects();
    const projectId = body.projectId ?? null;
    const snapshot = projectId ? osStore.getSnapshot(projectId) ?? null : null;
    const decisions = projectId
      ? [...osStore.getDecisions(projectId), ...osStore.getDecisions("global")]
      : [...osStore.getDecisions("global")];
    const memories = projectId
      ? [...osStore.getMemories(projectId), ...osStore.getMemories("global")]
      : projects.flatMap((p) => osStore.getMemories(p.id)).concat(osStore.getMemories("global"));
    const evidence = projectId
      ? osStore.getEvidence(projectId)
      : projects.flatMap((p) => osStore.getEvidence(p.id));

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

    const system = redactSecrets([
      "You are the ArletOS Engineering + QA Intelligence OS agent.",
      "Use only retrieved context. Label FACT vs INFERRED vs PROPOSED.",
      "Never claim deployment/DB facts without labeled evidence.",
      "Never expose secrets.",
      "WRITE actions require eval gate + human APPROVE.",
      "Reply in the user's language (Hebrew, Arabic, or English).",
      "For coding handoff: produce a concise editor brief with steps and constraints.",
      "",
      expertBlock,
      "",
      context,
    ].join("\n"));

    const llm = await completeWithFreeFallback(
      llmEnvOverride,
      [
        { role: "system", content: system },
        { role: "user", content: redactSecrets(body.userRequest) },
      ],
    );
    let answer = redactSecrets(
      `${llm.text}\n\n— provider: ${llm.provider} · catalog: ${catalog.titleEn} (${catalog.billing === "included" ? "included" : `${catalog.creditCost} credits`})`,
    );

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

    if (shouldPropose && body.workspaceRoot) {
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
        `Provider: ${llm.provider}`,
        `Engineering mode: ${engMode}`,
        `Experts: ${experts.primary}${experts.supporting.length ? ` + ${experts.supporting.join(", ")}` : ""}`,
        `Scope: ${projectId ? "project" : "portfolio"}`,
        `Intent: ${intent.kind}`,
        verification.passed
          ? "Self-check: passed."
          : `Self-check: ${verification.failures.join("; ")}`,
      ].join("\n"),
      epistemicState: "PROPOSED",
      startedAt: now,
      completedAt: now,
      createdBy: "user",
    });

    runs.push(run);
    osStore.recordEvent({
      type: "agent.run.completed",
      runId: run.id,
      mode: run.mode,
      intent: intent.kind,
      experts: [experts.primary, ...experts.supporting],
      occurredAt: now,
    });
    osStore.appendAudit({
      type: "agent.run.completed",
      runId: run.id,
      mode: run.mode,
      provider: selectedId,
      patchId,
      at: now,
    });

    let learnedMemoryId: string | null = null;
    if (selectedId === "arletos-included" && run.answer) {
      const learned = persistArletosAgentMemory({
        projectId,
        userRequest: body.userRequest,
        answer: run.answer,
        runId: run.id,
      });
      learnedMemoryId = learned.id;
    }

    return reply.status(201).send({
      run,
      experts,
      learnedMemoryId,
      patchId,
      engineeringMode: engMode,
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

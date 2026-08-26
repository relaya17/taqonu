import {
  buildLayeredSystemPrompt,
  completeWithFreeFallback,
  getFabricAgent,
  redactSecrets,
  type LlmEnv,
  type LlmUsage,
} from "@atlas/agent-core";
import {
  agentProposalSchema,
  type AgentProposal,
  type EvidenceCategory,
  type FabricAgentId,
} from "@atlas/shared";
import { z } from "zod";
import { assertLlmEgressAllowed } from "./egress-gate.js";

/**
 * REAL LLM-backed `AgentProposal` generator — the Phase 1a replacement for
 * `agent-proposal-stub-generator.ts` on the two fabric specialists that are
 * wired to it (`code-engineer-dispatch.ts`, `research-analyst-dispatch.ts`).
 * The stub is deliberately NOT deleted: it is still the only way to get a
 * byte-for-byte deterministic proposal, which several existing tests depend
 * on, and it remains the right tool for any specialist that has no LLM
 * behind it yet.
 *
 * What this module does and — more importantly — what it deliberately does
 * NOT do:
 *
 *  - It PROPOSES. The model's output is never executed, never applied, and
 *    never trusted as fact. The only thing this function can produce is an
 *    `AgentProposal`, which `submitAgentProposal()` (agent-proposal.ts) then
 *    validates and pushes through `dispatchAgentAction()`'s Policy Engine +
 *    Risk Engine + Audit Log + Approval gate. There is no code path from
 *    here to a side effect.
 *  - It never picks the entity/action pair on the model's say-so alone. The
 *    caller supplies `allowedActions` — the closed, policy-justified set of
 *    `(entityType, action)` pairs that specialist is allowed to propose (see
 *    each dispatch service's doc comment for its justification against
 *    `DEFAULT_ENTITY_POLICIES`) — and a model that names anything outside
 *    that set is rejected exactly like malformed JSON. An agent that could
 *    nominate its own entity/action would be choosing its own risk tier,
 *    which is the same class of mistake as an agent choosing its own trust
 *    level (see `submitAgentProposal`'s doc comment).
 *  - It never throws. A specialist run must degrade gracefully — the
 *    `runSpecialistStub` contract this path replaces (dispatch.ts) always
 *    returns an `AgentRunResult` — so every failure mode (provider error,
 *    non-JSON text, missing fields, out-of-range confidence, disallowed
 *    action) resolves to `proposal: null` plus a human-readable
 *    `rejectionReason`, and the caller maps that to `NEEDS_EVIDENCE`.
 *  - It uses `completeWithFreeFallback`, NOT `completeStrict`, for the same
 *    reason: `completeStrict` throws when the selected provider fails, while
 *    the free-fallback chain ends at the offline `ContextEchoProvider`, so
 *    this path runs with zero API keys configured. Offline, that provider
 *    returns prose rather than JSON, so the honest outcome is
 *    `proposal: null` → `NEEDS_EVIDENCE`, never an invented proposal.
 *
 * Prompt layering (this is why this file is on `ALLOWED_CALL_SITES` in
 * `apps/api/src/__tests__/llm-call-site-guard.test.ts`): the trusted
 * `instructions` half is built only from text Atlas itself authored — the
 * static specialist catalog entry (`getFabricAgent`) and the fixed output
 * contract below. The incoming `request` is attacker-controllable (it
 * reaches this service from an HTTP body, and a future caller may hand it
 * externally-ingested content), so it goes in `untrustedBlocks` and gets the
 * delimiter + meta-instruction + injection-scan treatment
 * `apps/api/src/routes/agent.ts` already gives its evidence/context blocks.
 * `promptFlagged` is surfaced to the caller rather than handled here: what
 * to do about a flagged prompt (raise the dispatch trust level, log, refuse)
 * is a policy decision belonging to the dispatching service, exactly as
 * `prompt-layers.ts`'s own doc comment states.
 */

/** One `(entityType, action)` pair a specialist is permitted to propose. */
export interface AllowedProposalAction {
  /** `BusinessEntityType` literal from `@atlas/agent-core` (kept as a string here for the same reason `agentProposalActionSchema` does). */
  readonly entityType: string;
  /** `EntityAction` literal from `@atlas/agent-core`. */
  readonly action: string;
}

export interface SpecialistProposalInput {
  readonly agentId: FabricAgentId;
  /** The caller's free-text request — treated as UNTRUSTED content, never spliced into the trusted instructions. */
  readonly request: string;
  readonly projectId: string | null;
  /**
   * Owner of the evidence records this generator materializes from the
   * model's evidence references. Must be a real caller-supplied user id
   * (`evidenceRecordSchema.ownerId` is a uuid) — never invented here, the
   * same rule `agent-proposal-stub-generator.ts` states for its own stub
   * evidence.
   */
  readonly ownerId: string;
  /** The closed set of entity/action pairs this specialist may propose; anything else is rejected. Must be non-empty. */
  readonly allowedActions: readonly AllowedProposalAction[];
  /**
   * Typed Current-State slice the materialized evidence belongs to
   * (`EVIDENCE_CATEGORIES`) — passed in per specialist rather than guessed,
   * since `evidence.schema.ts` explicitly forbids silently collapsing
   * distinct categories.
   */
  readonly evidenceCategory: EvidenceCategory;
  /**
   * Ties the proposal back to the agent run/plan step that produced it.
   * Optional because the fabric's `AgentRunResult` has no id of its own to
   * borrow (see `agent-fabric.schema.ts`) — a fresh uuid is minted per call
   * when the caller has nothing better to pass.
   */
  readonly taskId?: string;
  /** Provider selection/credentials, threaded from `app.atlasEnv`. Defaults to `{}` → the free offline `ContextEchoProvider`. */
  readonly env?: LlmEnv;
}

export interface SpecialistProposalResult {
  /** The validated proposal, or null when the model produced nothing usable — see `rejectionReason`. */
  readonly proposal: AgentProposal | null;
  /** The REAL metered usage of the call that was actually placed (0 across the board for the free offline provider — an honest zero, per `LlmUsage`'s own doc comment). */
  readonly usage: LlmUsage;
  /** Which provider actually answered (e.g. "context-echo-free"), for the audit/claims trail. */
  readonly provider: string;
  /** Human-readable reason `proposal` is null, or null when a proposal was produced. Never a thrown error. */
  readonly rejectionReason: string | null;
  /** True when `buildLayeredSystemPrompt` flagged the untrusted request as containing a possible injection attempt. */
  readonly promptFlagged: boolean;
}

/**
 * The exact JSON contract the model is told to emit, and the schema that
 * decides whether it complied. Kept deliberately narrower than
 * `agentProposalSchema`: the model is only ever asked for the fields it can
 * legitimately author (its claims, its evidence references, its confidence,
 * its rationale, the action it proposes). Identity fields —
 * `agentId`/`taskId`/`projectId`/`ownerId` — are filled in by this module
 * from `SpecialistProposalInput` afterwards, so a model cannot attribute its
 * proposal to a different agent, task, project, or tenant.
 */
const llmProposalResponseSchema = z.object({
  claims: z.array(z.string().min(1).max(4000)).min(1).max(20),
  evidence: z
    .array(
      z.object({
        ref: z.string().min(1).max(2000),
        excerpt: z.string().max(8000).nullish(),
      }),
    )
    .min(1)
    .max(20),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1).max(4000),
  proposedAction: z.object({
    entityType: z.string().min(1).max(200),
    action: z.string().min(1).max(200),
  }),
});

/** Fixed instant is NOT used here — evidence observedAt/createdAt is the real call time, since this evidence really was produced now. */
function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Extracts the JSON object from a model reply that may be wrapped in prose
 * or a ``` fence. This is a deliberate leniency, not sloppiness: models
 * routinely prepend "Here is the JSON:" even when told not to, and the
 * alternative (rejecting an otherwise perfectly well-formed proposal over a
 * preamble) would trade a real proposal for a `NEEDS_EVIDENCE` for no safety
 * gain — the parsed result still has to satisfy `llmProposalResponseSchema`
 * and the caller's `allowedActions` before it becomes a proposal. Returns
 * null when there is no brace-delimited span at all (the offline
 * `ContextEchoProvider`'s prose reply, for instance).
 */
function extractJsonObject(text: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

/** Builds the trusted instruction half of the prompt from the static specialist catalog — never from caller input. */
function buildInstructions(
  agentId: FabricAgentId,
  allowedActions: readonly AllowedProposalAction[],
): string {
  const def = getFabricAgent(agentId);
  return [
    `You are the ${def.title} specialist inside the Atlas agent fabric (agent id: ${def.id}).`,
    `Specialty: ${def.specialty}`,
    `Risk level: ${def.riskLevel}. Tools you are allowed to reason about: ${def.allowedTools.join(", ")}.`,
    `Tools you are forbidden from proposing: ${def.forbiddenTools.join(", ")}.`,
    `Evidence this specialist requires: ${def.evidenceRequirements.join("; ")}.`,
    "",
    "You PROPOSE an action. You never execute one, and nothing you write is applied.",
    "Your proposal is validated and then passed to a policy/risk gate that may deny it or require human approval.",
    "",
    "Reply with STRICT JSON ONLY — no prose before or after, no markdown fence, no comments.",
    "The JSON object must have exactly these fields:",
    '  "claims": string[] — 1..20 explicit assertions your proposal rests on. Never empty.',
    '  "evidence": [{ "ref": string, "excerpt": string | null }] — 1..20 references backing those claims (a file path, a URL, a test name, a requirement id). Never empty, never invented.',
    '  "confidence": number — your own confidence, between 0 and 1 inclusive.',
    '  "rationale": string — why THIS action is the right proposal.',
    '  "proposedAction": { "entityType": string, "action": string } — must be exactly one of the allowed pairs listed below.',
    "",
    "Allowed proposedAction pairs (any other pair is rejected outright):",
    ...allowedActions.map((a) => `  - { "entityType": "${a.entityType}", "action": "${a.action}" }`),
    "",
    "Do not include an agent id, task id, project id, or owner id — those are assigned by the system, not by you.",
    "If you cannot support a proposal with real evidence, say so in claims/rationale with a low confidence rather than inventing evidence.",
  ].join("\n");
}

/**
 * Calls the LLM once and turns its reply into a validated `AgentProposal`,
 * or into `proposal: null` plus a reason. See the module doc comment for the
 * propose-never-execute / never-throw / prompt-layering contract.
 */
export async function generateSpecialistProposalViaLlm(
  input: SpecialistProposalInput,
): Promise<SpecialistProposalResult> {
  const taskId = input.taskId ?? crypto.randomUUID();

  const layeredPrompt = buildLayeredSystemPrompt({
    instructions: buildInstructions(input.agentId, input.allowedActions),
    untrustedBlocks: [{ label: `fabric-request:${input.agentId}`, content: input.request }],
  });
  // Redaction over the fully layered content, matching `agent.ts`'s ordering
  // (layer first, then redact) so it covers the wrapped untrusted block too.
  const system = redactSecrets(layeredPrompt.systemContent);

  let text = "";
  let usage: LlmUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costUsd: 0,
  };
  let provider = "none";
  try {
    assertLlmEgressAllowed({
      provider: input.env?.LLM_PROVIDER,
      purpose: "llm.specialist",
    });
    const llm = await completeWithFreeFallback(input.env ?? {}, [
      { role: "system", content: system },
      {
        role: "user",
        content:
          "Produce the strict-JSON proposal described in your instructions for the request in the untrusted data block above.",
      },
    ]);
    text = llm.text;
    // The REAL metered figure from the call that was actually placed — this
    // is what `runSpecialistStub`'s `costUsd: 0` doc comment asks a real
    // LLM-backed specialist to thread through instead of a flat 0.
    usage = llm.usage;
    provider = llm.provider;
  } catch (error) {
    return {
      proposal: null,
      usage,
      provider,
      rejectionReason: `llm call failed: ${error instanceof Error ? error.message : String(error)}`,
      promptFlagged: layeredPrompt.flagged,
    };
  }

  const json = extractJsonObject(text);
  if (json === null) {
    return {
      proposal: null,
      usage,
      provider,
      rejectionReason: "model reply contained no JSON object",
      promptFlagged: layeredPrompt.flagged,
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    return {
      proposal: null,
      usage,
      provider,
      rejectionReason: `model reply was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      promptFlagged: layeredPrompt.flagged,
    };
  }

  const parsed = llmProposalResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      proposal: null,
      usage,
      provider,
      rejectionReason: `model JSON did not satisfy the proposal contract: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")}`,
      promptFlagged: layeredPrompt.flagged,
    };
  }

  const proposedAction = parsed.data.proposedAction;
  const permitted = input.allowedActions.some(
    (a) => a.entityType === proposedAction.entityType && a.action === proposedAction.action,
  );
  if (!permitted) {
    return {
      proposal: null,
      usage,
      provider,
      rejectionReason: `model proposed a disallowed action ${proposedAction.entityType}.${proposedAction.action} — allowed: ${input.allowedActions
        .map((a) => `${a.entityType}.${a.action}`)
        .join(", ")}`,
      promptFlagged: layeredPrompt.flagged,
    };
  }

  const observedAt = nowIso();
  // Every evidence record materialized here is labeled for what it actually
  // is: an LLM-authored reference (`authorityRank: "LLM_INFERENCE"`, the
  // lowest rank in `SOURCE_AUTHORITY_RANKS`) that has NOT been verified
  // (`epistemicState: "PROPOSED"`). It is never dressed up as OBSERVED or
  // VERIFIED — the same honesty rule the stub generator states.
  const evidence = parsed.data.evidence.map((item, index) => ({
    id: crypto.randomUUID(),
    ownerId: input.ownerId,
    projectId: input.projectId,
    source: "llm-specialist-proposal",
    sourceType: "SYSTEM" as const,
    sourceId: `${taskId}:${index}`,
    uri: /^https?:\/\//i.test(item.ref) ? item.ref.slice(0, 2000) : null,
    excerpt: item.excerpt ?? item.ref.slice(0, 8000),
    version: null,
    observedAt,
    createdAt: observedAt,
    confidence: parsed.data.confidence,
    epistemicState: "PROPOSED" as const,
    category: input.evidenceCategory,
    classification: "INTERNAL" as const,
    authorityRank: "LLM_INFERENCE" as const,
    metadata: { ref: item.ref.slice(0, 2000), provider },
  }));

  // Final gate before the proposal leaves this module: the identity fields
  // the model was never allowed to author are filled in from `input`, then
  // the whole thing must satisfy `agentProposalSchema`. `safeParse`, not
  // `parse` — a proposal that fails here (e.g. a non-uuid ownerId/projectId
  // supplied by the caller) must degrade to NEEDS_EVIDENCE, not throw out of
  // a specialist run.
  const proposal = agentProposalSchema.safeParse({
    agentId: input.agentId,
    taskId,
    projectId: input.projectId,
    action: { entityType: proposedAction.entityType, action: proposedAction.action },
    inputs: { request: input.request.slice(0, 4000), provider },
    claims: parsed.data.claims,
    evidence,
    confidence: parsed.data.confidence,
    rationale: parsed.data.rationale,
  });
  if (!proposal.success) {
    return {
      proposal: null,
      usage,
      provider,
      rejectionReason: `assembled proposal failed agentProposalSchema: ${proposal.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")}`,
      promptFlagged: layeredPrompt.flagged,
    };
  }

  return {
    proposal: proposal.data,
    usage,
    provider,
    rejectionReason: null,
    promptFlagged: layeredPrompt.flagged,
  };
}

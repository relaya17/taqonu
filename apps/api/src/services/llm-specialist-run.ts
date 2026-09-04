import {
  agentRunResultSchema,
  uuidSchema,
  type AgentProposal,
  type AgentRunResult,
  type EvidenceCategory,
  type FabricAgentId,
} from "@atlas/shared";
import { getFabricAgent, type LlmEnv } from "@atlas/agent-core";
import {
  generateSpecialistProposalViaLlm,
  type AllowedProposalAction,
} from "./llm-specialist-proposal.js";
import { submitAgentProposal } from "./agent-proposal.js";
import { lookupControlPlaneAgentRuntimeStatus } from "./control-plane-bridge.js";

/**
 * The one place the "proposal-first specialist" shape lives: generate a
 * proposal with a real LLM call (`llm-specialist-proposal.ts`), push it
 * through `submitAgentProposal()` → `dispatchAgentAction()`, and translate
 * that gate decision into the `AgentRunResult` the fabric expects.
 *
 * This exists for exactly the same reason `skippedForDispatchGate()` exists
 * in `apps/api/src/routes/agent-fabric.ts`: the gate-decision → run-status
 * mapping is a real design decision (see that function's doc comment for why
 * a non-ALLOWED decision becomes `SKIPPED` with `epistemicState: "UNKNOWN"`
 * rather than a new status), and having two per-specialist copies of it
 * would let them drift. Everything that is genuinely per-specialist — which
 * entity/action pairs may be proposed and why, which Current-State evidence
 * slice the proposal's evidence belongs to, the audit route label — stays in
 * the per-specialist file (`code-engineer-dispatch.ts`,
 * `research-analyst-dispatch.ts`), matching the file-per-specialist
 * convention `security-sentinel-dispatch.ts` established.
 *
 * Contract notes:
 * - Never throws. `runSpecialistStub` (dispatch.ts), the read-only path this
 *   replaces, always returns an `AgentRunResult`; a specialist that threw
 *   would take the whole dispatch down with it. A failure inside the gate
 *   itself (e.g. the audit log is unwritable) becomes `status: "FAILED"`
 *   rather than an exception.
 * - Returns `null` only when this path cannot run at all, so the caller
 *   falls back to the read-only stub — the same "cannot run → null → stub"
 *   contract `runSecuritySpecialistViaSentinel` uses when there is no
 *   workspace root.
 * - `costUsd` is the REAL metered `LlmUsage.costUsd` of the call that was
 *   actually placed, threaded straight through, exactly as
 *   `runSpecialistStub`'s `costUsd: 0` doc comment instructs an
 *   LLM-backed specialist to do. Offline (`ContextEchoProvider`) that figure
 *   is a genuine 0, not a placeholder. `durationMs` is measured, never
 *   estimated.
 */
export interface ProposalBackedSpecialistConfig {
  readonly agentId: FabricAgentId;
  /** Closed, policy-justified set of entity/action pairs this specialist may propose — see the calling file's doc comment for the justification. */
  readonly allowedActions: readonly AllowedProposalAction[];
  /** Current-State slice the materialized proposal evidence belongs to (`EVIDENCE_CATEGORIES`). */
  readonly evidenceCategory: EvidenceCategory;
  /** Short dotted label for the audit entry, e.g. "agent-fabric.dispatch.code-engineer". */
  readonly routeLabel: string;
}

export interface ProposalBackedSpecialistInput {
  readonly request: string;
  readonly projectId?: string | null;
  /** The signed-in human this agent acts on behalf of; also the owner of the proposal's evidence records. */
  readonly ownerId: string;
  /** Provider selection/credentials from `app.atlasEnv`; omitted → free offline provider. */
  readonly env?: LlmEnv;
  readonly taskId?: string;
  /** Orchestrator → specialist is one hop. Direct tool-execute stays at 0. */
  readonly delegationHopCount?: number;
  readonly requestId?: string;
}

/** Evidence references for the run result: the real URI when the model cited one, else its raw reference string. */
function evidenceRefsOf(proposal: AgentProposal): string[] {
  return proposal.evidence.map((item) => {
    if (item.uri) return item.uri;
    const ref = item.metadata["ref"];
    return typeof ref === "string" ? ref : item.id;
  });
}

export async function runProposalBackedSpecialist(
  config: ProposalBackedSpecialistConfig,
  input: ProposalBackedSpecialistInput,
): Promise<AgentRunResult | null> {
  // `evidenceRecordSchema.ownerId` is a uuid, so without a real caller id
  // this path could only produce an invalid proposal. Falling back to the
  // read-only stub is the correct degrade — inventing an owner id would put
  // a fabricated tenant on an audit-logged proposal.
  if (!uuidSchema.safeParse(input.ownerId).success) return null;

  const def = getFabricAgent(config.agentId);
  const started = Date.now();
  const projectId = input.projectId ?? null;

  const generated = await generateSpecialistProposalViaLlm({
    agentId: config.agentId,
    request: input.request,
    projectId,
    ownerId: input.ownerId,
    allowedActions: config.allowedActions,
    evidenceCategory: config.evidenceCategory,
    ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
    ...(input.env !== undefined ? { env: input.env } : {}),
  });

  const providerClaims = [
    `${config.agentId}: specialty=${def.specialty}`,
    `WRITE=${def.canWriteCode ? "patch-only-gated" : "forbidden"}`,
    `llmProvider=${generated.provider}`,
    `promptInjectionFlagged=${generated.promptFlagged}`,
  ];

  if (!generated.proposal) {
    // Precedent: `runSpecialistStub`'s own NEEDS_EVIDENCE branch — the
    // specialist ran but has nothing it can honestly assert. The reason is
    // surfaced rather than swallowed, and the real (possibly non-zero) cost
    // of the failed attempt is still reported.
    return agentRunResultSchema.parse({
      agentId: config.agentId,
      status: "NEEDS_EVIDENCE",
      summary: `${def.title} produced no usable proposal: ${generated.rejectionReason ?? "unknown reason"}.`,
      claims: [
        ...providerClaims,
        `proposalRejected:${generated.rejectionReason ?? "unknown reason"}`,
      ],
      evidenceRefs: [],
      epistemicState: "UNVERIFIED",
      costUsd: generated.usage.costUsd,
      durationMs: Math.max(1, Date.now() - started),
    });
  }

  const proposal = generated.proposal;
  const proposedPair = `${proposal.action.entityType}.${proposal.action.action}`;
  const baseClaims = [
    ...providerClaims,
    `proposedAction=${proposedPair}`,
    `confidence=${proposal.confidence}`,
    `rationale:${proposal.rationale}`,
    ...proposal.claims,
  ];

  let gate: Awaited<ReturnType<typeof submitAgentProposal>>;
  try {
    const lookup = await lookupControlPlaneAgentRuntimeStatus(config.agentId);
    gate = await submitAgentProposal(proposal, {
      actorKind: "AGENT",
      onBehalfOfUserId: input.ownerId,
      // `request` is the authenticated caller's own free-text prompt, so it
      // is trusted at face value — the same reasoning the SECURITY branch in
      // `agent-fabric.ts` documents. The one exception is made here rather
      // than assumed away: when `buildLayeredSystemPrompt` flagged that same
      // text as containing an injection attempt, it is no longer credible as
      // ordinary user input, so it is downgraded to "untrusted" and
      // `floorBucketForUntrustedSource` (agent-dispatch-guard.ts) raises the
      // minimum bucket to APPROVAL. That hook exists for exactly this case.
      sourceContext: {
        origin: "user_message",
        trustLevel: generated.promptFlagged ? "untrusted" : "trusted",
      },
      routeLabel: config.routeLabel,
      trustLevel: "DELEGATED",
      delegationHopCount: input.delegationHopCount ?? 1,
      ...(lookup.configured ? { agentRuntimeStatus: lookup.status } : {}),
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    });
  } catch (error) {
    return agentRunResultSchema.parse({
      agentId: config.agentId,
      status: "FAILED",
      summary: `${def.title} proposal could not be gated: ${error instanceof Error ? error.message : String(error)}`,
      claims: baseClaims,
      evidenceRefs: evidenceRefsOf(proposal),
      epistemicState: "UNKNOWN",
      costUsd: generated.usage.costUsd,
      durationMs: Math.max(1, Date.now() - started),
    });
  }

  if (gate.decision === "DENIED") {
    return agentRunResultSchema.parse({
      agentId: config.agentId,
      status: "SKIPPED",
      summary: `${config.agentId} proposal (${proposedPair}) was denied by policy: ${gate.reason}`,
      claims: [`denied:${gate.reason}`, ...baseClaims],
      evidenceRefs: evidenceRefsOf(proposal),
      epistemicState: "UNKNOWN",
      costUsd: generated.usage.costUsd,
      durationMs: Math.max(1, Date.now() - started),
    });
  }

  if (gate.decision === "APPROVAL_REQUIRED") {
    return agentRunResultSchema.parse({
      agentId: config.agentId,
      status: "SKIPPED",
      summary: `${config.agentId} proposal (${proposedPair}) is pending human approval before it can run (approvalRequestId=${gate.approvalRequestId}).`,
      claims: [
        `approvalRequestId:${gate.approvalRequestId}`,
        `bucket:${gate.bucket}`,
        ...baseClaims,
      ],
      evidenceRefs: evidenceRefsOf(proposal),
      epistemicState: "UNKNOWN",
      costUsd: generated.usage.costUsd,
      durationMs: Math.max(1, Date.now() - started),
    });
  }

  return agentRunResultSchema.parse({
    agentId: config.agentId,
    status: "COMPLETED",
    summary: `${def.title} proposed ${proposedPair} and the dispatch gate ALLOWED it (bucket=${gate.bucket}, score=${gate.score}): ${proposal.rationale}`,
    claims: [`gate:ALLOWED bucket=${gate.bucket}`, ...baseClaims],
    evidenceRefs: evidenceRefsOf(proposal),
    // PROPOSED, not OBSERVED: every claim here is the model's own assertion
    // routed through a gate, not something Atlas observed. Labeling it
    // OBSERVED would be exactly the "confident hallucination" this codebase
    // refuses (see `epistemic.ts`).
    epistemicState: "PROPOSED",
    costUsd: generated.usage.costUsd,
    durationMs: Math.max(1, Date.now() - started),
  });
}

import {
  verifyProposal,
  type BusinessEntityType,
  type EntityAction,
  type ProposalVerificationResult,
} from "@atlas/agent-core";
import { agentProposalSchema, type AgentProposal } from "@atlas/shared";
import {
  dispatchAgentAction,
  unevaluatedGovernanceEvaluation,
  type DispatchActorKind,
  type DispatchAgentActionResult,
  type DispatchSourceContext,
} from "./agent-dispatch-guard.js";

/**
 * The layer ABOVE `dispatchAgentAction()` (`agent-dispatch-guard.ts`), not a
 * replacement for it. An LLM/agent call site never gets a code path that
 * executes an action directly — it can only ever produce an `AgentProposal`
 * (claims + evidence + confidence + rationale made explicit, per
 * `agent-proposal.schema.ts`). `submitAgentProposal()` is the thin
 * translator that:
 *
 *  1. Validates that proposal against `agentProposalSchema` — a malformed
 *     proposal (missing claims, missing evidence, out-of-range confidence,
 *     …) is rejected right here, before it ever reaches the dispatch gate.
 *  2. Maps the validated proposal onto `dispatchAgentAction()`'s call shape
 *     — `proposal.action.entityType`/`.action` become
 *     `DispatchAgentActionOptions.entityType`/`.action`,
 *     `proposal.confidence` becomes `options.confidence`,
 *     `proposal.evidence.length` becomes `options.evidenceCount`, and the
 *     proposal's `claims`/`rationale`/`taskId`/`inputs` are folded into
 *     `options.input` so they land on the resulting Unified Audit Log entry
 *     — the whole point being that a human/auditor can later see not just
 *     WHAT was dispatched but WHY the agent proposed it and what it says it
 *     saw.
 *  3. Calls the existing `dispatchAgentAction()` and returns its
 *     discriminated result, augmented with the proposal's own claims/
 *     rationale/confidence for callers that want them without re-reading
 *     the audit log.
 *
 * This function does NOT duplicate any Policy Engine / Risk Engine / Audit
 * Log / Approval logic — all of that still lives exactly once, in
 * `dispatchAgentAction()`. It also does NOT execute the underlying entity
 * action itself, for the same reason `dispatchAgentAction()` doesn't: it is
 * a gate, not an executor. Callers act on the returned decision exactly as
 * they would on a raw `DispatchAgentActionResult`.
 *
 * The actor/trust context (`actorKind`, `onBehalfOfUserId`, `sourceContext`,
 * `routeLabel`) is deliberately NOT part of `AgentProposal` itself and is
 * supplied here by the caller instead: whether a source is trusted, who a
 * human-in-the-loop actually is, and what kind of actor is dispatching are
 * dispatch-mechanics/trust decisions the calling service (not the
 * proposing agent) is responsible for — an agent proposing its own trust
 * level would defeat the point of the untrusted-source floor
 * `dispatchAgentAction()` already enforces.
 */
export interface SubmitAgentProposalOptions {
  readonly actorKind: DispatchActorKind;
  /** The human this proposal's action would be taken on behalf of, if any — see `DispatchActor.onBehalfOfUserId`. */
  readonly onBehalfOfUserId: string | null;
  readonly sourceContext: DispatchSourceContext;
  /** Short dotted label for the audit type, e.g. "agent-proposal.dispatch.security". */
  readonly routeLabel: string;
  /**
   * Control Plane runtime status. PAUSED/QUARANTINED/REVOKED agents cannot execute.
   * Defaults to "ACTIVE" if not provided.
   */
  readonly agentRuntimeStatus?:
    | "ACTIVE"
    | "PAUSED"
    | "DISABLED"
    | "REVOKED"
    | "QUARANTINED"
    | "SUSPENDED"
    | "DEGRADED"
    | "UNKNOWN";
  /**
   * Delegation hop count for authority attenuation.
   * Each agent-to-agent hop floors the risk bucket to at least APPROVAL.
   */
  readonly delegationHopCount?: number;
}

/** Proposal metadata carried alongside the raw dispatch decision, for audit-trail-provable rationale/claims. */
export interface SubmittedProposalSummary {
  readonly agentId: string;
  readonly taskId: string;
  readonly claims: readonly string[];
  readonly rationale: string;
  readonly confidence: number;
  readonly evidenceCount: number;
}

export type SubmitAgentProposalResult = DispatchAgentActionResult & {
  readonly proposal: SubmittedProposalSummary;
  /**
   * Result of `verifyProposal()` for this proposal — always present, so a
   * caller (and the audit trail) can distinguish "verified" from "nothing
   * objected". See the verification step in `submitAgentProposal()` below.
   */
  readonly verification: ProposalVerificationResult;
};

export function submitAgentProposal(
  proposal: AgentProposal,
  options: SubmitAgentProposalOptions,
): SubmitAgentProposalResult {
  // Validate FIRST — a malformed proposal must never reach the dispatch
  // gate. `agentProposalSchema.parse` throws (ZodError) on anything that
  // doesn't satisfy the contract (missing claims, missing evidence,
  // confidence out of [0,1], …), the same "throw on invalid input" pattern
  // every other service in this codebase uses (see e.g. `approvals.ts`).
  const parsed = agentProposalSchema.parse(proposal);

  // VERIFICATION STEP — runs BEFORE the dispatch gate.
  //
  // `agentProposalSchema.parse` above checks the proposal's SHAPE. This
  // checks its SUBSTANCE: are the claims backed by evidence that is
  // anything more than the model's own inference, is the stated confidence
  // actually earned, did a secret leak into the proposal text. Until now
  // nothing in this codebase ever asked those questions — a proposal
  // asserting confidence 0.95 off its own reasoning was indistinguishable
  // from one backed by a passing CI run.
  //
  // A `FAILED` verdict is mapped onto the existing `DENIED` decision rather
  // than a new result variant: a proposal with a real, decidable defect IS
  // denied, and reusing the existing variant means every current caller
  // (e.g. `llm-specialist-run.ts`, which already branches on
  // `decision === "DENIED"`) handles it correctly with no change. The gate
  // is never reached, so nothing is dispatched and no approval request is
  // manufactured for a proposal we already know is defective.
  //
  // `INCONCLUSIVE` deliberately does NOT block. Weak evidence is not false
  // evidence — that distinction is the same one `approveMemory()` draws
  // between "no_evidence" and "unverified_evidence". It proceeds to the
  // gate (which may still demand approval on its own risk grounds) and the
  // verdict is recorded on the audit entry either way, so "we could not
  // verify this" is never silently indistinguishable from "we verified it".
  const verification = verifyProposal(parsed);

  const proposalSummary: SubmittedProposalSummary = {
    agentId: parsed.agentId,
    taskId: parsed.taskId,
    claims: parsed.claims,
    rationale: parsed.rationale,
    confidence: parsed.confidence,
    evidenceCount: parsed.evidence.length,
  };

  if (verification.verdict === "FAILED") {
    return {
      decision: "DENIED",
      reason: `Proposal verification failed — ${verification.rationale}`,
      evaluation: unevaluatedGovernanceEvaluation(
        "NOT_EVALUATED",
        "Proposal verification failed before policy and risk evaluation",
      ),
      proposal: proposalSummary,
      verification,
    };
  }

  const dispatchResult = dispatchAgentAction({
    actor: {
      kind: options.actorKind,
      agentId: parsed.agentId,
      onBehalfOfUserId: options.onBehalfOfUserId,
    },
    // `agentProposalSchema.action.{entityType,action}` are kept as plain
    // strings in @atlas/shared (see agent-proposal.schema.ts for why: shared
    // cannot import @atlas/agent-core's BusinessEntityType/EntityAction
    // enums). This is the one place that closed set is actually enforced —
    // an invalid pair is caught below by `authorizeEntityAction`'s own
    // "Unknown entity action" DENIED fail-safe inside `dispatchAgentAction`.
    entityType: parsed.action.entityType as BusinessEntityType,
    action: parsed.action.action as EntityAction,
    routeLabel: options.routeLabel,
    sourceContext: options.sourceContext,
    projectId: parsed.projectId,
    input: {
      taskId: parsed.taskId,
      inputs: parsed.inputs,
      claims: parsed.claims,
      rationale: parsed.rationale,
      evidenceIds: parsed.evidence.map((item) => item.id),
      evidenceCount: parsed.evidence.length,
      // On the audit entry so an auditor can tell a verified proposal from
      // an unverifiable one without re-running anything.
      verificationVerdict: verification.verdict,
      verificationRationale: verification.rationale,
    },
    confidence: parsed.confidence,
    evidenceCount: parsed.evidence.length,
    // Authority attenuation: runtime status and delegation hop count
    // Spread conditionally due to exactOptionalPropertyTypes
    ...(options.agentRuntimeStatus !== undefined
      ? { agentRuntimeStatus: options.agentRuntimeStatus }
      : {}),
    ...(options.delegationHopCount !== undefined
      ? { delegationHopCount: options.delegationHopCount }
      : {}),
  });

  return {
    ...dispatchResult,
    proposal: proposalSummary,
    verification,
  };
}

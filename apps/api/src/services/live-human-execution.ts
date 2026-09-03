import type { BusinessEntityType, EntityAction } from "@atlas/agent-core";
import type { DispatchSourceContext } from "./agent-dispatch-guard.js";
import {
  runGovernedClaimedExecution,
  type GovernedExecuteOnceContext,
  type GovernedExecuteOnceResult,
  type HelperResult,
} from "./governed-claimed-execution.js";

/**
 * The `HUMAN_ONLY` execution path -- CP7.1's architecture decision, CP7.2
 * revision after the atomic-claim correction.
 *
 * `dispatchAgentAction` (`agent-dispatch-guard.ts`) never lets a claimed,
 * previously-APPROVED record satisfy a `HUMAN_ONLY` risk bucket for an
 * AGENT/AUTOMATION actor, by design: that would be "approval-token replay"
 * -- something decided once, executed later by whatever presents the id.
 * `HUMAN_ONLY` requires a genuinely *live* human decision instead.
 *
 * This module is the one and only place that constructs a `HUMAN`-kind
 * `DispatchActor` together with a `liveHumanDecision`. It does NOT call
 * `decideApprovalRequest` and does NOT produce an intermediate APPROVED
 * row: `runGovernedClaimedExecution`'s `claimOrResume`, when given
 * `liveHumanDecision`, calls `claim_live_approval_request_as_live_human`
 * (via `claimApprovalRequestAsLiveHuman`) -- a single atomic database
 * transition straight from PENDING to CLAIMED. There is no point in time,
 * ever, at which a HUMAN_ONLY live-decision approval sits in a state that
 * could be claimed or replayed by a second caller.
 *
 * Crash semantics fall entirely out of the existing, unmodified machinery:
 *   - crash before the atomic claim commits -> row is still PENDING; a
 *     retried `runLiveHumanDecisionExecution` call is a clean, ordinary
 *     first attempt, not a resume.
 *   - crash after the claim commits -> row is CLAIMED; `claimOrResume`'s
 *     existing "claimed"/"started" detection and the existing
 *     `OUTCOME_UNKNOWN` finalize-on-resume path handle it exactly as they
 *     already do for the approval-token-replay flow. Nothing new here.
 *
 * Identity: `executorId` and `actor.agentId` are both the live decider's
 * own id -- never the original requester's. `claimApprovalRequestAsLiveHuman`
 * (and the database function underneath it) durably records `claimedBy`
 * as that same identity, so the audit trail never misrepresents who acted.
 * Separation of duties (`decidedBy !== requestedBy`) is enforced by the
 * database itself and re-checked by `claimedApprovalMatchesGovernedAction`'s
 * `HUMAN` branch at policy/risk re-check time -- this module does not (and
 * must not) need its own copy of that invariant to be correct.
 */
export interface RunLiveHumanDecisionExecutionInput<T> {
  readonly approvalId: string;
  /** The live, freshly-authenticated human performing this decision. */
  readonly deciderId: string;
  readonly decisionReason: string;
  readonly entityType: BusinessEntityType;
  readonly action: EntityAction;
  readonly artifactHash?: string;
  readonly requestId: string;
  readonly sourceContext: DispatchSourceContext;
  readonly projectId?: string | null;
  readonly routeLabel: string;
  readonly dispatchInput?: Record<string, unknown>;
  readonly executeOnce: (
    context: GovernedExecuteOnceContext,
  ) => Promise<GovernedExecuteOnceResult<T>>;
}

export async function runLiveHumanDecisionExecution<T>(
  input: RunLiveHumanDecisionExecutionInput<T>,
): Promise<HelperResult<T>> {
  return runGovernedClaimedExecution<T>({
    executorId: input.deciderId,
    actor: {
      kind: "HUMAN",
      agentId: input.deciderId,
      onBehalfOfUserId: input.deciderId,
    },
    entityType: input.entityType,
    action: input.action,
    ...(input.artifactHash !== undefined ? { artifactHash: input.artifactHash } : {}),
    approvalRequestId: input.approvalId,
    requestId: input.requestId,
    sourceContext: input.sourceContext,
    ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
    routeLabel: input.routeLabel,
    ...(input.dispatchInput !== undefined ? { dispatchInput: input.dispatchInput } : {}),
    liveHumanDecision: {
      decidedBy: input.deciderId,
      decisionReason: input.decisionReason,
    },
    executeOnce: input.executeOnce,
  });
}

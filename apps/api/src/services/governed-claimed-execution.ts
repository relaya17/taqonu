import type { BusinessEntityType, EntityAction } from "@atlas/agent-core";
import type { ApprovalRequest } from "@atlas/shared";
import {
  claimApprovalRequest,
  claimApprovalRequestAsLiveHuman,
  finalizeApprovalRequest,
  getApprovalRequest,
  markApprovalExecutionStarted,
} from "./approvals.js";
import {
  dispatchAgentAction,
  type DispatchActor,
  type DispatchAgentActionResult,
  type DispatchSourceContext,
} from "./agent-dispatch-guard.js";

export type GovernedExecuteOnceContext = {
  readonly gate: DispatchAgentActionResult;
  readonly approval: ApprovalRequest | undefined;
};

export type GovernedExecuteOnceResult<T> =
  | {
      readonly kind: "SUCCESS";
      readonly value: T;
      readonly runtimeExecutionId?: string;
      readonly outputEvidence?: string;
    }
  | { readonly kind: "FAILURE"; readonly reason: string };

export type HelperApprovalRef = {
  readonly id: string;
  readonly liveExecutionId: string;
};

export type HelperResult<T> =
  | {
      readonly status: "EXECUTED";
      readonly value: T;
      readonly approval: null | (HelperApprovalRef & { readonly finalOutcome: "FULFILLED" });
      readonly gate: DispatchAgentActionResult | undefined;
      readonly approvalRecord: ApprovalRequest | undefined;
    }
  | {
      readonly status: "DENIED";
      readonly stage: "APPROVAL" | "POLICY";
      readonly reason: string;
      readonly gate: DispatchAgentActionResult | undefined;
      readonly approvalRecord: ApprovalRequest | undefined;
    }
  | {
      readonly status: "APPROVAL_REQUIRED";
      readonly approvalRequestId: string;
      readonly reason: string;
      readonly gate: DispatchAgentActionResult;
      readonly approvalRecord: ApprovalRequest | undefined;
    }
  | {
      readonly status: "FAILED";
      readonly reason: string;
      readonly approval?: HelperApprovalRef & { readonly finalOutcome: "FAILED" };
      readonly gate: DispatchAgentActionResult | undefined;
      readonly approvalRecord: ApprovalRequest | undefined;
    }
  | {
      readonly status: "OUTCOME_UNKNOWN";
      readonly reason: string;
      readonly approval: HelperApprovalRef;
      readonly gate: DispatchAgentActionResult | undefined;
      readonly approvalRecord: ApprovalRequest | undefined;
    }
  | {
      readonly status: "FINALIZE_INCOMPLETE";
      readonly reason: string;
      readonly approval: HelperApprovalRef;
      readonly intendedOutcome: "FULFILLED" | "FAILED" | "OUTCOME_UNKNOWN";
      readonly value?: T;
      readonly gate: DispatchAgentActionResult | undefined;
      readonly approvalRecord: ApprovalRequest | undefined;
    };

export interface RunGovernedClaimedExecutionInput<T> {
  readonly executorId: string;
  readonly actor: DispatchActor;
  readonly entityType: BusinessEntityType;
  readonly action: EntityAction;
  readonly artifactHash?: string;
  readonly approvalRequestId?: string;
  readonly requestId: string;
  readonly sourceContext: DispatchSourceContext;
  readonly projectId?: string | null;
  readonly routeLabel: string;
  readonly agentRuntimeStatus?:
    | "ACTIVE"
    | "PAUSED"
    | "DISABLED"
    | "REVOKED"
    | "QUARANTINED"
    | "SUSPENDED"
    | "DEGRADED"
    | "UNKNOWN";
  readonly delegationHopCount?: number;
  readonly trustLevel?: "FULL" | "DELEGATED" | "LAB";
  readonly dispatchInput?: Record<string, unknown>;
  /**
   * HUMAN_ONLY live-decision path only (CP7.2). When present, `claimOrResume`
   * atomically decides-and-claims via `claim_live_approval_request_as_live_human`
   * instead of the ordinary decide-then-claim-a-token flow -- the approval
   * must be PENDING (never APPROVED) when this call is made. `actor.kind`
   * must be `"HUMAN"` whenever this is set; `live-human-execution.ts` is
   * the only caller that sets both.
   */
  readonly liveHumanDecision?: {
    readonly decidedBy: string;
    readonly decisionReason: string;
  };
  readonly executeOnce: (
    context: GovernedExecuteOnceContext,
  ) => Promise<GovernedExecuteOnceResult<T>>;
}

const startClaims = new Set<string>();

export function resetGovernedClaimStartsForTests(): void {
  startClaims.clear();
}

function liveId(record: ApprovalRequest): string | undefined {
  return record.liveExecutionId ?? undefined;
}

function ref(record: ApprovalRequest): HelperApprovalRef | undefined {
  const id = liveId(record);
  if (!id) return undefined;
  return { id: record.id, liveExecutionId: id };
}

async function finalizeClaimed(
  record: ApprovalRequest,
  outcome: "FULFILLED" | "FAILED" | "OUTCOME_UNKNOWN",
  extra: {
    reason?: string;
    runtimeExecutionId?: string;
    outputEvidence?: string;
  },
): Promise<ApprovalRequest | { incomplete: true; reason: string }> {
  const id = liveId(record);
  if (!id) {
    return { incomplete: true, reason: "claimed approval is missing liveExecutionId" };
  }
  try {
    return await finalizeApprovalRequest(record.id, {
      liveExecutionId: id,
      outcome,
      ...(extra.reason !== undefined ? { reason: extra.reason } : {}),
      ...(extra.runtimeExecutionId !== undefined
        ? { runtimeExecutionId: extra.runtimeExecutionId }
        : {}),
      ...(extra.outputEvidence !== undefined ? { outputEvidence: extra.outputEvidence } : {}),
    });
  } catch (error) {
    return {
      incomplete: true,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function claimOrResume(
  input: RunGovernedClaimedExecutionInput<unknown>,
): Promise<
  | { kind: "none" }
  | { kind: "claimed"; record: ApprovalRequest }
  | { kind: "started"; record: ApprovalRequest }
  | { kind: "replay"; record: ApprovalRequest }
  | { kind: "denied"; reason: string; record?: ApprovalRequest }
> {
  if (input.approvalRequestId === undefined) {
    return { kind: "none" };
  }

  let existing: ApprovalRequest | undefined;
  try {
    existing = await getApprovalRequest(input.approvalRequestId);
  } catch (error) {
    return {
      kind: "denied",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  if (!existing) {
    return { kind: "denied", reason: `Approval request ${input.approvalRequestId} not found` };
  }

  if (
    existing.status === "FULFILLED" ||
    existing.status === "FAILED" ||
    existing.status === "OUTCOME_UNKNOWN"
  ) {
    return { kind: "replay", record: existing };
  }

  if (existing.status === "CLAIMED") {
    if (existing.executionStartedAt !== null || startClaims.has(existing.liveExecutionId ?? "")) {
      return { kind: "started", record: existing };
    }
    return { kind: "claimed", record: existing };
  }

  if (input.liveHumanDecision !== undefined) {
    // HUMAN_ONLY live-decision path: the row must still be PENDING -- if a
    // decide-then-claim gap ever left it at APPROVED (it should not, since
    // this call skips that state entirely), this branch does NOT fall
    // through to the ordinary APPROVED check below, because an
    // APPROVED-but-not-live-claimed row is not a valid live-human
    // authority; it is a token, and this path never consumes tokens.
    if (existing.status !== "PENDING") {
      return {
        kind: "denied",
        reason: `Approval request ${existing.id} is not PENDING (status=${existing.status}) and cannot accept a live-human decision`,
        record: existing,
      };
    }
    try {
      const claimed = await claimApprovalRequestAsLiveHuman(existing.id, {
        entityType: input.entityType,
        action: input.action,
        decidedBy: input.liveHumanDecision.decidedBy,
        decisionReason: input.liveHumanDecision.decisionReason,
        ...(input.artifactHash !== undefined ? { artifactHash: input.artifactHash } : {}),
        requestId: input.requestId,
      });
      return { kind: "claimed", record: claimed };
    } catch (error) {
      return {
        kind: "denied",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (existing.status !== "APPROVED") {
    return {
      kind: "denied",
      reason: `Approval request ${existing.id} is not APPROVED (status=${existing.status}) and cannot be claimed`,
      record: existing,
    };
  }

  try {
    const claimed = await claimApprovalRequest(existing.id, {
      entityType: input.entityType,
      action: input.action,
      executorId: input.executorId,
      ...(input.artifactHash !== undefined ? { artifactHash: input.artifactHash } : {}),
      requestId: input.requestId,
    });
    return { kind: "claimed", record: claimed };
  } catch (error) {
    return {
      kind: "denied",
      reason: error instanceof Error ? error.message : String(error),
      record: existing,
    };
  }
}

async function runPolicy(
  input: RunGovernedClaimedExecutionInput<unknown>,
  claimed: ApprovalRequest | undefined,
): Promise<DispatchAgentActionResult> {
  return dispatchAgentAction({
    actor: input.actor,
    entityType: input.entityType,
    action: input.action,
    routeLabel: input.routeLabel,
    sourceContext: input.sourceContext,
    projectId: input.projectId ?? null,
    input: {
      ...(input.dispatchInput ?? {}),
      ...(input.artifactHash !== undefined ? { artifactHash: input.artifactHash } : {}),
    },
    requestId: input.requestId,
    ...(input.agentRuntimeStatus !== undefined
      ? { agentRuntimeStatus: input.agentRuntimeStatus }
      : {}),
    ...(input.delegationHopCount !== undefined
      ? { delegationHopCount: input.delegationHopCount }
      : {}),
    ...(input.trustLevel !== undefined ? { trustLevel: input.trustLevel } : {}),
    ...(claimed !== undefined ? { claimedApproval: claimed } : {}),
  });
}

/**
 * Shared claim → Phase 3E → Policy/Risk → mark-started → execute-once → finalize.
 * Not a second approval authority.
 */
export async function runGovernedClaimedExecution<T>(
  input: RunGovernedClaimedExecutionInput<T>,
): Promise<HelperResult<T>> {
  const occupancy = await claimOrResume(input);

  if (occupancy.kind === "denied") {
    return {
      status: "DENIED",
      stage: "APPROVAL",
      reason: occupancy.reason,
      gate: undefined,
      approvalRecord: occupancy.record,
    };
  }

  if (occupancy.kind === "replay") {
    const record = occupancy.record;
    const handle = ref(record);
    if (record.status === "FULFILLED") {
      return {
        status: "EXECUTED",
        value: (record.outputEvidence ?? "") as T,
        approval: handle
          ? { ...handle, finalOutcome: "FULFILLED" }
          : null,
        gate: undefined,
        approvalRecord: record,
      };
    }
    if (record.status === "OUTCOME_UNKNOWN") {
      return {
        status: "OUTCOME_UNKNOWN",
        reason: record.finalizeReason ?? "execution outcome is unknown",
        approval: handle ?? { id: record.id, liveExecutionId: record.id },
        gate: undefined,
        approvalRecord: record,
      };
    }
    return {
      status: "FAILED",
      reason: record.finalizeReason ?? "approval already finalized as FAILED",
      ...(handle ? { approval: { ...handle, finalOutcome: "FAILED" as const } } : {}),
      gate: undefined,
      approvalRecord: record,
    };
  }

  if (occupancy.kind === "started") {
    const record = occupancy.record;
    const handle = ref(record);
    if (!handle) {
      return {
        status: "FAILED",
        reason: "started claim is missing liveExecutionId",
        gate: undefined,
        approvalRecord: record,
      };
    }
    const finalized = await finalizeClaimed(record, "OUTCOME_UNKNOWN", {
      reason: "execution started and no durable success or failure receipt exists",
    });
    if ("incomplete" in finalized) {
      return {
        status: "FINALIZE_INCOMPLETE",
        reason: finalized.reason,
        approval: handle,
        intendedOutcome: "OUTCOME_UNKNOWN",
        gate: undefined,
        approvalRecord: record,
      };
    }
    return {
      status: "OUTCOME_UNKNOWN",
      reason: finalized.finalizeReason ?? "execution outcome is unknown",
      approval: handle,
      gate: undefined,
      approvalRecord: finalized,
    };
  }

  const claimed = occupancy.kind === "claimed" ? occupancy.record : undefined;
  const gate = await runPolicy(input, claimed);

  if (gate.decision === "DENIED") {
    const phase3eMismatch = gate.reason === "Claimed approval does not match this governed action";
    // A binding mismatch is fail-closed, not a Policy/Risk deny. Leave the
    // existing CLAIMED occupancy unchanged so the rightful executor can resume.
    if (claimed && !phase3eMismatch) {
      const handle = ref(claimed);
      const finalized = await finalizeClaimed(claimed, "FAILED", { reason: gate.reason });
      if ("incomplete" in finalized && handle) {
        return {
          status: "FINALIZE_INCOMPLETE",
          reason: finalized.reason,
          approval: handle,
          intendedOutcome: "FAILED",
          gate,
          approvalRecord: claimed,
        };
      }
    }
    return {
      status: "DENIED",
      stage: phase3eMismatch ? "APPROVAL" : "POLICY",
      reason: gate.reason,
      gate,
      approvalRecord: claimed,
    };
  }

  if (gate.decision === "APPROVAL_REQUIRED") {
    if (claimed) {
      await finalizeClaimed(claimed, "FAILED", {
        reason: `approval ${gate.approvalRequestId} required; existing claim cannot satisfy this gate`,
      });
    }
    return {
      status: "APPROVAL_REQUIRED",
      approvalRequestId: gate.approvalRequestId,
      reason: `approval ${gate.approvalRequestId} required before execution`,
      gate,
      approvalRecord: claimed,
    };
  }

  if (claimed) {
    const handle = ref(claimed);
    if (!handle) {
      return {
        status: "FAILED",
        reason: "claimed approval is missing liveExecutionId",
        gate,
        approvalRecord: claimed,
      };
    }
    if (claimed.executionStartedAt !== null || startClaims.has(handle.liveExecutionId)) {
      const finalized = await finalizeClaimed(claimed, "OUTCOME_UNKNOWN", {
        reason: "execution already started for this liveExecutionId",
      });
      if ("incomplete" in finalized) {
        return {
          status: "FINALIZE_INCOMPLETE",
          reason: finalized.reason,
          approval: handle,
          intendedOutcome: "OUTCOME_UNKNOWN",
          gate,
          approvalRecord: claimed,
        };
      }
      return {
        status: "OUTCOME_UNKNOWN",
        reason: finalized.finalizeReason ?? "execution already started",
        approval: handle,
        gate,
        approvalRecord: finalized,
      };
    }

    startClaims.add(handle.liveExecutionId);
    let started: ApprovalRequest;
    try {
      started = await markApprovalExecutionStarted(claimed.id, handle.liveExecutionId);
    } catch (error) {
      startClaims.delete(handle.liveExecutionId);
      const reason = error instanceof Error ? error.message : String(error);
      const finalized = await finalizeClaimed(claimed, "FAILED", { reason });
      if ("incomplete" in finalized) {
        return {
          status: "FINALIZE_INCOMPLETE",
          reason: finalized.reason,
          approval: handle,
          intendedOutcome: "FAILED",
          gate,
          approvalRecord: claimed,
        };
      }
      return {
        status: "FAILED",
        reason,
        approval: { ...handle, finalOutcome: "FAILED" },
        gate,
        approvalRecord: finalized,
      };
    }

    let executed: GovernedExecuteOnceResult<T>;
    try {
      executed = await input.executeOnce({ gate, approval: started });
    } catch (error) {
      executed = {
        kind: "FAILURE",
        reason: error instanceof Error ? error.message : String(error),
      };
    }

    if (executed.kind === "FAILURE") {
      const finalized = await finalizeClaimed(started, "FAILED", { reason: executed.reason });
      if ("incomplete" in finalized) {
        return {
          status: "FINALIZE_INCOMPLETE",
          reason: finalized.reason,
          approval: handle,
          intendedOutcome: "FAILED",
          gate,
          approvalRecord: started,
        };
      }
      return {
        status: "FAILED",
        reason: executed.reason,
        approval: { ...handle, finalOutcome: "FAILED" },
        gate,
        approvalRecord: finalized,
      };
    }

    const finalized = await finalizeClaimed(started, "FULFILLED", {
      ...(executed.runtimeExecutionId !== undefined
        ? { runtimeExecutionId: executed.runtimeExecutionId }
        : {}),
      ...(executed.outputEvidence !== undefined
        ? { outputEvidence: executed.outputEvidence }
        : {}),
    });
    if ("incomplete" in finalized) {
      return {
        status: "FINALIZE_INCOMPLETE",
        reason: finalized.reason,
        approval: handle,
        intendedOutcome: "FULFILLED",
        value: executed.value,
        gate,
        approvalRecord: started,
      };
    }
    return {
      status: "EXECUTED",
      value: executed.value,
      approval: { ...handle, finalOutcome: "FULFILLED" },
      gate,
      approvalRecord: finalized,
    };
  }

  let executed: GovernedExecuteOnceResult<T>;
  try {
    executed = await input.executeOnce({ gate, approval: undefined });
  } catch (error) {
    return {
      status: "FAILED",
      reason: error instanceof Error ? error.message : String(error),
      gate,
      approvalRecord: undefined,
    };
  }
  if (executed.kind === "FAILURE") {
    return {
      status: "FAILED",
      reason: executed.reason,
      gate,
      approvalRecord: undefined,
    };
  }
  return {
    status: "EXECUTED",
    value: executed.value,
    approval: null,
    gate,
    approvalRecord: undefined,
  };
}

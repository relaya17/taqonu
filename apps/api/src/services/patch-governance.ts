import type { FastifyReply } from "fastify";
import {
  AtlasError,
  type AuthUser,
  type PatchArtifact,
  type PatchRisk,
  type ToolRisk,
} from "@atlas/shared";
import {
  authorizeEntityAction,
  bucketForRiskScore,
  computeActionRiskScore,
  explainRiskScore,
  type EntityAction,
  type EntityAuthorizationDecision,
} from "@atlas/agent-core";
import { resolve } from "node:path";
import { osStore } from "../store/os-store.js";
import type { MemoryStoreEnv } from "@atlas/database";
import {
  applyApprovedPatch,
  assertPatchApplicable,
  assertPatchApprovedForApply,
  patchArtifactHash,
  resolveApplyWorkspaceRoot,
} from "./patch-write.js";
import { createApprovalRequest, getApprovalRequest } from "./approvals.js";
import { appendUnifiedAuditEntry } from "./audit-log.js";
import {
  runGovernedClaimedExecution,
  type HelperResult,
} from "./governed-claimed-execution.js";
import { runLiveHumanDecisionExecution } from "./live-human-execution.js";

/**
 * Shared governance helpers for every route that applies or rolls back a
 * PatchArtifact (`/code/patches/*`, `/remediation/drafts/*`). Moved out of
 * `routes/code.ts` unchanged in Stage 5 so both paths use one approval
 * mechanism instead of two (Stage 5, G-1/G-2 convergence).
 */
/**
 * Maps the patch-level `PatchRisk` tier (`LOW|MEDIUM|HIGH|CRITICAL`, set by
 * the proposer / `code-intelligence` risk ranking) onto the entity-policy
 * layer's `ToolRisk` tier (`READ_ONLY|LOW_RISK_WRITE|HIGH_RISK_WRITE|
 * DESTRUCTIVE`) so it can feed `computeActionRiskScore`'s `baseTier`. A code
 * patch apply/rollback is never READ_ONLY (it mutates files on disk), so
 * that tier is intentionally unused here. `HIGH` and `CRITICAL` both map to
 * `DESTRUCTIVE` because `ToolRisk` has no tier above it — the two are still
 * distinguished by whatever `confidence`/`evidenceCount` the patch itself
 * carries, which is the best signal this route has beyond the coarse tier.
 */
export function patchRiskToToolRisk(risk: PatchRisk): ToolRisk {
  switch (risk) {
    case "LOW":
      return "LOW_RISK_WRITE";
    case "MEDIUM":
      return "HIGH_RISK_WRITE";
    case "HIGH":
    case "CRITICAL":
      return "DESTRUCTIVE";
    default:
      return "DESTRUCTIVE";
  }
}

/**
 * Route-level 202 gate only. Does not authorize live execution.
 *
 * `entityApproved` is the patch-status signal for this score:
 *   - apply: `assertPatchApprovedForApply` already proved POST /patches/:id/approve
 *   - rollback: no equivalent patch-status gate, so false
 *
 * A live `ApprovalRequest` is never established by this boolean. Execution
 * goes through `runGovernedClaimedExecution`.
 */
export function evaluatePatchActionRisk(input: {
  readonly patch: PatchArtifact;
  readonly entityApproved: boolean;
}): {
  readonly entityAuthz: EntityAuthorizationDecision;
  readonly score: number;
  readonly bucket: ReturnType<typeof bucketForRiskScore>;
  readonly explanation: ReturnType<typeof explainRiskScore>;
} {
  const entityAuthz = authorizeEntityAction("DOCUMENT", "EXECUTE", {
    // `AgentMode` (@atlas/shared) has no literal "EXECUTE" value; "WRITE" is
    // the closest real mode for an action that mutates workspace files.
    mode: "WRITE",
    approved: input.entityApproved,
    writeGateOpen: true,
  });

  const riskInput = {
    baseTier: patchRiskToToolRisk(input.patch.risk),
    confidence: input.patch.confidence,
    evidenceCount: input.patch.evidenceIds.length,
    requiresApproval: entityAuthz.decision === "APPROVAL_REQUIRED",
  };
  const score = computeActionRiskScore(riskInput);
  const bucket = bucketForRiskScore(score);
  const explanation = explainRiskScore(riskInput);

  return { entityAuthz, score, bucket, explanation };
}

export async function assertApprovalMatchesPatch(
  approvalId: string,
  patchId: string,
  route: string,
): Promise<void> {
  const approval = await getApprovalRequest(approvalId);
  const mintedPatch = approval?.context?.patchId;
  if (typeof mintedPatch === "string" && mintedPatch !== patchId) {
    throw new AtlasError(
      "FORBIDDEN",
      "Approval does not belong to this patch",
      { statusCode: 403 },
    );
  }
  const mintedRoute = approval?.context?.route;
  if (typeof mintedRoute === "string" && mintedRoute !== route) {
    throw new AtlasError(
      "FORBIDDEN",
      "Approval does not belong to this action",
      { statusCode: 403 },
    );
  }
}

export async function assertApprovalWorkspaceUnchanged(
  approvalId: string,
  projectId: string | null,
): Promise<void> {
  if (!projectId) return;
  const approval = await getApprovalRequest(approvalId);
  const minted =
    approval && typeof approval.context?.workspaceRoot === "string"
      ? resolve(approval.context.workspaceRoot)
      : null;
  if (!minted) return;
  const current = osStore.getWorkspaceRoot(projectId);
  if (!current || resolve(current) !== minted) {
    throw new AtlasError(
      "FORBIDDEN",
      "Workspace root changed since this approval was minted",
      { statusCode: 403 },
    );
  }
}

export function approvalWorkspaceContext(projectId: string | null): string | null {
  if (!projectId) return null;
  return osStore.getWorkspaceRoot(projectId) ?? null;
}

export function approvalRequiredBody(
  approvalId: string,
  extras?: { readonly riskScore?: number; readonly riskBucket?: string },
) {
  return {
    status: "APPROVAL_REQUIRED" as const,
    approvalId,
    ...(extras?.riskScore !== undefined ? { riskScore: extras.riskScore } : {}),
    ...(extras?.riskBucket !== undefined ? { riskBucket: extras.riskBucket } : {}),
    message:
      "Submit POST /api/v1/approvals/:id/decide to approve, then retry this " +
      `request with ?approvalId=${approvalId}.`,
  };
}

export function throwPatchHelperFailure(helper: HelperResult<unknown>): never {
  const reason = "reason" in helper ? helper.reason : "governed execution failed";
  if (helper.status === "DENIED" && /not found/i.test(helper.reason)) {
    throw new AtlasError("NOT_FOUND", helper.reason, { statusCode: 404 });
  }
  if (helper.status === "OUTCOME_UNKNOWN" || helper.status === "FINALIZE_INCOMPLETE") {
    throw new AtlasError("CONFLICT", reason, { statusCode: 409 });
  }
  throw new AtlasError("FORBIDDEN", reason, { statusCode: 403 });
}

export async function runPatchClaimedExecution<T>(input: {
  readonly user: AuthUser;
  readonly patch: PatchArtifact;
  readonly requestId: string;
  readonly routeLabel: string;
  readonly approvalRequestId?: string;
  readonly action: EntityAction;
  readonly execute: () => T;
  readonly evidence: (value: T) => string;
}): Promise<HelperResult<T>> {
  return runGovernedClaimedExecution({
    executorId: input.user.id,
    actor: {
      kind: "AGENT",
      agentId: input.user.id,
      onBehalfOfUserId: input.user.id,
    },
    entityType: "DOCUMENT",
    action: input.action,
    artifactHash: patchArtifactHash(input.patch),
    ...(input.approvalRequestId !== undefined
      ? { approvalRequestId: input.approvalRequestId }
      : {}),
    requestId: input.requestId,
    sourceContext: { origin: "user_message", trustLevel: "trusted" },
    ...(input.patch.projectId ? { projectId: input.patch.projectId } : {}),
    routeLabel: input.routeLabel,
    // Step 4 patch-approval regression fix: the SAME signal
    // `evaluatePatchActionRisk` already uses for this patch's own risk
    // classification, now also reaching `dispatchAgentAction`'s own,
    // previously-blind, internal recheck -- see
    // `RunGovernedClaimedExecutionInput.confidence`/`evidenceCount` for why
    // this was missing and what it fixes.
    confidence: input.patch.confidence,
    evidenceCount: input.patch.evidenceIds.length,
    dispatchInput: { patchId: input.patch.id, route: input.routeLabel },
    executeOnce: async () => {
      try {
        const value = input.execute();
        return {
          kind: "SUCCESS",
          value,
          outputEvidence: input.evidence(value),
        };
      } catch (error) {
        return {
          kind: "FAILURE",
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });
}

/**
 * CP7.1/CP7.2 HUMAN_ONLY live-human path -- mirrors `runPatchClaimedExecution`
 * exactly, except the claim is established by a live, separately-
 * authenticated human decision (`claim_live_approval_request_as_live_human`,
 * no intermediate APPROVED token) rather than by presenting a previously-
 * decided approval id. `DOCUMENT.EXECUTE` is HIGH_RISK_WRITE tier, which
 * (with the conservative default confidence/evidence this route supplies
 * none of) lands at exactly the HUMAN_ONLY threshold -- so a HIGH/CRITICAL
 * patch's approval can be granted via `/decide` but can never be consumed
 * by the ordinary `?approvalId=` retry (see `agent-dispatch-guard.ts`'s
 * unconditional HUMAN_ONLY block for AGENT-kind actors). This is that
 * action's only executable path.
 */
export async function runPatchLiveHumanClaimedExecution<T>(input: {
  readonly patch: PatchArtifact;
  readonly deciderId: string;
  readonly decisionReason: string;
  readonly approvalId: string;
  readonly requestId: string;
  readonly routeLabel: string;
  readonly action: EntityAction;
  readonly execute: () => T;
  readonly evidence: (value: T) => string;
}): Promise<HelperResult<T>> {
  return runLiveHumanDecisionExecution({
    approvalId: input.approvalId,
    deciderId: input.deciderId,
    decisionReason: input.decisionReason,
    entityType: "DOCUMENT",
    action: input.action,
    artifactHash: patchArtifactHash(input.patch),
    requestId: input.requestId,
    sourceContext: { origin: "user_message", trustLevel: "trusted" },
    ...(input.patch.projectId ? { projectId: input.patch.projectId } : {}),
    routeLabel: input.routeLabel,
    dispatchInput: { patchId: input.patch.id, route: input.routeLabel },
    executeOnce: async () => {
      try {
        const value = input.execute();
        return {
          kind: "SUCCESS",
          value,
          outputEvidence: input.evidence(value),
        };
      } catch (error) {
        return {
          kind: "FAILURE",
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });
}

export async function sendPatchHelperResult<T>(
  reply: FastifyReply,
  helper: HelperResult<T>,
): Promise<T> {
  if (helper.status === "EXECUTED") {
    // Terminal FULFILLED replay has no gate. Do not report a second success
    // and do not run the callback again.
    if (helper.gate === undefined) {
      throw new AtlasError(
        "FORBIDDEN",
        helper.approval
          ? `Approval request ${helper.approval.id} is already finalized`
          : "approval already finalized",
        { statusCode: 403 },
      );
    }
    return helper.value;
  }
  if (helper.status === "APPROVAL_REQUIRED") {
    const extras =
      helper.gate.decision === "APPROVAL_REQUIRED"
        ? { riskScore: helper.gate.score, riskBucket: helper.gate.bucket }
        : undefined;
    return reply.status(202).send(
      approvalRequiredBody(helper.approvalRequestId, extras),
    ) as T;
  }
  throwPatchHelperFailure(helper);
}


/**
 * The one governed Apply for a PatchArtifact, used by `/code/patches/:id/apply`
 * and `/remediation/drafts/:id/apply` (Stage 5 convergence). Behavior of the
 * Studio path is unchanged; Stage 5 adds a stale-state preflight before the
 * approval is minted and before it is claimed, so a stale patch neither
 * consumes an approval nor writes anything.
 */
export async function governedPatchApply(input: {
  readonly reply: FastifyReply;
  readonly existing: PatchArtifact;
  readonly user: AuthUser;
  readonly requestId: string;
  readonly bodyWorkspaceRoot: string | null;
  readonly approvalId: string | null;
  readonly env: MemoryStoreEnv | null;
  readonly routeLabel?: string;
}): Promise<unknown> {
  const { existing, user, reply } = input;
  // Preserve the existing invariant (403 "approve first") before layering
  // the risk-based gate on top.
  assertPatchApprovedForApply(existing);

  const { entityAuthz, score, bucket, explanation } = evaluatePatchActionRisk({
    patch: existing,
    entityApproved: true,
  });
  if (entityAuthz.decision === "DENIED") {
    throw new AtlasError("FORBIDDEN", entityAuthz.reason, {
      statusCode: 403,
    });
  }

  const workspaceRoot = resolveApplyWorkspaceRoot({
    projectId: existing.projectId,
    bodyWorkspaceRoot: input.bodyWorkspaceRoot,
  });
  assertPatchApplicable({ patch: existing, workspaceRoot, actorId: user.id });

  // DOCUMENT.EXECUTE's approval requirement is unconditional for every
  // bucket: a real ApprovalRequest decided by a different identity is
  // required before apply (see the Step 4 notes preserved in git history of
  // routes/code.ts).
  if (!input.approvalId) {
    const approval = await createApprovalRequest({
      entityType: "DOCUMENT",
      action: "EXECUTE",
      requestedBy: user.id,
      reason: `apply patch ${existing.id} (${explanation.bucket}, score=${explanation.score}): ${explanation.factors.join("; ")}`,
      artifactHash: patchArtifactHash(existing),
      context: {
        route: "code.patch.apply",
        patchId: existing.id,
        correlationId: existing.id,
        risk: existing.risk,
        workspaceRoot: approvalWorkspaceContext(existing.projectId),
      },
    });
    return reply.status(202).send(
      approvalRequiredBody(approval.id, {
        riskScore: score,
        riskBucket: bucket,
      }),
    );
  }

  await assertApprovalMatchesPatch(input.approvalId, existing.id, "code.patch.apply");
  await assertApprovalWorkspaceUnchanged(input.approvalId, existing.projectId);

  const helper = await runPatchClaimedExecution({
    user,
    patch: existing,
    requestId: input.requestId,
    routeLabel: input.routeLabel ?? "code.patch.apply.gate",
    action: "EXECUTE",
    approvalRequestId: input.approvalId,
    execute: () =>
      applyApprovedPatch({
        existing,
        user,
        bodyWorkspaceRoot: input.bodyWorkspaceRoot,
        env: input.env,
      }),
    evidence: (value) =>
      JSON.stringify({ status: value.patch.status, applied: value.apply.applied }),
  });
  const result = await sendPatchHelperResult(reply, helper);
  if (helper.status !== "EXECUTED") {
    return result;
  }

  appendUnifiedAuditEntry({
    type: "code.patch.applied",
    actorId: user.id,
    actorKind: "USER",
    reason: `${explanation.bucket} (score=${explanation.score}): ${explanation.factors.join("; ")}`,
    correlationId: existing.id,
    causationId: input.approvalId,
    input: {
      patchId: existing.id,
      patchRisk: existing.risk,
      applyWorkspaceRoot: input.bodyWorkspaceRoot,
      approvalId: input.approvalId,
    },
    output: { status: result.patch.status, applied: result.apply.applied },
    policy: "DOCUMENT.EXECUTE",
    risk: existing.risk,
    approval: "APPROVED",
    result: "SUCCESS",
    projectId: existing.projectId,
  });

  return result;
}

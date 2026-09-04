import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import {
  executeTool,
  extractGovernedTarget,
  resolveCanonicalToolOperationForRequest,
  type BusinessEntityType,
  type CanonicalTarget,
  type EntityAction,
  type ToolExecutionOutcome,
} from "@atlas/agent-core";
import { findRepoRoot } from "./repo-root.js";
import {
  agentMayExecute,
  canonicalizeJson,
  combineAgentRuntimeStatus,
  effectiveDelegationHopCount,
  type ApprovalRequest,
  type GovernanceDecision,
  type GovernanceDecisionInput,
} from "@atlas/shared";
import { appendUnifiedAuditEntry } from "./audit-log.js";
import {
  enforceAgentToolAuthorization,
  type AuthenticatedAgentIdentity,
  type ToolExecutionPayload,
} from "./agent-runtime-authz.js";
import {
  type DispatchAgentActionResult,
  type DispatchSourceContext,
} from "./agent-dispatch-guard.js";
import { persistGovernanceDecision } from "./governance-decision.js";
import { runGovernedClaimedExecution } from "./governed-claimed-execution.js";

/**
 * P0.7 — the single transactional execution gate.
 *
 * Everything built before this is an ENGINE: identity resolution, tool
 * authorization, the Policy/Risk dispatch gate, approval↔artifact binding,
 * the Tool Runtime, the audit chain. Each is individually correct and
 * individually tested — and none of them called each other. An agent could
 * reach `executeTool()` without ever passing `enforceAgentToolAuthorization`,
 * or consume an approval without the artifact it was bound to.
 *
 * A security module nothing routes through is theatre. This is the one path
 * that composes them, in a fixed order, with no way around it.
 *
 * ── Fail-closed ordering ─────────────────────────────────────────────
 *
 * The stages run cheapest-and-most-fundamental first, so an unauthorized
 * request is rejected before it can cost anything or touch any state:
 *
 *   1. Catalog authorization — may this agent use this tool at all?
 *   2. Resolve canonical ToolPolicy operation from toolName
 *   3. Validate asserted entityType/action (match or omit; never rewrite)
 *   4. Extract canonical target — bind the instance the tool will execute against
 *   5. Compute governed binding hash — pin canonical target + caller artifact
 *   6. Idempotency — same key + same binding hash replays
 *   7. Claim or resume — durable CLAIMED occupancy for THIS binding
 *   8. Policy/Risk dispatch
 *   9. Execute tool
 *  10. Finalize
 *  11. Audit — always, including on every refusal above.
 *
 * Every stage that cannot reach a positive answer — UNAUTHORIZED, MISSING,
 * STALE, MISMATCH, EXPIRED, UNKNOWN — halts the pipeline. There is no
 * "continue and hope"; the default at every branch is refusal.
 *
 * ── Why approval is claimed BEFORE the risk gate ─────────────────────
 *
 * Claim is the step that can fail on grounds the caller must not be able to
 * retry around (wrong artifact, expired, already claimed). Doing it before
 * the risk gate means a mismatched artifact is rejected on its own terms
 * rather than being masked by a risk decision that happens to also deny.
 */

export type GovernedExecutionOutcome =
  | { readonly stage: "AUTHORIZATION"; readonly status: "DENIED"; readonly reason: string }
  | { readonly stage: "APPROVAL"; readonly status: "DENIED"; readonly reason: string }
  | {
      readonly stage: "POLICY";
      readonly status: "DENIED" | "APPROVAL_REQUIRED";
      readonly reason: string;
    }
  | { readonly stage: "EXECUTION"; readonly status: "FAILED"; readonly reason: string }
  | {
      readonly stage: "EXECUTION";
      readonly status: "EXECUTED";
      readonly artifactHash: string;
      readonly output: string;
    };

export interface GovernedExecutionRequest {
  /** Server-resolved identity — see `resolveAgentIdentity`. Never from a request body. */
  readonly identity: AuthenticatedAgentIdentity;
  /** Tool name, checked against the agent catalog's allowedTools/forbiddenTools. */
  readonly toolName: string;
  readonly toolArgs: Readonly<Record<string, unknown>>;
  /** Payload whose target* fields must not contradict `identity`. */
  readonly payload?: ToolExecutionPayload;
  /**
   * Caller-declared content pin. Combined with the extracted canonical target
   * into `artifactHash` via `computeGovernedBindingHash`. Not a filesystem path.
   */
  readonly artifact: string;
  /**
   * Approval to redeem, when this action required one. Omit for actions that
   * legitimately need none; the Policy/Risk gate still applies.
   */
  readonly approvalRequestId?: string;
  /**
   * Assertion of the tool's ToolPolicy operation. Omit both to use the
   * canonical pair. Supplying only one field is rejected. Mismatch is
   * rejected — never rewritten. Downstream claim/policy always use the
   * canonical pair.
   */
  readonly entityType?: BusinessEntityType;
  readonly action?: EntityAction;
  readonly sourceContext: DispatchSourceContext;
  readonly projectRoot: string;
  readonly routeLabel: string;
  readonly applicationId?: string;
  readonly operation?: string;
  /**
   * The HTTP request boundary this execution belongs to — Fastify's
   * `request.id`. Supplied by the route rather than minted here: an id
   * generated inside this function would identify the call, not the request,
   * and Invariant 10 exists so an auditor can walk back to the request.
   */
  readonly requestId: string;
  /**
   * Control Plane runtime status of the agent. PAUSED/QUARANTINED/REVOKED
   * agents cannot execute. Defaults to "ACTIVE" if not provided.
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
   * User → Orchestrator → Specialist → Tool is 2 hops.
   * Each hop floors the risk bucket to at least APPROVAL.
   */
  readonly delegationHopCount?: number;
  /**
   * Optional retry key. The same key + same artifact is a no-op replay of
   * the first outcome. The same key with a different artifact is refused.
   * This is process-local — not a durable job queue.
   */
  readonly idempotencyKey?: string;
}

export function computeArtifactHash(artifact: string): string {
  return createHash("sha256").update(artifact, "utf8").digest("hex");
}

/**
 * Occupancy / audit / idempotency pin for governed *tool* execution.
 * Preimage is `canonicalizeJson` of `{ schemaVersion, target, artifact }`.
 * `projectRoot`, `toolName`, `toolArgs`, and entity/action class are not hashed.
 * Patch occupancy continues to use `computeArtifactHash` on its own payload.
 */
export function computeGovernedBindingHash(
  target: CanonicalTarget,
  artifact: string,
): string {
  return computeArtifactHash(
    canonicalizeJson({
      schemaVersion: "atlas.governed-binding/v1",
      target: { kind: target.kind, value: target.value },
      artifact,
    }),
  );
}

/**
 * Sanitize error messages to avoid leaking absolute server paths.
 * Absolute paths (starting with / or C:\ etc.) are removed from error messages.
 */
function sanitizeErrorMessage(message: string): string {
  // Remove Windows absolute paths (e.g., C:\Users\..., D:\path\...)
  // Remove Unix absolute paths (e.g., /home/user/..., /var/...)
  // Preserve only the filename or a generic message
  return message
    .replace(/[A-Za-z]:\\[^'":\s]+/g, "<path-redacted>")
    .replace(/\/(?:home|var|tmp|Users|root|etc|opt)[^'":\s]*/g, "<path-redacted>");
}

interface IdempotentExecution {
  readonly artifactHash: string;
  readonly outcome: GovernedExecutionOutcome;
}

const governedIdempotency = new Map<string, IdempotentExecution>();
let idempotencyPathOverride: string | null = null;

function resolveGovernedIdempotencyPath(): string {
  if (idempotencyPathOverride) return idempotencyPathOverride;
  const fromEnv = process.env.ATLAS_GOVERNED_IDEMPOTENCY_PATH?.trim();
  if (fromEnv) return resolve(fromEnv);
  return resolve(findRepoRoot(), ".atlas", "governed-idempotency.json");
}

function persistenceEnabled(): boolean {
  if (idempotencyPathOverride) return true;
  if (process.env.VITEST === "true") return false;
  return true;
}

function persistGovernedIdempotency(): void {
  if (!persistenceEnabled()) return;
  const path = resolveGovernedIdempotencyPath();
  mkdirSync(dirname(path), { recursive: true });
  const payload = {
    version: 1 as const,
    entries: [...governedIdempotency.entries()].map(([key, value]) => ({
      key,
      artifactHash: value.artifactHash,
      outcome: value.outcome,
    })),
  };
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(payload), "utf8");
  try {
    try {
      renameSync(tmpPath, path);
    } catch {
      copyFileSync(tmpPath, path);
      unlinkSync(tmpPath);
    }
  } catch (error) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // ignore leftover temp cleanup
    }
    throw error;
  }
}

function loadGovernedIdempotency(): void {
  governedIdempotency.clear();
  const path = resolveGovernedIdempotencyPath();
  if (!existsSync(path)) return;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      entries?: Array<{ key?: string; artifactHash?: string; outcome?: GovernedExecutionOutcome }>;
    };
    for (const entry of parsed.entries ?? []) {
      if (!entry.key || !entry.artifactHash || !entry.outcome) continue;
      governedIdempotency.set(entry.key, {
        artifactHash: entry.artifactHash,
        outcome: entry.outcome,
      });
    }
  } catch {
    // fail closed to empty replay cache; execution still requires live authorization
  }
}

if (persistenceEnabled()) {
  loadGovernedIdempotency();
}

export function resetGovernedIdempotencyForTests(): void {
  governedIdempotency.clear();
  if (idempotencyPathOverride && existsSync(idempotencyPathOverride)) {
    unlinkSync(idempotencyPathOverride);
  }
}

export function setGovernedIdempotencyPathForTests(path: string | null): void {
  idempotencyPathOverride = path;
  loadGovernedIdempotency();
}

/** Simulate process restart: drop memory and reload the durable file. */
export function reloadGovernedIdempotencyForTests(): void {
  governedIdempotency.clear();
  loadGovernedIdempotency();
}

interface GovernanceAuditContext {
  readonly gate: DispatchAgentActionResult | undefined;
  readonly approval: ApprovalRequest | undefined;
}

const EMPTY_GOVERNANCE_AUDIT_CONTEXT: GovernanceAuditContext = {
  gate: undefined,
  approval: undefined,
};

function resolveApprovalStatus(
  outcome: GovernedExecutionOutcome,
  generatedApprovalId: string | null,
  approval: ApprovalRequest | undefined,
): GovernanceDecision["approval"]["status"] {
  if (outcome.stage === "APPROVAL" && outcome.status === "DENIED") return "REJECTED";
  if (generatedApprovalId) return "REQUIRED";
  if (approval?.status === "FULFILLED" || approval?.status === "CLAIMED") return "CONSUMED";
  return "NOT_REQUIRED";
}

function resolveDecision(
  outcome: GovernedExecutionOutcome,
): GovernanceDecision["decision"] {
  if (outcome.status === "APPROVAL_REQUIRED") return "REQUIRE_APPROVAL";
  if (outcome.status === "DENIED") return "DENY";
  return "ALLOW";
}

function resolveExecution(
  outcome: GovernedExecutionOutcome,
): GovernanceDecision["execution"] {
  if (outcome.status === "EXECUTED") {
    return { status: "EXECUTED", result: "SUCCESS", reason: null };
  }
  if (outcome.stage === "EXECUTION") {
    return { status: "FAILED", result: "FAILURE", reason: outcome.reason };
  }
  return {
    status: "NOT_RUN",
    result: "NOT_RUN",
    reason: "reason" in outcome ? outcome.reason : null,
  };
}

function buildGovernanceDecision(
  request: GovernedExecutionRequest,
  artifactHash: string,
  outcome: GovernedExecutionOutcome,
  context: GovernanceAuditContext,
): GovernanceDecisionInput {
  const gateEvaluation = context.gate?.evaluation;
  const generatedApprovalId =
    context.gate?.decision === "APPROVAL_REQUIRED"
      ? context.gate.approvalRequestId
      : null;
  const approvalRequestId = generatedApprovalId ?? request.approvalRequestId ?? null;
  let policyReason = gateEvaluation?.policy.reason ?? null;
  if (!policyReason && (outcome.stage === "AUTHORIZATION" || outcome.stage === "APPROVAL")) {
    policyReason = "Request stopped before canonical policy evaluation";
  }

  return {
    schemaVersion: "1.0.0",
    recordType: "governance.decision",
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    expiresAt: context.approval?.expiresAt ?? null,
    decision: resolveDecision(outcome),
    stage: outcome.stage,
    status: outcome.status,
    actor: {
      principalId: request.identity.ownerId,
      kind: "AGENT",
      ownerId: request.identity.ownerId,
      projectId: request.identity.projectId,
      applicationId: request.applicationId ?? null,
      agentId: request.identity.agentId,
    },
    operation: request.operation ?? request.routeLabel,
    resource: {
      entityType: request.entityType ?? "DOCUMENT",
      action: request.action ?? "READ",
      artifactHash,
    },
    policy: {
      authority: "DEFAULT_ENTITY_POLICIES",
      version: null,
      result: gateEvaluation?.policy.result ?? "NOT_EVALUATED",
      reason: policyReason,
      riskTier: gateEvaluation?.policy.riskTier ?? null,
      requiresApproval: gateEvaluation?.policy.requiresApproval ?? null,
    },
    risk: {
      status: gateEvaluation?.risk.status ?? "NOT_EVALUATED",
      score: gateEvaluation?.risk.score ?? null,
      rawBucket: gateEvaluation?.risk.rawBucket ?? null,
      effectiveBucket: gateEvaluation?.risk.effectiveBucket ?? null,
      factors: [...(gateEvaluation?.risk.factors ?? [])],
      floors: gateEvaluation?.risk.floors ?? {
        untrustedSource: false,
        automationActor: false,
        delegation: false,
      },
    },
    approval: {
      required: approvalRequestId !== null || outcome.status === "APPROVAL_REQUIRED",
      requestId: approvalRequestId,
      status: resolveApprovalStatus(outcome, generatedApprovalId, context.approval),
    },
    correlation: { requestId: request.requestId },
    provenance: {
      sourceOrigin: request.sourceContext.origin,
      sourceTrustLevel: request.sourceContext.trustLevel,
      authorityScope: request.identity.authorityScope ?? null,
      agentTrustLevel: request.identity.trustLevel ?? null,
      delegationHopCount: effectiveDelegationHopCount({
        ...(request.delegationHopCount !== undefined
          ? { delegationHopCount: request.delegationHopCount }
          : {}),
        ...(request.identity.trustLevel !== undefined
          ? { trustLevel: request.identity.trustLevel }
          : {}),
      }),
    },
    execution: resolveExecution(outcome),
  };
}

/** Single audit helper so no refusal path can silently skip the trail. */
function auditOutcome(
  request: GovernedExecutionRequest,
  artifactHash: string,
  outcome: GovernedExecutionOutcome,
  context: GovernanceAuditContext = EMPTY_GOVERNANCE_AUDIT_CONTEXT,
  canonicalTarget?: CanonicalTarget,
): void {
  appendUnifiedAuditEntry({
    type: request.routeLabel,
    actorId: request.identity.agentId,
    actorKind: "AGENT",
    reason: `governed execution: ${outcome.stage}/${outcome.status}`,
    input: {
      toolName: request.toolName,
      artifactHash,
      approvalRequestId: request.approvalRequestId ?? null,
      entityType: request.entityType,
      action: request.action,
      requestId: request.requestId,
      ...(canonicalTarget !== undefined ? { canonicalTarget } : {}),
    },
    output: {
      stage: outcome.stage,
      status: outcome.status,
      reason: "reason" in outcome ? outcome.reason : "ok",
    },
    policy: `${request.entityType ?? "UNRESOLVED"}.${request.action ?? "UNRESOLVED"}`,
    risk: outcome.status === "EXECUTED" ? "LOW" : "HIGH",
    approval: request.approvalRequestId ? "APPROVED" : "NOT_REQUIRED",
    result: outcome.status === "EXECUTED" ? "SUCCESS" : "FAILURE",
    ownerId: request.identity.ownerId,
    projectId: request.identity.projectId,
  });

  persistGovernanceDecision(buildGovernanceDecision(request, artifactHash, outcome, context));
}

/**
 * Run one agent action through every control, in order, or refuse.
 *
 * Never throws for a governance refusal — refusals are values, so a caller
 * cannot accidentally swallow one in a `catch` and proceed. Only genuinely
 * exceptional conditions propagate.
 */
export async function executeGovernedAction(
  request: GovernedExecutionRequest,
): Promise<GovernedExecutionOutcome> {
  const runtimeStatus = combineAgentRuntimeStatus(
    request.agentRuntimeStatus,
    request.identity.runtimeStatus,
  );
  if (!agentMayExecute(runtimeStatus)) {
    const outcome: GovernedExecutionOutcome = {
      stage: "AUTHORIZATION",
      status: "DENIED",
      reason: `Agent "${request.identity.agentId}" is not executable (runtimeStatus=${runtimeStatus})`,
    };
    auditOutcome(request, computeArtifactHash(request.artifact), outcome);
    return outcome;
  }

  const delegationHopCount = effectiveDelegationHopCount({
    ...(request.delegationHopCount !== undefined
      ? { delegationHopCount: request.delegationHopCount }
      : {}),
    ...(request.identity.trustLevel !== undefined
      ? { trustLevel: request.identity.trustLevel }
      : {}),
  });

  // ── 1. Tool authorization (P0.2) ────────────────────────────────────
  try {
    enforceAgentToolAuthorization({
      identity: request.identity,
      requestedTool: request.toolName,
      ...(request.payload !== undefined ? { payload: request.payload } : {}),
    });
  } catch (err) {
    const outcome: GovernedExecutionOutcome = {
      stage: "AUTHORIZATION",
      status: "DENIED",
      reason: err instanceof Error ? err.message : String(err),
    };
    auditOutcome(request, computeArtifactHash(request.artifact), outcome);
    return outcome;
  }

  // ── 2–3. Canonical ToolPolicy operation + assertion ─────────────────
  if ((request.entityType === undefined) !== (request.action === undefined)) {
    const outcome: GovernedExecutionOutcome = {
      stage: "AUTHORIZATION",
      status: "DENIED",
      reason:
        "entityType and action must both be omitted or both be supplied as a matching assertion of the tool's canonical operation",
    };
    auditOutcome(request, computeArtifactHash(request.artifact), outcome);
    return outcome;
  }
  const assertedPair =
    request.entityType !== undefined && request.action !== undefined
      ? { entityType: request.entityType, action: request.action }
      : undefined;
  const canonical = resolveCanonicalToolOperationForRequest(
    request.toolName,
    assertedPair,
  );
  if (!canonical.ok) {
    const outcome: GovernedExecutionOutcome = {
      stage: "AUTHORIZATION",
      status: "DENIED",
      reason: canonical.reason,
    };
    auditOutcome(request, computeArtifactHash(request.artifact), outcome);
    return outcome;
  }
  const governedRequest: GovernedExecutionRequest = {
    ...request,
    entityType: canonical.entityType,
    action: canonical.action,
  };

  // ── 4. Canonical target (instance) ──────────────────────────────────
  const extracted = extractGovernedTarget(
    governedRequest.toolName,
    governedRequest.toolArgs,
    governedRequest.projectRoot,
  );
  if (!extracted.ok) {
    const noExtractor = extracted.reason.startsWith("No governed target extractor");
    const outcome: GovernedExecutionOutcome = noExtractor
      ? {
          stage: "AUTHORIZATION",
          status: "DENIED",
          reason: extracted.reason,
        }
      : {
          stage: "EXECUTION",
          status: "FAILED",
          reason: sanitizeErrorMessage(extracted.reason),
        };
    auditOutcome(governedRequest, computeArtifactHash(governedRequest.artifact), outcome);
    return outcome;
  }

  // ── 5. Binding hash (target + artifact) ─────────────────────────────
  let artifactHash: string;
  try {
    artifactHash = computeGovernedBindingHash(extracted.target, governedRequest.artifact);
  } catch (err) {
    const outcome: GovernedExecutionOutcome = {
      stage: "EXECUTION",
      status: "FAILED",
      reason: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)),
    };
    auditOutcome(governedRequest, computeArtifactHash(governedRequest.artifact), outcome);
    return outcome;
  }

  // ── 6. Idempotency (binding hash) ───────────────────────────────────
  if (governedRequest.idempotencyKey) {
    const prior = governedIdempotency.get(governedRequest.idempotencyKey);
    if (prior) {
      if (prior.artifactHash !== artifactHash) {
        const outcome: GovernedExecutionOutcome = {
          stage: "EXECUTION",
          status: "FAILED",
          reason: "idempotency key reused with a different artifact",
        };
        auditOutcome(
          governedRequest,
          artifactHash,
          outcome,
          EMPTY_GOVERNANCE_AUDIT_CONTEXT,
          extracted.target,
        );
        return outcome;
      }
      return prior.outcome;
    }
  }

  const helper = await runGovernedClaimedExecution({
    executorId: governedRequest.identity.agentId,
    actor: {
      kind: "AGENT",
      agentId: governedRequest.identity.agentId,
      onBehalfOfUserId: governedRequest.identity.ownerId,
    },
    entityType: canonical.entityType,
    action: canonical.action,
    artifactHash,
    ...(governedRequest.approvalRequestId !== undefined
      ? { approvalRequestId: governedRequest.approvalRequestId }
      : {}),
    requestId: governedRequest.requestId,
    sourceContext: governedRequest.sourceContext,
    projectId: governedRequest.identity.projectId,
    routeLabel: `${governedRequest.routeLabel}.gate`,
    agentRuntimeStatus: runtimeStatus,
    delegationHopCount,
    ...(governedRequest.identity.trustLevel !== undefined
      ? { trustLevel: governedRequest.identity.trustLevel }
      : {}),
    dispatchInput: { toolName: governedRequest.toolName, artifactHash },
    executeOnce: async ({ gate }) => {
      let toolResult: ToolExecutionOutcome;
      try {
        toolResult = await executeTool(governedRequest.toolName, governedRequest.toolArgs, {
          projectRoot: governedRequest.projectRoot,
          projectId: governedRequest.identity.projectId,
          correlation: {
            requestId: governedRequest.requestId,
            agentId: governedRequest.identity.agentId,
            proposalId: null,
            governanceDecisionId: gate.decision === "ALLOWED" ? gate.auditId : null,
            authorizationId: governedRequest.approvalRequestId ?? null,
            executionId: "",
            toolCallId: "",
          },
        });
      } catch (err) {
        return {
          kind: "FAILURE",
          reason: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)),
        };
      }
      if (toolResult.status !== "OK") {
        const rawReason =
          toolResult.status === "DENIED"
            ? toolResult.reason
            : toolResult.status === "APPROVAL_REQUIRED"
              ? `tool "${governedRequest.toolName}" requires approval`
              : toolResult.status === "TIMEOUT"
                ? `tool timed out after ${toolResult.timeoutMs}ms`
                : toolResult.reason;
        return { kind: "FAILURE", reason: sanitizeErrorMessage(rawReason) };
      }
      return {
        kind: "SUCCESS",
        value: toolResult.output,
        outputEvidence: toolResult.output,
      };
    },
  });

  const approval = helper.approvalRecord;
  const gate = helper.gate;
  let outcome: GovernedExecutionOutcome;
  if (helper.status === "EXECUTED") {
    outcome = {
      stage: "EXECUTION",
      status: "EXECUTED",
      artifactHash,
      output: typeof helper.value === "string" ? helper.value : String(helper.value ?? ""),
    };
  } else if (helper.status === "DENIED") {
    outcome = {
      stage: helper.stage === "APPROVAL" ? "APPROVAL" : "POLICY",
      status: "DENIED",
      reason: helper.reason,
    };
  } else if (helper.status === "APPROVAL_REQUIRED") {
    outcome = {
      stage: "POLICY",
      status: "APPROVAL_REQUIRED",
      reason: helper.reason,
    };
  } else {
    outcome = {
      stage: "EXECUTION",
      status: "FAILED",
      reason: helper.reason,
    };
  }

  auditOutcome(governedRequest, artifactHash, outcome, { gate, approval }, extracted.target);
  if (governedRequest.idempotencyKey && outcome.status === "EXECUTED") {
    governedIdempotency.set(governedRequest.idempotencyKey, { artifactHash, outcome });
    persistGovernedIdempotency();
  }
  return outcome;
}

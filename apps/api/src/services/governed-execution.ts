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
  MAX_DELEGATION_HOP_COUNT,
  type ApprovalRequest,
  type GovernanceDecision,
  type GovernanceDecisionInput,
} from "@atlas/shared";
import {
  appendUnifiedCanonicalAuditEntry,
  type CanonicalAuditWriteResult,
} from "./audit-log.js";
import {
  claimGovernedExecutionReceipt,
  finalizeGovernedExecutionReceipt,
  isLiveSupabase,
  type GovernedExecutionReceiptStoreEnv,
} from "@atlas/database";
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
      /**
       * P0.1 -- honest, best-effort report of canonical audit durability
       * for THIS outcome: "confirmed" when appendCanonicalAuditEntry wrote
       * to its canonical store (Postgres, or NDJSON when Postgres is not
       * configured and this is not Vercel production); "degraded" when
       * Postgres failed and the NDJSON secondary caught it (see
       * CanonicalAuditWriteResult.degraded in ./audit-log.ts). Never
       * fabricated -- when canonical audit fails outright on a Vercel
       * production runtime, auditOutcome throws instead of returning an
       * outcome with this field set, exactly like the original P0
       * fail-closed behavior. Optional only because outcomes are also
       * constructed, pre-audit, at other points in this file before this
       * field is known.
       */
      readonly auditStatus?: "confirmed" | "degraded";
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
const governedIdempotencyLocks = new Map<string, Promise<unknown>>();
let idempotencyPathOverride: string | null = null;

function withGovernedIdempotencyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (governedIdempotencyLocks.get(key) ?? Promise.resolve()).then(fn, fn);
  governedIdempotencyLocks.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

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
  governedIdempotencyLocks.clear();
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

/**
 * ---------------------------------------------------------------------
 * P0.1 -- durable claim/finalize for the NO-APPROVAL execution path
 * (Correction Design Gate, Issue B; see
 * docs/architecture/ATLAS_MASTER_TRUTH.md section 66 for the full design
 * write-up).
 * ---------------------------------------------------------------------
 *
 * Approval-gated actions already have a fully durable Postgres claim/
 * finalize state machine (public.approval_requests, via
 * runGovernedClaimedExecution / governed-claimed-execution.ts) -- nothing
 * below applies to them. This block exists ONLY for governed actions with
 * no approvalRequestId, where runGovernedClaimedExecution's executeOnce
 * would otherwise run with no protection beyond the in-process
 * `governedIdempotency` Map/file above -- which has the identical
 * ephemeral-Vercel-filesystem durability gap the original P0 fix closed
 * for audit evidence, but here for execution safety instead.
 *
 * Sequence: DURABLE CLAIM -> REAL EXECUTION -> DURABLE FINALIZE ->
 * CANONICAL AUDIT. Finalize is deliberately ordered before the canonical
 * audit write (see finishGovernedExecution below): if canonical audit
 * persistence then fails on a Vercel production runtime, auditOutcome
 * throws (fail-closed, exactly like the original P0 behavior) -- but by
 * that point the durable receipt already reflects the true outcome, so a
 * retry will replay it instead of executing the real action again.
 */

/**
 * Same VERCEL + NODE_ENV=production condition audit-log.ts's
 * isVercelProduction() uses, duplicated locally rather than exported
 * cross-file: this is a one-line, environment-only check, and importing it
 * would couple this file's execution-safety logic to audit-log.ts's public
 * surface for no real reuse benefit.
 */
function isVercelProductionRuntime(): boolean {
  return Boolean(process.env.VERCEL) && process.env.NODE_ENV === "production";
}

/**
 * Same presence-vs-liveness gate as audit-log.ts's getSupabaseEnvFromProcess
 * -- see that function's comment for why `isLiveSupabase` (not mere
 * presence of SUPABASE_* env vars) is required: every existing
 * .env/.env.example ships a `replace-me` placeholder service role key, and
 * treating that as "configured" would misroute every existing test into
 * the fail-closed/degrade branches instead of the intended unchanged
 * (NOT_CONFIGURED) branch.
 */
function getGovernedExecutionReceiptEnv(): GovernedExecutionReceiptStoreEnv | null {
  const url = process.env.SUPABASE_URL?.trim();
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !anonKey || !serviceRoleKey) return null;
  const env: GovernedExecutionReceiptStoreEnv = {
    SUPABASE_URL: url,
    SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  };
  if (!isLiveSupabase(env)) return null;
  return env;
}

/**
 * Only two states are actually reachable: appendCanonicalAuditEntry either
 * writes to a canonical store (Postgres, or NDJSON when Postgres is not
 * configured and this is not Vercel production) and returns normally, or
 * it throws (fail-closed on Vercel production, or both stores failed).
 * There is no reachable "wrote nothing but didn't throw" case, so this
 * never needs a third "unconfirmed" value.
 */
function canonicalAuditStatus(write: CanonicalAuditWriteResult): "confirmed" | "degraded" {
  return write.degraded ? "degraded" : "confirmed";
}

type DurableClaimOutcome =
  /** Won the claim; caller must execute, then finalize. */
  | { readonly kind: "CLAIMED" }
  /** A durable EXECUTED receipt already exists -- do not execute again. */
  | { readonly kind: "REPLAY"; readonly outcome: GovernedExecutionOutcome }
  /** Same idempotency key, different artifact -- refuse, mirrors the in-memory check above. */
  | { readonly kind: "ARTIFACT_MISMATCH" }
  /** A receipt is STARTED elsewhere (in flight or crashed) -- refuse rather than guess. */
  | { readonly kind: "IN_FLIGHT" }
  /** Postgres is down and this is not Vercel production -- degrade to the in-memory/file mechanism. */
  | { readonly kind: "DEGRADE_TO_MEMORY" }
  /** No live Supabase configured and this is not Vercel production -- unchanged existing behavior. */
  | { readonly kind: "NOT_CONFIGURED" };

/**
 * Reconstruct a GovernedExecutionOutcome from a durable receipt's stored
 * `outcome` jsonb. Deliberately conservative: any shape mismatch is treated
 * as undecodable rather than partially trusted, because the only two things
 * a caller can safely do with a REPLAY are "return this exact prior result"
 * or "refuse" -- never fabricate a result from a malformed record.
 */
function decodeGovernedExecutionOutcome(
  raw: Record<string, unknown> | null,
  artifactHash: string,
): GovernedExecutionOutcome | null {
  if (!raw || typeof raw !== "object") return null;
  if (raw.stage === "EXECUTION" && raw.status === "EXECUTED" && typeof raw.output === "string") {
    return { stage: "EXECUTION", status: "EXECUTED", artifactHash, output: raw.output };
  }
  return null;
}

/**
 * Attempt the durable claim. Throws (fail-closed, refusing to execute the
 * action at all) only on a Vercel production runtime with no live/working
 * Postgres claim store -- mirroring appendCanonicalAuditEntry's existing
 * fail-closed convention for the exact same platform constraint. Every
 * other environment either proceeds durably (CLAIMED/REPLAY/
 * ARTIFACT_MISMATCH/IN_FLIGHT) or degrades to the pre-existing in-memory
 * mechanism (DEGRADE_TO_MEMORY/NOT_CONFIGURED) -- full backward
 * compatibility with every existing test, which runs with no live
 * Supabase configured and NODE_ENV="test".
 */
async function claimDurableGovernedExecution(input: {
  readonly idempotencyKey: string;
  readonly artifactHash: string;
  readonly ownerId: string | null;
  readonly projectId: string | null;
  readonly entityType: string;
  readonly action: string;
}): Promise<DurableClaimOutcome> {
  const vercelProd = isVercelProductionRuntime();
  const env = getGovernedExecutionReceiptEnv();

  if (!env) {
    if (vercelProd) {
      throw new Error(
        "Durable governed-execution receipt persistence (Supabase) is not configured on a Vercel production runtime -- refusing to execute this no-approval governed action (fail closed).",
      );
    }
    return { kind: "NOT_CONFIGURED" };
  }

  const result = await claimGovernedExecutionReceipt(env, {
    id: randomUUID(),
    idempotencyKey: input.idempotencyKey,
    ownerId: input.ownerId,
    projectId: input.projectId,
    entityType: input.entityType,
    action: input.action,
    artifactHash: input.artifactHash,
  });

  if (!result.ok) {
    if (vercelProd) {
      throw new Error(
        `Durable governed-execution receipt claim (Supabase) failed on a Vercel production runtime -- refusing to execute this no-approval governed action (fail closed). Cause: ${result.error ?? result.reason}`,
      );
    }
    return { kind: "DEGRADE_TO_MEMORY" };
  }

  const claim = result.claim;
  if (claim.kind === "CLAIMED") return { kind: "CLAIMED" };
  if (claim.kind === "ARTIFACT_MISMATCH") return { kind: "ARTIFACT_MISMATCH" };
  if (claim.kind === "IN_FLIGHT_OUTCOME_UNKNOWN") return { kind: "IN_FLIGHT" };

  // REPLAY_EXECUTED
  const outcome = decodeGovernedExecutionOutcome(claim.row.outcome, claim.row.artifactHash);
  if (!outcome) {
    if (vercelProd) {
      throw new Error(
        "Durable governed-execution receipt is marked EXECUTED but its stored outcome could not be decoded -- refusing to execute again or fabricate a result (fail closed).",
      );
    }
    return { kind: "IN_FLIGHT" };
  }
  return { kind: "REPLAY", outcome };
}

/**
 * Best-effort finalize. Deliberately NEVER throws: by the time this is
 * called the real action has already run (or genuinely failed), and that
 * fact must reach the original caller regardless of whether this durable
 * bookkeeping step itself succeeds. A finalize failure leaves the receipt
 * stuck in STARTED, which is safe, not silent: any future retry of the
 * same idempotency key will see IN_FLIGHT and refuse to execute again
 * (see claimDurableGovernedExecution) rather than risk a double
 * execution. Reconciling a stuck STARTED row is intentionally out of scope
 * for this pass (reuses the existing OUTCOME_UNKNOWN vocabulary as a
 * description of that state, not a new mechanism -- see the P0.1
 * migration's header comment).
 */
async function finalizeDurableGovernedExecution(input: {
  readonly idempotencyKey: string;
  readonly status: "EXECUTED" | "FAILED";
  readonly outcome: GovernedExecutionOutcome;
}): Promise<void> {
  const env = getGovernedExecutionReceiptEnv();
  if (!env) return;
  await finalizeGovernedExecutionReceipt(env, {
    idempotencyKey: input.idempotencyKey,
    status: input.status,
    outcome: input.outcome as unknown as Record<string, unknown>,
  });
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

/**
 * Single audit helper so no refusal path can silently skip the trail.
 *
 * Async (P0 persistence fix): both the unified audit entry and the
 * governance decision now go through the canonical Postgres+NDJSON
 * dual-write path (see apps/api/src/services/audit-log.ts,
 * appendCanonicalAuditEntry / appendUnifiedCanonicalAuditEntry). This is
 * the single choke point every governed action passes through, so making
 * it async and awaited here is what makes the fail-closed/degrade policy
 * actually apply to every governed action rather than only some.
 */
async function auditOutcome(
  request: GovernedExecutionRequest,
  artifactHash: string,
  outcome: GovernedExecutionOutcome,
  context: GovernanceAuditContext = EMPTY_GOVERNANCE_AUDIT_CONTEXT,
  canonicalTarget?: CanonicalTarget,
): Promise<CanonicalAuditWriteResult> {
  const auditWrite = await appendUnifiedCanonicalAuditEntry({
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

  await persistGovernanceDecision(buildGovernanceDecision(request, artifactHash, outcome, context));
  return auditWrite;
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
    await auditOutcome(request, computeArtifactHash(request.artifact), outcome);
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
  if (delegationHopCount > MAX_DELEGATION_HOP_COUNT) {
    const outcome: GovernedExecutionOutcome = {
      stage: "AUTHORIZATION",
      status: "DENIED",
      reason: `Excessive delegation depth hops=${delegationHopCount} exceeds ${MAX_DELEGATION_HOP_COUNT}`,
    };
    await auditOutcome(request, computeArtifactHash(request.artifact), outcome);
    return outcome;
  }

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
    await auditOutcome(request, computeArtifactHash(request.artifact), outcome);
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
    await auditOutcome(request, computeArtifactHash(request.artifact), outcome);
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
    await auditOutcome(request, computeArtifactHash(request.artifact), outcome);
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
    await auditOutcome(governedRequest, computeArtifactHash(governedRequest.artifact), outcome);
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
    await auditOutcome(governedRequest, computeArtifactHash(governedRequest.artifact), outcome);
    return outcome;
  }

  // ── 6. Idempotency (binding hash) ───────────────────────────────────
  const finishGovernedExecution = async (): Promise<GovernedExecutionOutcome> => {
    if (governedRequest.idempotencyKey) {
      const prior = governedIdempotency.get(governedRequest.idempotencyKey);
      if (prior) {
        if (prior.artifactHash !== artifactHash) {
          const outcome: GovernedExecutionOutcome = {
            stage: "EXECUTION",
            status: "FAILED",
            reason: "idempotency key reused with a different artifact",
          };
          await auditOutcome(
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

    // P0.1: durable claim for the NO-APPROVAL execution path only --
    // approval-gated actions keep their existing, already-durable
    // approval_requests-based protection untouched (see the block comment
    // above claimDurableGovernedExecution).
    let durableClaim: DurableClaimOutcome | null = null;
    if (governedRequest.idempotencyKey && governedRequest.approvalRequestId === undefined) {
      durableClaim = await claimDurableGovernedExecution({
        idempotencyKey: governedRequest.idempotencyKey,
        artifactHash,
        // Always null, matching appendCanonicalAuditEntry's documented
        // owner_id decision in audit-log.ts: governedRequest.identity.
        // ownerId is not guaranteed to be a real auth.users row (system/
        // synthetic-tenant governed actions have no such user) --
        // reusing it here would risk the exact same
        // governed_execution_receipts.owner_id FK failure that fix
        // already avoided for audit_logs.
        ownerId: null,
        projectId: governedRequest.identity.projectId,
        entityType: canonical.entityType,
        action: canonical.action,
      });

      if (durableClaim.kind === "ARTIFACT_MISMATCH") {
        const outcome: GovernedExecutionOutcome = {
          stage: "EXECUTION",
          status: "FAILED",
          reason: "idempotency key reused with a different artifact",
        };
        await auditOutcome(
          governedRequest,
          artifactHash,
          outcome,
          EMPTY_GOVERNANCE_AUDIT_CONTEXT,
          extracted.target,
        );
        return outcome;
      }

      if (durableClaim.kind === "IN_FLIGHT") {
        const outcome: GovernedExecutionOutcome = {
          stage: "EXECUTION",
          status: "FAILED",
          reason:
            "a prior execution attempt for this idempotency key is still in flight or crashed before it could be finalized (OUTCOME_UNKNOWN) -- refusing to execute again until it is resolved",
        };
        await auditOutcome(
          governedRequest,
          artifactHash,
          outcome,
          EMPTY_GOVERNANCE_AUDIT_CONTEXT,
          extracted.target,
        );
        return outcome;
      }

      if (durableClaim.kind === "REPLAY") {
        // Durable EXECUTED receipt already exists: do not execute the real
        // action again. Still re-attempt the canonical audit write -- if
        // the original attempt's canonical audit write had failed or
        // degraded, this is a self-healing opportunity -- and always
        // report the current audit status honestly rather than assuming
        // the original attempt's audit succeeded.
        const replayOutcome = durableClaim.outcome;
        const auditWrite = await auditOutcome(
          governedRequest,
          artifactHash,
          replayOutcome,
          EMPTY_GOVERNANCE_AUDIT_CONTEXT,
          extracted.target,
        );
        const finalOutcome: GovernedExecutionOutcome =
          replayOutcome.status === "EXECUTED"
            ? { ...replayOutcome, auditStatus: canonicalAuditStatus(auditWrite) }
            : replayOutcome;
        governedIdempotency.set(governedRequest.idempotencyKey, {
          artifactHash,
          outcome: finalOutcome,
        });
        persistGovernedIdempotency();
        return finalOutcome;
      }
      // CLAIMED, DEGRADE_TO_MEMORY, or NOT_CONFIGURED: fall through and execute below.
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

  if (durableClaim?.kind === "CLAIMED" && governedRequest.idempotencyKey) {
    await finalizeDurableGovernedExecution({
      idempotencyKey: governedRequest.idempotencyKey,
      status: outcome.status === "EXECUTED" ? "EXECUTED" : "FAILED",
      outcome,
    });
  }

  const auditWrite = await auditOutcome(governedRequest, artifactHash, outcome, { gate, approval }, extracted.target);
  if (outcome.status === "EXECUTED") {
    outcome = { ...outcome, auditStatus: canonicalAuditStatus(auditWrite) };
  }
  if (governedRequest.idempotencyKey && outcome.status === "EXECUTED") {
    governedIdempotency.set(governedRequest.idempotencyKey, { artifactHash, outcome });
    persistGovernedIdempotency();
  }
  return outcome;
  };

  return governedRequest.idempotencyKey
    ? withGovernedIdempotencyLock(governedRequest.idempotencyKey, finishGovernedExecution)
    : finishGovernedExecution();
}

import {
  canonicalizeJson,
  computeEnvelopeHash,
  hashCanonicalJson,
  validateExecutionApprovalEnvelope,
  type ExecutionApprovalEnvelopeV1,
} from "@atlas/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

export type GovernanceAuthorizationContext = Readonly<{
  /** Trusted server-resolved scope; never construct from HTTP request fields. */
  authenticatedPrincipalId: string;
  ownerId: string;
  projectId: string;
  tenantId: string;
}>;

export type SafeAuditPayload = Readonly<Partial<Record<
  "approvalId" | "executionId" | "redemptionId" | "correlationId" | "causationId" | "envelopeHash" | "schemaVersion" | "tenantId" | "ownerId" | "projectId" | "requesterId" | "proposedAgentId" | "operatorId" | "approverId" | "entityType" | "entityId" | "operation" | "action" | "toolName" | "toolCatalogVersion" | "policyVersion" | "policyDecisionHash" | "riskLevel" | "state" | "decision" | "reason" | "errorCategory" | "errorReference" | "resultDigest" | "runtimeExecutionRef" | "runtimeReceiptHash" | "idempotencyKeyHash" | "receiptKind" | "verificationVerdict" | "regressionVerdict",
  string | boolean | null
>>>;

export type CreateDurableApprovalInput = Readonly<{
  ownerId: string;
  projectId: string;
  tenantId: string;
  envelope: ExecutionApprovalEnvelopeV1;
  authorizationContext: GovernanceAuthorizationContext;
  correlationId: string;
  auditPayload: SafeAuditPayload;
}>;

export type ClaimApprovalRedemptionInput = Readonly<{
  approvalId: string;
  ownerId: string;
  projectId: string;
  tenantId: string;
  envelopeHash: string;
  operatorPrincipalId: string;
  idempotencyKey: string;
  authorizationContext: GovernanceAuthorizationContext;
  correlationId: string;
  auditPayload: SafeAuditPayload;
}>;

export type RecordApprovalDecisionInput = Readonly<{
  approvalId: string;
  ownerId: string;
  projectId: string;
  envelopeHash: string;
  decision: "APPROVE" | "REJECT";
  approverPrincipalId: string;
  approverIdentityVersion: string;
  authoritySnapshot: Record<string, unknown>;
  policyVersion: string;
  policyDecisionHash: string;
  reason?: string;
  authorizationContext: GovernanceAuthorizationContext;
  correlationId: string;
  auditPayload: SafeAuditPayload;
}>;

export type DurableApprovalCreated = Readonly<{
  approvalId: string;
  state: "REQUESTED";
  envelopeHash: string;
}>;

export type DurableRedemptionClaim = Readonly<{
  redemptionId: string;
  executionId: string;
  claimState: "CLAIMED" | "DISPATCH_NOT_STARTED" | "DISPATCHED" | "FINALIZED";
  responseStatus: string | null;
  responsePayloadDigest: string | null;
  responseReference: string | null;
  finalState: "FULFILLED" | "CONSUMED_FAILED" | "OUTCOME_UNKNOWN" | null;
  replayed: boolean;
}>;

export type DurableApprovalExpired = Readonly<{
  approvalId: string;
  state: "EXPIRED";
  replayed: false;
}>;

export type DurableApprovalDecision = Readonly<{
  decisionId: string;
  approvalId: string;
  state: "REQUESTED";
}>;

export type FinalizeApprovalRedemptionInput = Readonly<{
  executionId: string;
  ownerId: string;
  projectId: string;
  finalState: "FULFILLED" | "CONSUMED_FAILED" | "OUTCOME_UNKNOWN";
  runtimeExecutionRef?: string;
  runtimeReceiptHash?: string;
  resultDigest?: string;
  errorCategory?: string;
  errorReference?: string;
  verificationVerdict?: string;
  regressionVerdict?: string;
  authorizationContext: GovernanceAuthorizationContext;
  correlationId: string;
  auditPayload: SafeAuditPayload;
}>;

export type DurableRedemptionFinalization = Readonly<{
  executionId: string;
  approvalId: string;
  state: FinalizeApprovalRedemptionInput["finalState"];
  replayed: boolean;
}>;

const SAFE_AUDIT_KEYS = new Set<string>([
  "approvalId", "executionId", "redemptionId", "correlationId", "causationId", "envelopeHash", "schemaVersion", "tenantId", "ownerId", "projectId", "requesterId", "proposedAgentId", "operatorId", "approverId", "entityType", "entityId", "operation", "action", "toolName", "toolCatalogVersion", "policyVersion", "policyDecisionHash", "riskLevel", "state", "decision", "reason", "errorCategory", "errorReference", "resultDigest", "runtimeExecutionRef", "runtimeReceiptHash", "idempotencyKeyHash", "receiptKind", "verificationVerdict", "regressionVerdict",
]);

function assertSafeAuditPayload(value: unknown): asserts value is SafeAuditPayload {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Audit payload must be an object");
  for (const [key, entry] of Object.entries(value)) {
    if (!SAFE_AUDIT_KEYS.has(key) || (entry !== null && typeof entry !== "string" && typeof entry !== "boolean")) {
      throw new TypeError(`Audit payload field is not allowlisted: ${key}`);
    }
  }
}

function assertScope(context: GovernanceAuthorizationContext, ownerId: string, projectId: string): void {
  if (!context.authenticatedPrincipalId || !context.tenantId || context.ownerId !== ownerId || context.projectId !== projectId) {
    throw new TypeError("Authorization context does not match governance scope");
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Invalid RPC response");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const result = value[key];
  if (typeof result !== "string" || result.length === 0) throw new TypeError(`Invalid RPC response field ${key}`);
  return result;
}

function nullableString(value: Record<string, unknown>, key: string): string | null {
  const result = value[key];
  if (result !== null && typeof result !== "string") throw new TypeError(`Invalid RPC response field ${key}`);
  return result;
}

export class ApprovalExecutionRepository {
  constructor(private readonly client: SupabaseClient) {}

  async createRequestedApproval(input: CreateDurableApprovalInput): Promise<DurableApprovalCreated> {
    assertScope(input.authorizationContext, input.ownerId, input.projectId);
    assertSafeAuditPayload(input.auditPayload);
    const envelope = validateExecutionApprovalEnvelope(input.envelope);
    if (envelope.tenant.tenantId !== input.tenantId || envelope.project.projectId !== input.projectId) {
      throw new TypeError("Envelope scope does not match durable approval scope");
    }
    const { envelopeHash: ignoredHash, ...hashInput } = envelope;
    void ignoredHash;
    const canonicalEnvelope = canonicalizeJson(hashInput);
    if (computeEnvelopeHash(hashInput) !== envelope.envelopeHash) throw new TypeError("Envelope hash does not match Unit 1 canonical envelope");
    const { data, error } = await this.client.rpc("create_requested_approval", {
      p_owner_id: input.ownerId,
      p_project_id: input.projectId,
      p_tenant_id: input.tenantId,
      p_envelope: envelope,
      p_canonical_envelope_json: canonicalEnvelope,
      p_authorization_context: input.authorizationContext,
      p_correlation_id: input.correlationId,
      p_event_payload: input.auditPayload,
    });
    if (error) throw error;
    const result = asRecord(data);
    const approvalId = requiredString(result, "approvalId");
    const state = requiredString(result, "state");
    const envelopeHash = requiredString(result, "envelopeHash");
    if (approvalId !== envelope.approvalId || state !== "REQUESTED" || envelopeHash !== envelope.envelopeHash) {
      throw new TypeError("Unexpected durable approval response");
    }
    return { approvalId, state: "REQUESTED", envelopeHash };
  }

  async claimApprovalRedemption(input: ClaimApprovalRedemptionInput): Promise<DurableRedemptionClaim | DurableApprovalExpired> {
    assertScope(input.authorizationContext, input.ownerId, input.projectId);
    assertSafeAuditPayload(input.auditPayload);
    const { data, error } = await this.client.rpc("claim_approval_redemption", {
      p_approval_id: input.approvalId,
      p_owner_id: input.ownerId,
      p_project_id: input.projectId,
      p_tenant_id: input.tenantId,
      p_envelope_hash: input.envelopeHash,
      p_operator_principal_id: input.operatorPrincipalId,
      p_idempotency_key_hash: hashCanonicalJson(input.idempotencyKey),
      p_authorization_context: input.authorizationContext,
      p_correlation_id: input.correlationId,
      p_event_payload: input.auditPayload,
    });
    if (error) throw error;
    const result = asRecord(data);
    if (result.state === "EXPIRED" && result.replayed === false && requiredString(result, "approvalId") === input.approvalId) {
      return { approvalId: input.approvalId, state: "EXPIRED", replayed: false };
    }
    const claimState = requiredString(result, "claimState");
    if (!["CLAIMED", "DISPATCH_NOT_STARTED", "DISPATCHED", "FINALIZED"].includes(claimState) || typeof result.replayed !== "boolean") {
      throw new TypeError("Unexpected durable redemption response");
    }
    return {
      redemptionId: requiredString(result, "redemptionId"),
      executionId: requiredString(result, "executionId"),
      claimState: claimState as DurableRedemptionClaim["claimState"],
      responseStatus: nullableString(result, "responseStatus"),
      responsePayloadDigest: nullableString(result, "responsePayloadDigest"),
      responseReference: nullableString(result, "responseReference"),
      finalState: nullableString(result, "finalState") as DurableRedemptionClaim["finalState"],
      replayed: result.replayed,
    };
  }

  async recordApprovalDecision(input: RecordApprovalDecisionInput): Promise<DurableApprovalDecision | DurableApprovalExpired> {
    assertScope(input.authorizationContext, input.ownerId, input.projectId);
    assertSafeAuditPayload(input.auditPayload);
    const { data, error } = await this.client.rpc("record_approval_decision", {
      p_approval_id: input.approvalId,
      p_owner_id: input.ownerId,
      p_project_id: input.projectId,
      p_envelope_hash: input.envelopeHash,
      p_decision: input.decision,
      p_approver_principal_id: input.approverPrincipalId,
      p_approver_identity_version: input.approverIdentityVersion,
      p_authority_snapshot: input.authoritySnapshot,
      p_policy_version: input.policyVersion,
      p_policy_decision_hash: input.policyDecisionHash,
      p_reason: input.reason ?? null,
      p_authorization_context: input.authorizationContext,
      p_correlation_id: input.correlationId,
      p_event_payload: input.auditPayload,
    });
    if (error) throw error;
    const result = asRecord(data);
    const state = requiredString(result, "state");
    if (result.state === "EXPIRED" && result.replayed === false && requiredString(result, "approvalId") === input.approvalId) {
      return { approvalId: input.approvalId, state: "EXPIRED", replayed: false };
    }
    if (state !== "REQUESTED" || requiredString(result, "approvalId") !== input.approvalId) {
      throw new TypeError("Unexpected durable approval decision response");
    }
    return { decisionId: requiredString(result, "decisionId"), approvalId: input.approvalId, state };
  }

  async finalizeApprovalRedemption(input: FinalizeApprovalRedemptionInput): Promise<DurableRedemptionFinalization> {
    assertScope(input.authorizationContext, input.ownerId, input.projectId);
    assertSafeAuditPayload(input.auditPayload);
    const { data, error } = await this.client.rpc("finalize_approval_redemption", {
      p_execution_id: input.executionId,
      p_owner_id: input.ownerId,
      p_project_id: input.projectId,
      p_final_state: input.finalState,
      p_runtime_execution_ref: input.runtimeExecutionRef ?? null,
      p_runtime_receipt_hash: input.runtimeReceiptHash ?? null,
      p_result_digest: input.resultDigest ?? null,
      p_error_category: input.errorCategory ?? null,
      p_error_reference: input.errorReference ?? null,
      p_verification_verdict: input.verificationVerdict ?? null,
      p_regression_verdict: input.regressionVerdict ?? null,
      p_authorization_context: input.authorizationContext,
      p_correlation_id: input.correlationId,
      p_event_payload: input.auditPayload,
    });
    if (error) throw error;
    const result = asRecord(data);
    const state = requiredString(result, "state");
    if (!(["FULFILLED", "CONSUMED_FAILED", "OUTCOME_UNKNOWN"] as const).includes(state as FinalizeApprovalRedemptionInput["finalState"]) || requiredString(result, "executionId") !== input.executionId || typeof result.replayed !== "boolean") {
      throw new TypeError("Unexpected durable redemption finalization response");
    }
    return { executionId: input.executionId, approvalId: requiredString(result, "approvalId"), state: state as FinalizeApprovalRedemptionInput["finalState"], replayed: result.replayed };
  }
}
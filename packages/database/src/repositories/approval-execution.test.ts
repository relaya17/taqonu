import { describe, expect, it, vi } from "vitest";
import { createExecutionApprovalEnvelope, type ExecutionCandidate } from "@atlas/shared";
import { ApprovalExecutionRepository } from "./approval-execution.js";

const HASH = "a".repeat(64);
const OWNER = "00000000-0000-4000-8000-000000000001";
const PROJECT = "00000000-0000-4000-8000-000000000002";
const APPROVAL = "00000000-0000-4000-8000-000000000003";
const CORRELATION = "00000000-0000-4000-8000-000000000004";

function envelope() {
  const candidate: ExecutionCandidate = {
    schemaVersion: "atlas.execution-approval-envelope/v1", approvalId: APPROVAL, canonicalizationVersion: "atlas-c14n-json/v1",
    requester: { principalId: OWNER, principalType: "USER", tenantId: OWNER },
    proposedExecutingAgent: { agentId: "agent", identityVersion: "v1" }, operation: "operation", action: "UPDATE",
    tool: { name: "tool", catalogVersion: "v1", argumentSchemaVersion: "v1" }, toolArgs: { input: "ok" }, toolArgsHash: HASH,
    entity: { type: "RECORD", id: null }, project: { projectId: PROJECT }, tenant: { tenantId: OWNER },
    artifact: { artifactId: null, artifactHash: null, hashAlgorithm: null, canonicalizationVersion: null },
    verificationPlan: { version: "v1", expectedObservations: [], baselineObservations: [], verificationPlanHash: HASH },
    policyDecision: { policyVersion: "v1", riskLevel: "MEDIUM", disposition: "REQUIRES_APPROVAL", decisionHash: HASH },
    requestedAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-09-02T00:00:00.000Z",
  };
  return createExecutionApprovalEnvelope(candidate);
}

function repository(response: unknown) {
  const rpc = vi.fn().mockResolvedValue({ data: response, error: null });
  return { repository: new ApprovalExecutionRepository({ rpc } as never), rpc };
}

describe("ApprovalExecutionRepository", () => {
  it("fails closed before an RPC when scope or audit payload is invalid", async () => {
    const { repository, rpc } = repository({});
    await expect(repository.createRequestedApproval({ ownerId: OWNER, projectId: PROJECT, tenantId: OWNER, envelope: envelope(), authorizationContext: { authenticatedPrincipalId: "actor", ownerId: "other", projectId: PROJECT, tenantId: OWNER }, correlationId: CORRELATION, auditPayload: {} })).rejects.toThrow(/scope/);
    await expect(repository.claimApprovalRedemption({ approvalId: APPROVAL, ownerId: OWNER, projectId: PROJECT, tenantId: OWNER, envelopeHash: HASH, operatorPrincipalId: "operator", idempotencyKey: "key", authorizationContext: { authenticatedPrincipalId: "operator", ownerId: OWNER, projectId: PROJECT, tenantId: OWNER }, correlationId: CORRELATION, auditPayload: { tool_args: "x" } as never })).rejects.toThrow(/allowlisted/);
    await expect(repository.claimApprovalRedemption({ approvalId: APPROVAL, ownerId: OWNER, projectId: PROJECT, tenantId: OWNER, envelopeHash: HASH, operatorPrincipalId: "operator", idempotencyKey: "key", authorizationContext: { authenticatedPrincipalId: "operator", ownerId: OWNER, projectId: PROJECT, tenantId: OWNER }, correlationId: CORRELATION, auditPayload: { secret: "x", password: "x", artifact: "x", raw_result: "x" } as never })).rejects.toThrow(/allowlisted/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("creates only through the domain-specific request RPC", async () => {
    const value = envelope();
    const { repository, rpc } = repository({ approvalId: APPROVAL, state: "REQUESTED", envelopeHash: value.envelopeHash });
    await expect(repository.createRequestedApproval({ ownerId: OWNER, projectId: PROJECT, tenantId: OWNER, envelope: value, authorizationContext: { authenticatedPrincipalId: OWNER, ownerId: OWNER, projectId: PROJECT, tenantId: OWNER }, correlationId: CORRELATION, auditPayload: { approvalId: APPROVAL } })).resolves.toEqual({ approvalId: APPROVAL, state: "REQUESTED", envelopeHash: value.envelopeHash });
    expect(rpc).toHaveBeenCalledWith("create_requested_approval", expect.objectContaining({ p_owner_id: OWNER, p_project_id: PROJECT, p_envelope: value }));
  });

  it("sends Unit 1 canonical hash input and rejects a tampered envelope before the RPC", async () => {
    const value = envelope();
    const { repository, rpc } = repository({ approvalId: APPROVAL, state: "REQUESTED", envelopeHash: value.envelopeHash });
    await repository.createRequestedApproval({ ownerId: OWNER, projectId: PROJECT, tenantId: OWNER, envelope: value, authorizationContext: { authenticatedPrincipalId: OWNER, ownerId: OWNER, projectId: PROJECT, tenantId: OWNER }, correlationId: CORRELATION, auditPayload: { approvalId: APPROVAL } });
    expect(rpc).toHaveBeenCalledWith("create_requested_approval", expect.objectContaining({ p_canonical_envelope_json: expect.not.stringContaining("\"envelopeHash\"") }));
    await expect(repository.createRequestedApproval({ ownerId: OWNER, projectId: PROJECT, tenantId: OWNER, envelope: { ...value, action: "TAMPERED" }, authorizationContext: { authenticatedPrincipalId: OWNER, ownerId: OWNER, projectId: PROJECT, tenantId: OWNER }, correlationId: CORRELATION, auditPayload: { approvalId: APPROVAL } })).rejects.toThrow(/envelopeHash/);
  });

  it("returns a durable replay result without exposing a generic mutation API", async () => {
    const { repository } = repository({ redemptionId: "00000000-0000-4000-8000-000000000005", executionId: "00000000-0000-4000-8000-000000000006", claimState: "CLAIMED", responseStatus: null, responsePayloadDigest: null, responseReference: null, finalState: null, replayed: true });
    await expect(repository.claimApprovalRedemption({ approvalId: APPROVAL, ownerId: OWNER, projectId: PROJECT, tenantId: OWNER, envelopeHash: HASH, operatorPrincipalId: "operator", idempotencyKey: "key", authorizationContext: { authenticatedPrincipalId: "operator", ownerId: OWNER, projectId: PROJECT, tenantId: OWNER }, correlationId: CORRELATION, auditPayload: { approvalId: APPROVAL } })).resolves.toMatchObject({ claimState: "CLAIMED", replayed: true });
  });

  it("records a decision through its constrained RPC", async () => {
    const { repository, rpc } = repository({ decisionId: "00000000-0000-4000-8000-000000000005", approvalId: APPROVAL, state: "REQUESTED" });
    await expect(repository.recordApprovalDecision({ approvalId: APPROVAL, ownerId: OWNER, projectId: PROJECT, envelopeHash: HASH, decision: "APPROVE", approverPrincipalId: "approver", approverIdentityVersion: "v1", authoritySnapshot: { role: "ADMIN" }, policyVersion: "v1", policyDecisionHash: HASH, authorizationContext: { authenticatedPrincipalId: "approver", ownerId: OWNER, projectId: PROJECT, tenantId: OWNER }, correlationId: CORRELATION, auditPayload: { approvalId: APPROVAL } })).resolves.toMatchObject({ approvalId: APPROVAL, state: "REQUESTED" });
    expect(rpc).toHaveBeenCalledWith("record_approval_decision", expect.objectContaining({ p_decision: "APPROVE" }));
  });

  it("returns a durable expired result for claim and decision paths", async () => {
    const context = { authenticatedPrincipalId: "operator", ownerId: OWNER, projectId: PROJECT, tenantId: OWNER };
    const claim = repository({ approvalId: APPROVAL, state: "EXPIRED", replayed: false }).repository;
    await expect(claim.claimApprovalRedemption({ approvalId: APPROVAL, ownerId: OWNER, projectId: PROJECT, tenantId: OWNER, envelopeHash: HASH, operatorPrincipalId: "operator", idempotencyKey: "key", authorizationContext: context, correlationId: CORRELATION, auditPayload: { approvalId: APPROVAL } })).resolves.toEqual({ approvalId: APPROVAL, state: "EXPIRED", replayed: false });
    const decision = repository({ approvalId: APPROVAL, state: "EXPIRED", replayed: false }).repository;
    await expect(decision.recordApprovalDecision({ approvalId: APPROVAL, ownerId: OWNER, projectId: PROJECT, envelopeHash: HASH, decision: "APPROVE", approverPrincipalId: "operator", approverIdentityVersion: "v1", authoritySnapshot: {}, policyVersion: "v1", policyDecisionHash: HASH, authorizationContext: context, correlationId: CORRELATION, auditPayload: { approvalId: APPROVAL } })).resolves.toEqual({ approvalId: APPROVAL, state: "EXPIRED", replayed: false });
  });

  it("finalizes an execution only through its terminal-state RPC", async () => {
    const executionId = "00000000-0000-4000-8000-000000000006";
    const { repository, rpc } = repository({ executionId, approvalId: APPROVAL, state: "OUTCOME_UNKNOWN", replayed: false });
    await expect(repository.finalizeApprovalRedemption({ executionId, ownerId: OWNER, projectId: PROJECT, finalState: "OUTCOME_UNKNOWN", authorizationContext: { authenticatedPrincipalId: "operator", ownerId: OWNER, projectId: PROJECT, tenantId: OWNER }, correlationId: CORRELATION, auditPayload: { approvalId: APPROVAL } })).resolves.toMatchObject({ state: "OUTCOME_UNKNOWN", replayed: false });
    expect(rpc).toHaveBeenCalledWith("finalize_approval_redemption", expect.objectContaining({ p_final_state: "OUTCOME_UNKNOWN" }));
  });
});
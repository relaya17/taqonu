import { describe, expect, it, vi } from "vitest";
import { createExecutionApprovalEnvelope, type ExecutionCandidate } from "@atlas/shared/node";
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

// Renamed from `repository` (pre-existing name) to `makeRepository`: a
// factory function and the destructured instance it returns cannot share a
// name — `const { repository, rpc } = makeRepository(...)` is not a shadowing
// style choice, it is a genuine TDZ ReferenceError ("Cannot access
// 'repository' before initialization") in real JavaScript, confirmed by
// actually running this file for the first time this session (every prior
// pass through this test file was source-read or executed against a broken
// vitest install, never a real run). This rename is purely mechanical — it
// changes no assertion, no mock, no test semantics — and was needed to make
// every test in this file (not just the ones this phase touches) actually
// executable at all, which Phase 3C's "run the tests" requirement depends on.
function makeRepository(response: unknown) {
  const rpc = vi.fn().mockResolvedValue({ data: response, error: null });
  return { repository: new ApprovalExecutionRepository({ rpc } as never), rpc };
}

describe("ApprovalExecutionRepository", () => {
  it("fails closed before an RPC when scope or audit payload is invalid", async () => {
    const { repository, rpc } = makeRepository({});
    await expect(repository.createRequestedApproval({ ownerId: OWNER, projectId: PROJECT, tenantId: OWNER, envelope: envelope(), authorizationContext: { authenticatedPrincipalId: "actor", ownerId: "other", projectId: PROJECT, tenantId: OWNER }, correlationId: CORRELATION, auditPayload: {} })).rejects.toThrow(/scope/);
    await expect(repository.claimApprovalRedemption({ approvalId: APPROVAL, ownerId: OWNER, projectId: PROJECT, tenantId: OWNER, envelopeHash: HASH, operatorPrincipalId: "operator", idempotencyKey: "key", authorizationContext: { authenticatedPrincipalId: "operator", ownerId: OWNER, projectId: PROJECT, tenantId: OWNER }, correlationId: CORRELATION, auditPayload: { tool_args: "x" } as never })).rejects.toThrow(/allowlisted/);
    await expect(repository.claimApprovalRedemption({ approvalId: APPROVAL, ownerId: OWNER, projectId: PROJECT, tenantId: OWNER, envelopeHash: HASH, operatorPrincipalId: "operator", idempotencyKey: "key", authorizationContext: { authenticatedPrincipalId: "operator", ownerId: OWNER, projectId: PROJECT, tenantId: OWNER }, correlationId: CORRELATION, auditPayload: { secret: "x", password: "x", artifact: "x", raw_result: "x" } as never })).rejects.toThrow(/allowlisted/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("creates only through the domain-specific request RPC", async () => {
    const value = envelope();
    const { repository, rpc } = makeRepository({ approvalId: APPROVAL, state: "REQUESTED", envelopeHash: value.envelopeHash });
    await expect(repository.createRequestedApproval({ ownerId: OWNER, projectId: PROJECT, tenantId: OWNER, envelope: value, authorizationContext: { authenticatedPrincipalId: OWNER, ownerId: OWNER, projectId: PROJECT, tenantId: OWNER }, correlationId: CORRELATION, auditPayload: { approvalId: APPROVAL } })).resolves.toEqual({ approvalId: APPROVAL, state: "REQUESTED", envelopeHash: value.envelopeHash });
    expect(rpc).toHaveBeenCalledWith("create_requested_approval", expect.objectContaining({ p_owner_id: OWNER, p_project_id: PROJECT, p_envelope: value }));
  });

  it("sends Unit 1 canonical hash input and rejects a tampered envelope before the RPC", async () => {
    const value = envelope();
    const { repository, rpc } = makeRepository({ approvalId: APPROVAL, state: "REQUESTED", envelopeHash: value.envelopeHash });
    await repository.createRequestedApproval({ ownerId: OWNER, projectId: PROJECT, tenantId: OWNER, envelope: value, authorizationContext: { authenticatedPrincipalId: OWNER, ownerId: OWNER, projectId: PROJECT, tenantId: OWNER }, correlationId: CORRELATION, auditPayload: { approvalId: APPROVAL } });
    expect(rpc).toHaveBeenCalledWith("create_requested_approval", expect.objectContaining({ p_canonical_envelope_json: expect.not.stringContaining("\"envelopeHash\"") }));
    await expect(repository.createRequestedApproval({ ownerId: OWNER, projectId: PROJECT, tenantId: OWNER, envelope: { ...value, action: "TAMPERED" }, authorizationContext: { authenticatedPrincipalId: OWNER, ownerId: OWNER, projectId: PROJECT, tenantId: OWNER }, correlationId: CORRELATION, auditPayload: { approvalId: APPROVAL } })).rejects.toThrow(/envelopeHash/);
  });

  it("returns a durable replay result without exposing a generic mutation API", async () => {
    const { repository } = makeRepository({ redemptionId: "00000000-0000-4000-8000-000000000005", executionId: "00000000-0000-4000-8000-000000000006", claimState: "CLAIMED", responseStatus: null, responsePayloadDigest: null, responseReference: null, finalState: null, replayed: true });
    await expect(repository.claimApprovalRedemption({ approvalId: APPROVAL, ownerId: OWNER, projectId: PROJECT, tenantId: OWNER, envelopeHash: HASH, operatorPrincipalId: "operator", idempotencyKey: "key", authorizationContext: { authenticatedPrincipalId: "operator", ownerId: OWNER, projectId: PROJECT, tenantId: OWNER }, correlationId: CORRELATION, auditPayload: { approvalId: APPROVAL } })).resolves.toMatchObject({ claimState: "CLAIMED", replayed: true });
  });

  it("records an APPROVE decision through its constrained RPC and reflects the parent approval's real state", async () => {
    // As of the Phase 3B migration (`20260902010000_approval_lifecycle_state_
    // transitions.sql`), `record_approval_decision` actually writes the
    // decision onto `approval_requests.state` and returns it truthfully —
    // it no longer always reports "REQUESTED".
    const { repository, rpc } = makeRepository({ decisionId: "00000000-0000-4000-8000-000000000005", approvalId: APPROVAL, state: "APPROVED" });
    await expect(repository.recordApprovalDecision({ approvalId: APPROVAL, ownerId: OWNER, projectId: PROJECT, envelopeHash: HASH, decision: "APPROVE", approverPrincipalId: "approver", approverIdentityVersion: "v1", authoritySnapshot: { role: "ADMIN" }, policyVersion: "v1", policyDecisionHash: HASH, authorizationContext: { authenticatedPrincipalId: "approver", ownerId: OWNER, projectId: PROJECT, tenantId: OWNER }, correlationId: CORRELATION, auditPayload: { approvalId: APPROVAL } })).resolves.toMatchObject({ approvalId: APPROVAL, state: "APPROVED" });
    expect(rpc).toHaveBeenCalledWith("record_approval_decision", expect.objectContaining({ p_decision: "APPROVE" }));
  });

  it("records a REJECT decision through its constrained RPC and reflects the parent approval's real state", async () => {
    const { repository, rpc } = makeRepository({ decisionId: "00000000-0000-4000-8000-000000000007", approvalId: APPROVAL, state: "REJECTED" });
    await expect(repository.recordApprovalDecision({ approvalId: APPROVAL, ownerId: OWNER, projectId: PROJECT, envelopeHash: HASH, decision: "REJECT", approverPrincipalId: "approver", approverIdentityVersion: "v1", authoritySnapshot: { role: "ADMIN" }, policyVersion: "v1", policyDecisionHash: HASH, authorizationContext: { authenticatedPrincipalId: "approver", ownerId: OWNER, projectId: PROJECT, tenantId: OWNER }, correlationId: CORRELATION, auditPayload: { approvalId: APPROVAL } })).resolves.toMatchObject({ approvalId: APPROVAL, state: "REJECTED" });
    expect(rpc).toHaveBeenCalledWith("record_approval_decision", expect.objectContaining({ p_decision: "REJECT" }));
  });

  it("rejects an unexpected decision response that is neither APPROVED, REJECTED, nor EXPIRED", async () => {
    const { repository } = makeRepository({ decisionId: "00000000-0000-4000-8000-000000000005", approvalId: APPROVAL, state: "REQUESTED" });
    await expect(repository.recordApprovalDecision({ approvalId: APPROVAL, ownerId: OWNER, projectId: PROJECT, envelopeHash: HASH, decision: "APPROVE", approverPrincipalId: "approver", approverIdentityVersion: "v1", authoritySnapshot: { role: "ADMIN" }, policyVersion: "v1", policyDecisionHash: HASH, authorizationContext: { authenticatedPrincipalId: "approver", ownerId: OWNER, projectId: PROJECT, tenantId: OWNER }, correlationId: CORRELATION, auditPayload: { approvalId: APPROVAL } })).rejects.toThrow(/Unexpected durable approval decision response/);
  });

  it("revokes a REQUESTED or APPROVED approval through its own RPC", async () => {
    const { repository, rpc } = makeRepository({ approvalId: APPROVAL, state: "REVOKED" });
    await expect(repository.revokeApproval({ approvalId: APPROVAL, ownerId: OWNER, projectId: PROJECT, envelopeHash: HASH, revokerPrincipalId: "requester", reason: "superseded", authorizationContext: { authenticatedPrincipalId: "requester", ownerId: OWNER, projectId: PROJECT, tenantId: OWNER }, correlationId: CORRELATION, auditPayload: { approvalId: APPROVAL, reason: "superseded" } })).resolves.toEqual({ approvalId: APPROVAL, state: "REVOKED" });
    expect(rpc).toHaveBeenCalledWith("revoke_approval", expect.objectContaining({ p_approval_id: APPROVAL, p_revoker_principal_id: "requester", p_reason: "superseded" }));
  });

  it("fails closed before the revoke RPC when scope is invalid", async () => {
    const { repository, rpc } = makeRepository({});
    await expect(repository.revokeApproval({ approvalId: APPROVAL, ownerId: OWNER, projectId: PROJECT, envelopeHash: HASH, revokerPrincipalId: "requester", reason: "superseded", authorizationContext: { authenticatedPrincipalId: "requester", ownerId: "other", projectId: PROJECT, tenantId: OWNER }, correlationId: CORRELATION, auditPayload: {} })).rejects.toThrow(/scope/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns a durable expired result for claim and decision paths", async () => {
    const context = { authenticatedPrincipalId: "operator", ownerId: OWNER, projectId: PROJECT, tenantId: OWNER };
    const claim = makeRepository({ approvalId: APPROVAL, state: "EXPIRED", replayed: false }).repository;
    await expect(claim.claimApprovalRedemption({ approvalId: APPROVAL, ownerId: OWNER, projectId: PROJECT, tenantId: OWNER, envelopeHash: HASH, operatorPrincipalId: "operator", idempotencyKey: "key", authorizationContext: context, correlationId: CORRELATION, auditPayload: { approvalId: APPROVAL } })).resolves.toEqual({ approvalId: APPROVAL, state: "EXPIRED", replayed: false });
    const decision = makeRepository({ approvalId: APPROVAL, state: "EXPIRED", replayed: false }).repository;
    await expect(decision.recordApprovalDecision({ approvalId: APPROVAL, ownerId: OWNER, projectId: PROJECT, envelopeHash: HASH, decision: "APPROVE", approverPrincipalId: "operator", approverIdentityVersion: "v1", authoritySnapshot: {}, policyVersion: "v1", policyDecisionHash: HASH, authorizationContext: context, correlationId: CORRELATION, auditPayload: { approvalId: APPROVAL } })).resolves.toEqual({ approvalId: APPROVAL, state: "EXPIRED", replayed: false });
  });

  it("finalizes an execution only through its terminal-state RPC", async () => {
    const executionId = "00000000-0000-4000-8000-000000000006";
    const { repository, rpc } = makeRepository({ executionId, approvalId: APPROVAL, state: "OUTCOME_UNKNOWN", replayed: false });
    await expect(repository.finalizeApprovalRedemption({ executionId, ownerId: OWNER, projectId: PROJECT, finalState: "OUTCOME_UNKNOWN", authorizationContext: { authenticatedPrincipalId: "operator", ownerId: OWNER, projectId: PROJECT, tenantId: OWNER }, correlationId: CORRELATION, auditPayload: { approvalId: APPROVAL } })).resolves.toMatchObject({ state: "OUTCOME_UNKNOWN", replayed: false });
    expect(rpc).toHaveBeenCalledWith("finalize_approval_redemption", expect.objectContaining({ p_final_state: "OUTCOME_UNKNOWN" }));
  });
});
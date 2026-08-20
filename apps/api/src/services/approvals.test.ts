import { afterEach, beforeEach, describe, expect, it } from "vitest";

process.env.ATLAS_SKIP_AUDIT_LOG = "1";

const {
  consumeApprovalRequest,
  createApprovalRequest,
  decideApprovalRequest,
  getApprovalRequest,
  listApprovalRequests,
  resetApprovalsForTests,
  revokeApprovalRequest,
} = await import("./approvals.js");

describe("approvals service", () => {
  beforeEach(() => {
    resetApprovalsForTests();
  });

  afterEach(() => {
    resetApprovalsForTests();
  });

  it("createApprovalRequest creates a PENDING request", () => {
    const request = createApprovalRequest({
      entityType: "CONFIGURATION",
      action: "EXECUTE",
      requestedBy: "user-1",
      reason: "run platform automation checks",
    });

    expect(request.status).toBe("PENDING");
    expect(request.entityType).toBe("CONFIGURATION");
    expect(request.action).toBe("EXECUTE");
    expect(request.requestedBy).toBe("user-1");
    expect(request.decidedBy).toBeNull();
    expect(request.decidedAt).toBeNull();
    expect(getApprovalRequest(request.id)).toEqual(request);
    expect(listApprovalRequests()).toEqual([request]);
    expect(listApprovalRequests("PENDING")).toEqual([request]);
    expect(listApprovalRequests("APPROVED")).toEqual([]);
  });

  it("decideApprovalRequest(approve: true) moves the request to APPROVED", () => {
    const request = createApprovalRequest({
      entityType: "CONFIGURATION",
      action: "EXECUTE",
      requestedBy: "user-1",
      reason: "run checks",
    });

    const decided = decideApprovalRequest(request.id, {
      decidedBy: "admin-1",
      approve: true,
      decisionReason: "looks fine",
    });

    expect(decided.status).toBe("APPROVED");
    expect(decided.decidedBy).toBe("admin-1");
    expect(decided.decisionReason).toBe("looks fine");
    expect(decided.decidedAt).not.toBeNull();
  });

  it("decideApprovalRequest(approve: false) moves the request to REJECTED", () => {
    const request = createApprovalRequest({
      entityType: "CONFIGURATION",
      action: "EXECUTE",
      requestedBy: "user-1",
      reason: "run checks",
    });

    const decided = decideApprovalRequest(request.id, {
      decidedBy: "admin-1",
      approve: false,
      decisionReason: "not right now",
    });

    expect(decided.status).toBe("REJECTED");
  });

  it("decideApprovalRequest throws NOT_FOUND for an unknown id", () => {
    expect(() =>
      decideApprovalRequest("00000000-0000-4000-8000-000000000000", {
        decidedBy: "admin-1",
        approve: true,
        decisionReason: "n/a",
      }),
    ).toThrow(/not found/i);
  });

  it("decideApprovalRequest throws when the request has already been decided", () => {
    const request = createApprovalRequest({
      entityType: "CONFIGURATION",
      action: "EXECUTE",
      requestedBy: "user-1",
      reason: "run checks",
    });
    decideApprovalRequest(request.id, {
      decidedBy: "admin-1",
      approve: true,
      decisionReason: "ok",
    });

    expect(() =>
      decideApprovalRequest(request.id, {
        decidedBy: "admin-2",
        approve: true,
        decisionReason: "again",
      }),
    ).toThrow(/already been decided/i);
  });

  it("consumeApprovalRequest flips an APPROVED request to CONSUMED", () => {
    const request = createApprovalRequest({
      entityType: "CONFIGURATION",
      action: "EXECUTE",
      requestedBy: "user-1",
      reason: "run checks",
    });
    decideApprovalRequest(request.id, {
      decidedBy: "admin-1",
      approve: true,
      decisionReason: "ok",
    });

    const consumed = consumeApprovalRequest(request.id);
    expect(consumed.status).toBe("CONSUMED");
    expect(getApprovalRequest(request.id)?.status).toBe("CONSUMED");
  });

  it("consumeApprovalRequest throws when the request is not APPROVED", () => {
    const request = createApprovalRequest({
      entityType: "CONFIGURATION",
      action: "EXECUTE",
      requestedBy: "user-1",
      reason: "run checks",
    });

    expect(() => consumeApprovalRequest(request.id)).toThrow(/not APPROVED/i);
  });

  it("consumeApprovalRequest throws the second time it is called on the same request", () => {
    const request = createApprovalRequest({
      entityType: "CONFIGURATION",
      action: "EXECUTE",
      requestedBy: "user-1",
      reason: "run checks",
    });
    decideApprovalRequest(request.id, {
      decidedBy: "admin-1",
      approve: true,
      decisionReason: "ok",
    });
    consumeApprovalRequest(request.id);

    expect(() => consumeApprovalRequest(request.id)).toThrow(/not APPROVED/i);
  });
});

describe("approval ↔ artifact binding (P0 governance)", () => {
  function approvedRequest(artifactHash: string | null, expiresAt?: string) {
    const created = createApprovalRequest({
      entityType: "RECORD",
      action: "UPDATE",
      requestedBy: "agent-1",
      reason: "apply the reviewed patch",
      ...(artifactHash !== null ? { artifactHash } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    });
    decideApprovalRequest(created.id, {
      decidedBy: "human-1",
      approve: true,
      decisionReason: "looks correct",
    });
    return created.id;
  }

  it("authorizes the exact artifact the approver signed off on", () => {
    const id = approvedRequest("sha256:abc123");
    const consumed = consumeApprovalRequest(id, { artifactHash: "sha256:abc123" });
    expect(consumed.status).toBe("CONSUMED");
  });

  it("REFUSES a different artifact under the same approval", () => {
    // The whole point: approving "patch A" must not authorize "patch B".
    const id = approvedRequest("sha256:abc123");
    expect(() => consumeApprovalRequest(id, { artifactHash: "sha256:xyz999" })).toThrow(
      /authorizes artifact sha256:abc123, not sha256:xyz999/,
    );
  });

  it("REFUSES to consume a bound approval when no hash is presented", () => {
    // A caller must not be able to downgrade a bound approval back into a
    // categorical one by simply omitting the hash.
    const id = approvedRequest("sha256:abc123");
    expect(() => consumeApprovalRequest(id)).toThrow(/requires presenting that artifact's hash/);
  });

  it("leaves categorical (unbound) approvals working exactly as before", () => {
    const id = approvedRequest(null);
    expect(consumeApprovalRequest(id).status).toBe("CONSUMED");
  });

  it("REFUSES an expired approval", () => {
    const id = approvedRequest(null, new Date(Date.now() - 1_000).toISOString());
    expect(() => consumeApprovalRequest(id)).toThrow(/expired at/);
  });

  it("still consumes an approval whose expiry is in the future", () => {
    const id = approvedRequest(null, new Date(Date.now() + 60_000).toISOString());
    expect(consumeApprovalRequest(id).status).toBe("CONSUMED");
  });

  it("checks expiry BEFORE artifact binding (an expired approval is unusable either way)", () => {
    const id = approvedRequest("sha256:abc123", new Date(Date.now() - 1_000).toISOString());
    expect(() => consumeApprovalRequest(id, { artifactHash: "sha256:abc123" })).toThrow(/expired at/);
  });
});

describe("approval attack suite — substitution must always DENY", () => {
  function approved(overrides: { artifactHash?: string } = {}) {
    const created = createApprovalRequest({
      entityType: "RECORD",
      action: "UPDATE",
      requestedBy: "agent-alpha",
      reason: "apply the reviewed patch",
      ...overrides,
    });
    decideApprovalRequest(created.id, {
      decidedBy: "human-1",
      approve: true,
      decisionReason: "reviewed",
    });
    return created.id;
  }

  it("ALLOWS the exact approved execution", () => {
    const id = approved({ artifactHash: "sha256:abc" });
    expect(
      consumeApprovalRequest(id, {
        artifactHash: "sha256:abc",
        entityType: "RECORD",
        action: "UPDATE",
        agentId: "agent-alpha",
      }).status,
    ).toBe("CONSUMED");
  });

  it("DENIES a different artifact", () => {
    const id = approved({ artifactHash: "sha256:abc" });
    expect(() =>
      consumeApprovalRequest(id, { artifactHash: "sha256:evil" }),
    ).toThrow(/authorizes artifact/);
  });

  it("DENIES an escalated action (UPDATE approval used for DELETE)", () => {
    const id = approved();
    expect(() => consumeApprovalRequest(id, { action: "DELETE" })).toThrow(
      /authorizes action UPDATE, not DELETE/,
    );
  });

  it("DENIES a retargeted entity type", () => {
    const id = approved();
    expect(() =>
      consumeApprovalRequest(id, { entityType: "FINANCIAL_TRANSACTION" }),
    ).toThrow(/authorizes entityType RECORD/);
  });

  it("DENIES a different agent redeeming another agent's approval", () => {
    const id = approved();
    expect(() => consumeApprovalRequest(id, { agentId: "agent-beta" })).toThrow(
      /cannot be redeemed by agent-beta/,
    );
  });

  it("DENIES replay — an already-CONSUMED approval cannot be reused", () => {
    const id = approved();
    expect(consumeApprovalRequest(id).status).toBe("CONSUMED");
    expect(() => consumeApprovalRequest(id)).toThrow(/not APPROVED/);
  });

  it("DENIES a REJECTED approval", () => {
    const created = createApprovalRequest({
      entityType: "RECORD",
      action: "UPDATE",
      requestedBy: "agent-alpha",
      reason: "nope",
    });
    decideApprovalRequest(created.id, {
      decidedBy: "human-1",
      approve: false,
      decisionReason: "unsafe",
    });
    expect(() => consumeApprovalRequest(created.id)).toThrow(/not APPROVED/);
  });

  it("DENIES a still-PENDING approval", () => {
    const created = createApprovalRequest({
      entityType: "RECORD",
      action: "UPDATE",
      requestedBy: "agent-alpha",
      reason: "waiting",
    });
    expect(() => consumeApprovalRequest(created.id)).toThrow(/not APPROVED/);
  });
});

describe("approval revocation — revocation beats approval", () => {
  beforeEach(() => {
    resetApprovalsForTests();
  });

  afterEach(() => {
    resetApprovalsForTests();
  });

  function pending(overrides: { artifactHash?: string; expiresAt?: string } = {}) {
    return createApprovalRequest({
      entityType: "RECORD",
      action: "UPDATE",
      requestedBy: "agent-alpha",
      reason: "apply the reviewed patch",
      ...overrides,
    }).id;
  }

  function approved(overrides: { artifactHash?: string; expiresAt?: string } = {}) {
    const id = pending(overrides);
    decideApprovalRequest(id, {
      decidedBy: "human-1",
      approve: true,
      decisionReason: "reviewed",
    });
    return id;
  }

  it("DENIES consuming an approval that was revoked after approval", () => {
    const id = approved();
    revokeApprovalRequest(id, { revokedBy: "human-2", reason: "patch superseded" });

    // The denial must NAME the revocation — not expiry, not artifact
    // mismatch, and not the generic "not APPROVED" catch-all. A human took
    // this back, and the error has to say so.
    expect(() => consumeApprovalRequest(id)).toThrow(/REVOKED/);
    expect(() => consumeApprovalRequest(id)).not.toThrow(/expired at/);
    expect(() => consumeApprovalRequest(id)).not.toThrow(/authorizes artifact/);
    expect(() => consumeApprovalRequest(id)).not.toThrow(/is not APPROVED/);
  });

  it("DENIES a revoked approval even with the CORRECT artifact hash and no expiry", () => {
    // The load-bearing test. Everything about this execution is legitimate:
    // the hash is the exact one the approver signed off on, the expiry is an
    // hour out, the agent and action match. It is refused purely because the
    // authorization was withdrawn — revocation outranks a perfectly valid
    // approval, or it is not revocation at all.
    const id = approved({
      artifactHash: "sha256:abc",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    revokeApprovalRequest(id, { revokedBy: "human-2", reason: "incident resolved" });

    expect(() =>
      consumeApprovalRequest(id, {
        artifactHash: "sha256:abc",
        entityType: "RECORD",
        action: "UPDATE",
        agentId: "agent-alpha",
      }),
    ).toThrow(/REVOKED/);
    expect(getApprovalRequest(id)?.status).toBe("REVOKED");
  });

  it("checks revocation BEFORE expiry (a revoked approval never reports as merely expired)", () => {
    const id = approved({ expiresAt: new Date(Date.now() - 1_000).toISOString() });
    revokeApprovalRequest(id, { revokedBy: "human-2", reason: "withdrawn" });
    expect(() => consumeApprovalRequest(id)).toThrow(/REVOKED/);
  });

  it("checks revocation BEFORE artifact binding (no 'the artifact matched' oracle)", () => {
    // A mismatched hash on a revoked approval must still report revocation:
    // if the two cases produced different errors, a caller could probe which
    // artifact a withdrawn approval covered.
    const id = approved({ artifactHash: "sha256:abc" });
    revokeApprovalRequest(id, { revokedBy: "human-2", reason: "withdrawn" });
    expect(() => consumeApprovalRequest(id, { artifactHash: "sha256:evil" })).toThrow(
      /REVOKED/,
    );
  });

  it("records revocation provenance on the request", () => {
    const id = approved();
    const revoked = revokeApprovalRequest(id, {
      revokedBy: "human-2",
      reason: "the change was rolled back upstream",
    });

    expect(revoked.status).toBe("REVOKED");
    expect(revoked.revokedBy).toBe("human-2");
    expect(revoked.revokedAt).not.toBeNull();
    expect(revoked.revocationReason).toBe("the change was rolled back upstream");
    // The original decision provenance survives — revocation adds to the
    // record rather than overwriting who granted the approval.
    expect(revoked.decidedBy).toBe("human-1");
    expect(getApprovalRequest(id)).toEqual(revoked);
    expect(listApprovalRequests("REVOKED")).toEqual([revoked]);
  });

  it("allows revoking a PENDING request (withdrawn before any decision)", () => {
    const id = pending();
    const revoked = revokeApprovalRequest(id, {
      revokedBy: "agent-alpha",
      reason: "no longer needed",
    });

    expect(revoked.status).toBe("REVOKED");
    expect(revoked.decidedBy).toBeNull();
    // And it can no longer be approved into life afterwards.
    expect(() =>
      decideApprovalRequest(id, {
        decidedBy: "human-1",
        approve: true,
        decisionReason: "too late",
      }),
    ).toThrow(/already been decided/i);
  });

  it("REFUSES to revoke a CONSUMED approval — the execution already happened", () => {
    const id = approved();
    expect(consumeApprovalRequest(id).status).toBe("CONSUMED");

    expect(() =>
      revokeApprovalRequest(id, { revokedBy: "human-2", reason: "second thoughts" }),
    ).toThrow(/already been CONSUMED and cannot be revoked/);
    // The record still tells the truth about what happened.
    expect(getApprovalRequest(id)?.status).toBe("CONSUMED");
  });

  it("REFUSES to revoke an already-REVOKED approval", () => {
    const id = approved();
    revokeApprovalRequest(id, { revokedBy: "human-2", reason: "first" });
    expect(() =>
      revokeApprovalRequest(id, { revokedBy: "human-3", reason: "second" }),
    ).toThrow(/cannot be revoked/);
    expect(getApprovalRequest(id)?.revokedBy).toBe("human-2");
  });

  it("revokeApprovalRequest throws NOT_FOUND for an unknown id", () => {
    expect(() =>
      revokeApprovalRequest("00000000-0000-4000-8000-000000000000", {
        revokedBy: "human-2",
        reason: "n/a",
      }),
    ).toThrow(/not found/i);
  });

  it("leaves a non-revoked approval consuming exactly as before (regression)", () => {
    const id = approved({
      artifactHash: "sha256:abc",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const consumed = consumeApprovalRequest(id, {
      artifactHash: "sha256:abc",
      entityType: "RECORD",
      action: "UPDATE",
      agentId: "agent-alpha",
    });

    expect(consumed.status).toBe("CONSUMED");
    expect(consumed.revokedBy).toBeNull();
    expect(consumed.revokedAt).toBeNull();
    expect(consumed.revocationReason).toBeNull();
  });

  it("revoking one approval does not affect an unrelated live approval", () => {
    const doomed = approved({ artifactHash: "sha256:one" });
    const survivor = approved({ artifactHash: "sha256:two" });
    revokeApprovalRequest(doomed, { revokedBy: "human-2", reason: "withdrawn" });

    expect(() => consumeApprovalRequest(doomed, { artifactHash: "sha256:one" })).toThrow(
      /REVOKED/,
    );
    expect(consumeApprovalRequest(survivor, { artifactHash: "sha256:two" }).status).toBe(
      "CONSUMED",
    );
  });
});

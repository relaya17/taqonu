import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LiveApprovalRequestRepository } from "@atlas/database";
import {
  createInProcessLiveApprovalClient,
  resetApprovalsForTests,
} from "./approvals-test-store.js";

process.env.ATLAS_SKIP_AUDIT_LOG = "1";

const {
  claimApprovalRequest,
  clearLiveApprovalStoreForTests,
  configureLiveApprovalStore,
  consumeApprovalRequest,
  createApprovalRequest,
  decideApprovalRequest,
  finalizeApprovalRequest,
  getApprovalRequest,
  listApprovalRequests,
  markApprovalExecutionStarted,
  revokeApprovalRequest,
} = await import("./approvals.js");

describe("approvals service", () => {
  beforeEach(() => {
    resetApprovalsForTests();
  });

  afterEach(() => {
    resetApprovalsForTests();
  });

  it("createApprovalRequest creates a PENDING request", async () => {
    const request = await createApprovalRequest({
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
    expect(await getApprovalRequest(request.id)).toEqual(request);
    expect(await listApprovalRequests()).toEqual([request]);
    expect(await listApprovalRequests("PENDING")).toEqual([request]);
    expect(await listApprovalRequests("APPROVED")).toEqual([]);
  });

  it("decideApprovalRequest(approve: true) moves the request to APPROVED", async () => {
    const request = await createApprovalRequest({
      entityType: "CONFIGURATION",
      action: "EXECUTE",
      requestedBy: "user-1",
      reason: "run checks",
    });

    const decided = await decideApprovalRequest(request.id, {
      decidedBy: "admin-1",
      approve: true,
      decisionReason: "looks fine",
    });

    expect(decided.status).toBe("APPROVED");
    expect(decided.decidedBy).toBe("admin-1");
    expect(decided.decisionReason).toBe("looks fine");
    expect(decided.decidedAt).not.toBeNull();
  });

  it("decideApprovalRequest(approve: false) moves the request to REJECTED", async () => {
    const request = await createApprovalRequest({
      entityType: "CONFIGURATION",
      action: "EXECUTE",
      requestedBy: "user-1",
      reason: "run checks",
    });

    const decided = await decideApprovalRequest(request.id, {
      decidedBy: "admin-1",
      approve: false,
      decisionReason: "not right now",
    });

    expect(decided.status).toBe("REJECTED");
  });

  it("decideApprovalRequest throws NOT_FOUND for an unknown id", async () => {
    await expect(
      decideApprovalRequest("00000000-0000-4000-8000-000000000000", {
        decidedBy: "admin-1",
        approve: true,
        decisionReason: "n/a",
      }),
    ).rejects.toThrow(/not found/i);
  });

  it("decideApprovalRequest throws when the request has already been decided", async () => {
    const request = await createApprovalRequest({
      entityType: "CONFIGURATION",
      action: "EXECUTE",
      requestedBy: "user-1",
      reason: "run checks",
    });
    await decideApprovalRequest(request.id, {
      decidedBy: "admin-1",
      approve: true,
      decisionReason: "ok",
    });

    await expect(
      decideApprovalRequest(request.id, {
        decidedBy: "admin-2",
        approve: true,
        decisionReason: "again",
      }),
    ).rejects.toThrow(/already been decided/i);
  });

  it("consumeApprovalRequest flips an APPROVED request to CONSUMED", async () => {
    const request = await createApprovalRequest({
      entityType: "CONFIGURATION",
      action: "EXECUTE",
      requestedBy: "user-1",
      reason: "run checks",
    });
    await decideApprovalRequest(request.id, {
      decidedBy: "admin-1",
      approve: true,
      decisionReason: "ok",
    });

    const consumed = await consumeApprovalRequest(request.id);
    expect(consumed.status).toBe("CONSUMED");
    expect((await getApprovalRequest(request.id))?.status).toBe("CONSUMED");
  });

  it("consumeApprovalRequest throws when the request is not APPROVED", async () => {
    const request = await createApprovalRequest({
      entityType: "CONFIGURATION",
      action: "EXECUTE",
      requestedBy: "user-1",
      reason: "run checks",
    });

    await expect(consumeApprovalRequest(request.id)).rejects.toThrow(/not APPROVED/i);
  });

  it("consumeApprovalRequest throws the second time it is called on the same request", async () => {
    const request = await createApprovalRequest({
      entityType: "CONFIGURATION",
      action: "EXECUTE",
      requestedBy: "user-1",
      reason: "run checks",
    });
    await decideApprovalRequest(request.id, {
      decidedBy: "admin-1",
      approve: true,
      decisionReason: "ok",
    });
    await consumeApprovalRequest(request.id);

    await expect(consumeApprovalRequest(request.id)).rejects.toThrow(/not APPROVED/i);
  });
});

describe("approval ↔ artifact binding (P0 governance)", () => {
  async function approvedRequest(artifactHash: string | null, expiresAt?: string) {
    const created = await createApprovalRequest({
      entityType: "RECORD",
      action: "UPDATE",
      requestedBy: "agent-1",
      reason: "apply the reviewed patch",
      ...(artifactHash !== null ? { artifactHash } : {}),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    });
    await decideApprovalRequest(created.id, {
      decidedBy: "human-1",
      approve: true,
      decisionReason: "looks correct",
    });
    return created.id;
  }

  it("authorizes the exact artifact the approver signed off on", async () => {
    const id = await approvedRequest("sha256:abc123");
    const consumed = await consumeApprovalRequest(id, { artifactHash: "sha256:abc123" });
    expect(consumed.status).toBe("CONSUMED");
  });

  it("REFUSES a different artifact under the same approval", async () => {
    // The whole point: approving "patch A" must not authorize "patch B".
    const id = await approvedRequest("sha256:abc123");
    await expect(consumeApprovalRequest(id, { artifactHash: "sha256:xyz999" })).rejects.toThrow(
      /authorizes artifact sha256:abc123, not sha256:xyz999/,
    );
  });

  it("REFUSES to consume a bound approval when no hash is presented", async () => {
    // A caller must not be able to downgrade a bound approval back into a
    // categorical one by simply omitting the hash.
    const id = await approvedRequest("sha256:abc123");
    await expect(consumeApprovalRequest(id)).rejects.toThrow(/requires presenting that artifact's hash/);
  });

  it("leaves categorical (unbound) approvals working exactly as before", async () => {
    const id = await approvedRequest(null);
    expect((await consumeApprovalRequest(id)).status).toBe("CONSUMED");
  });

  it("REFUSES an expired approval", async () => {
    const id = await approvedRequest(null, new Date(Date.now() - 1_000).toISOString());
    await expect(consumeApprovalRequest(id)).rejects.toThrow(/expired at/);
  });

  it("still consumes an approval whose expiry is in the future", async () => {
    const id = await approvedRequest(null, new Date(Date.now() + 60_000).toISOString());
    expect((await consumeApprovalRequest(id)).status).toBe("CONSUMED");
  });

  it("checks expiry BEFORE artifact binding (an expired approval is unusable either way)", async () => {
    const id = await approvedRequest("sha256:abc123", new Date(Date.now() - 1_000).toISOString());
    await expect(consumeApprovalRequest(id, { artifactHash: "sha256:abc123" })).rejects.toThrow(/expired at/);
  });
});

describe("approval attack suite — substitution must always DENY", () => {
  async function approved(overrides: { artifactHash?: string } = {}) {
    const created = await createApprovalRequest({
      entityType: "RECORD",
      action: "UPDATE",
      requestedBy: "agent-alpha",
      reason: "apply the reviewed patch",
      ...overrides,
    });
    await decideApprovalRequest(created.id, {
      decidedBy: "human-1",
      approve: true,
      decisionReason: "reviewed",
    });
    return created.id;
  }

  it("ALLOWS the exact approved execution", async () => {
    const id = await approved({ artifactHash: "sha256:abc" });
    expect(
      (
        await consumeApprovalRequest(id, {
          artifactHash: "sha256:abc",
          entityType: "RECORD",
          action: "UPDATE",
          agentId: "agent-alpha",
        })
      ).status,
    ).toBe("CONSUMED");
  });

  it("DENIES a different artifact", async () => {
    const id = await approved({ artifactHash: "sha256:abc" });
    await expect(
      consumeApprovalRequest(id, { artifactHash: "sha256:evil" }),
    ).rejects.toThrow(/authorizes artifact/);
  });

  it("DENIES an escalated action (UPDATE approval used for DELETE)", async () => {
    const id = await approved();
    await expect(consumeApprovalRequest(id, { action: "DELETE" })).rejects.toThrow(
      /authorizes action UPDATE, not DELETE/,
    );
  });

  it("DENIES a retargeted entity type", async () => {
    const id = await approved();
    await expect(
      consumeApprovalRequest(id, { entityType: "FINANCIAL_TRANSACTION" }),
    ).rejects.toThrow(/authorizes entityType RECORD/);
  });

  it("DENIES a different agent redeeming another agent's approval", async () => {
    const id = await approved();
    await expect(consumeApprovalRequest(id, { agentId: "agent-beta" })).rejects.toThrow(
      /cannot be redeemed by agent-beta/,
    );
  });

  it("DENIES replay — an already-CONSUMED approval cannot be reused", async () => {
    const id = await approved();
    expect((await consumeApprovalRequest(id)).status).toBe("CONSUMED");
    await expect(consumeApprovalRequest(id)).rejects.toThrow(/not APPROVED/);
  });

  it("DENIES a REJECTED approval", async () => {
    const created = await createApprovalRequest({
      entityType: "RECORD",
      action: "UPDATE",
      requestedBy: "agent-alpha",
      reason: "nope",
    });
    await decideApprovalRequest(created.id, {
      decidedBy: "human-1",
      approve: false,
      decisionReason: "unsafe",
    });
    await expect(consumeApprovalRequest(created.id)).rejects.toThrow(/not APPROVED/);
  });

  it("DENIES a still-PENDING approval", async () => {
    const created = await createApprovalRequest({
      entityType: "RECORD",
      action: "UPDATE",
      requestedBy: "agent-alpha",
      reason: "waiting",
    });
    await expect(consumeApprovalRequest(created.id)).rejects.toThrow(/not APPROVED/);
  });
});

describe("approval revocation — revocation beats approval", () => {
  beforeEach(() => {
    resetApprovalsForTests();
  });

  afterEach(() => {
    resetApprovalsForTests();
  });

  async function pending(overrides: { artifactHash?: string; expiresAt?: string } = {}) {
    return (await createApprovalRequest({
      entityType: "RECORD",
      action: "UPDATE",
      requestedBy: "agent-alpha",
      reason: "apply the reviewed patch",
      ...overrides,
    })).id;
  }

  async function approved(overrides: { artifactHash?: string; expiresAt?: string } = {}) {
    const id = await pending(overrides);
    await decideApprovalRequest(id, {
      decidedBy: "human-1",
      approve: true,
      decisionReason: "reviewed",
    });
    return id;
  }

  it("DENIES consuming an approval that was revoked after approval", async () => {
    const id = await approved();
    await revokeApprovalRequest(id, { revokedBy: "human-2", reason: "patch superseded" });

    // The denial must NAME the revocation — not expiry, not artifact
    // mismatch, and not the generic "not APPROVED" catch-all. A human took
    // this back, and the error has to say so.
    await expect(consumeApprovalRequest(id)).rejects.toThrow(/REVOKED/);
    await expect(consumeApprovalRequest(id)).rejects.not.toThrow(/expired at/);
    await expect(consumeApprovalRequest(id)).rejects.not.toThrow(/authorizes artifact/);
    await expect(consumeApprovalRequest(id)).rejects.not.toThrow(/is not APPROVED/);
  });

  it("DENIES a revoked approval even with the CORRECT artifact hash and no expiry", async () => {
    // The load-bearing test. Everything about this execution is legitimate:
    // the hash is the exact one the approver signed off on, the expiry is an
    // hour out, the agent and action match. It is refused purely because the
    // authorization was withdrawn — revocation outranks a perfectly valid
    // approval, or it is not revocation at all.
    const id = await approved({
      artifactHash: "sha256:abc",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    await revokeApprovalRequest(id, { revokedBy: "human-2", reason: "incident resolved" });

    await expect(
      consumeApprovalRequest(id, {
        artifactHash: "sha256:abc",
        entityType: "RECORD",
        action: "UPDATE",
        agentId: "agent-alpha",
      }),
    ).rejects.toThrow(/REVOKED/);
    expect((await getApprovalRequest(id))?.status).toBe("REVOKED");
  });

  it("checks revocation BEFORE expiry (a revoked approval never reports as merely expired)", async () => {
    const id = await approved({ expiresAt: new Date(Date.now() - 1_000).toISOString() });
    await revokeApprovalRequest(id, { revokedBy: "human-2", reason: "withdrawn" });
    await expect(consumeApprovalRequest(id)).rejects.toThrow(/REVOKED/);
  });

  it("checks revocation BEFORE artifact binding (no 'the artifact matched' oracle)", async () => {
    // A mismatched hash on a revoked approval must still report revocation:
    // if the two cases produced different errors, a caller could probe which
    // artifact a withdrawn approval covered.
    const id = await approved({ artifactHash: "sha256:abc" });
    await revokeApprovalRequest(id, { revokedBy: "human-2", reason: "withdrawn" });
    await expect(consumeApprovalRequest(id, { artifactHash: "sha256:evil" })).rejects.toThrow(
      /REVOKED/,
    );
  });

  it("records revocation provenance on the request", async () => {
    const id = await approved();
    const revoked = await revokeApprovalRequest(id, {
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
    expect(await getApprovalRequest(id)).toEqual(revoked);
    expect(await listApprovalRequests("REVOKED")).toEqual([revoked]);
  });

  it("allows revoking a PENDING request (withdrawn before any decision)", async () => {
    const id = await pending();
    const revoked = await revokeApprovalRequest(id, {
      revokedBy: "agent-alpha",
      reason: "no longer needed",
    });

    expect(revoked.status).toBe("REVOKED");
    expect(revoked.decidedBy).toBeNull();
    // And it can no longer be approved into life afterwards.
    await expect(
      decideApprovalRequest(id, {
        decidedBy: "human-1",
        approve: true,
        decisionReason: "too late",
      }),
    ).rejects.toThrow(/already been decided/i);
  });

  it("REFUSES to revoke a CONSUMED approval — the execution already happened", async () => {
    const id = await approved();
    expect((await consumeApprovalRequest(id)).status).toBe("CONSUMED");

    await expect(
      revokeApprovalRequest(id, { revokedBy: "human-2", reason: "second thoughts" }),
    ).rejects.toThrow(/already been CONSUMED and cannot be revoked/);
    // The record still tells the truth about what happened.
    expect((await getApprovalRequest(id))?.status).toBe("CONSUMED");
  });

  it("REFUSES to revoke an already-REVOKED approval", async () => {
    const id = await approved();
    await revokeApprovalRequest(id, { revokedBy: "human-2", reason: "first" });
    await expect(
      revokeApprovalRequest(id, { revokedBy: "human-3", reason: "second" }),
    ).rejects.toThrow(/cannot be revoked/);
    expect((await getApprovalRequest(id))?.revokedBy).toBe("human-2");
  });

  it("revokeApprovalRequest throws NOT_FOUND for an unknown id", async () => {
    await expect(
      revokeApprovalRequest("00000000-0000-4000-8000-000000000000", {
        revokedBy: "human-2",
        reason: "n/a",
      }),
    ).rejects.toThrow(/not found/i);
  });

  it("leaves a non-revoked approval consuming exactly as before (regression)", async () => {
    const id = await approved({
      artifactHash: "sha256:abc",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const consumed = await consumeApprovalRequest(id, {
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

  it("revoking one approval does not affect an unrelated live approval", async () => {
    const doomed = await approved({ artifactHash: "sha256:one" });
    const survivor = await approved({ artifactHash: "sha256:two" });
    await revokeApprovalRequest(doomed, { revokedBy: "human-2", reason: "withdrawn" });

    await expect(consumeApprovalRequest(doomed, { artifactHash: "sha256:one" })).rejects.toThrow(
      /REVOKED/,
    );
    expect(
      (await consumeApprovalRequest(survivor, { artifactHash: "sha256:two" })).status,
    ).toBe("CONSUMED");
  });
});

describe("Phase 3F durable authority — fail-closed and isolation", () => {
  afterEach(() => {
    resetApprovalsForTests();
  });

  it("12. create fails closed when PostgreSQL is unavailable and does not mint a phantom id", async () => {
    configureLiveApprovalStore(
      new LiveApprovalRequestRepository({
        rpc: async () => {
          throw new Error("connection refused");
        },
      }),
    );
    await expect(
      createApprovalRequest({
        entityType: "RECORD",
        action: "CREATE",
        requestedBy: "agent-1",
        reason: "down",
      }),
    ).rejects.toThrow(/connection refused|unavailable|not configured/i);
    clearLiveApprovalStoreForTests();
    await expect(
      getApprovalRequest("00000000-0000-4000-8000-000000000001"),
    ).rejects.toThrow(/not configured/i);
  });

  it("13. decide fails closed when PostgreSQL is unavailable", async () => {
    resetApprovalsForTests();
    const created = await createApprovalRequest({
      entityType: "RECORD",
      action: "CREATE",
      requestedBy: "agent-1",
      reason: "decide-down",
    });
    configureLiveApprovalStore(
      new LiveApprovalRequestRepository({
        rpc: async () => {
          throw new Error("connection refused");
        },
      }),
    );
    await expect(
      decideApprovalRequest(created.id, {
        decidedBy: "admin-1",
        approve: true,
        decisionReason: "ok",
      }),
    ).rejects.toThrow(/connection refused|unavailable/i);
  });

  it("14. consume fails closed when PostgreSQL is unavailable", async () => {
    configureLiveApprovalStore(
      new LiveApprovalRequestRepository({
        rpc: async () => {
          throw new Error("connection refused");
        },
      }),
    );
    await expect(
      consumeApprovalRequest("00000000-0000-4000-8000-000000000001"),
    ).rejects.toThrow(/connection refused|unavailable/i);
  });

  it("15. a new service instance sees the same durable backend (restart isolation)", async () => {
    const client = createInProcessLiveApprovalClient();
    configureLiveApprovalStore(new LiveApprovalRequestRepository(client));
    const created = await createApprovalRequest({
      entityType: "RECORD",
      action: "CREATE",
      requestedBy: "agent-1",
      reason: "restart",
    });
    configureLiveApprovalStore(new LiveApprovalRequestRepository(client));
    expect(await getApprovalRequest(created.id)).toEqual(created);
    configureLiveApprovalStore(
      new LiveApprovalRequestRepository(createInProcessLiveApprovalClient()),
    );
    expect(await getApprovalRequest(created.id)).toBeUndefined();
  });

  it("create fails closed when no store is configured (no Map fallback)", async () => {
    clearLiveApprovalStoreForTests();
    await expect(
      createApprovalRequest({
        entityType: "RECORD",
        action: "CREATE",
        requestedBy: "agent-1",
        reason: "unconfigured",
      }),
    ).rejects.toThrow(/not configured/i);
  });
});

describe("CP2 claim / mark-started / finalize service contract", () => {
  beforeEach(() => {
    resetApprovalsForTests();
  });

  afterEach(() => {
    resetApprovalsForTests();
  });

  const matching = {
    entityType: "RECORD",
    action: "CREATE",
    executorId: "agent-1",
  } as const;

  async function approve(overrides: {
    entityType?: string;
    action?: string;
    requestedBy?: string;
    reason?: string;
    artifactHash?: string;
    expiresAt?: string;
  } = {}) {
    const created = await createApprovalRequest({
      entityType: overrides.entityType ?? "RECORD",
      action: overrides.action ?? "CREATE",
      requestedBy: overrides.requestedBy ?? "agent-1",
      reason: overrides.reason ?? "cp2",
      ...(overrides.artifactHash !== undefined ? { artifactHash: overrides.artifactHash } : {}),
      ...(overrides.expiresAt !== undefined ? { expiresAt: overrides.expiresAt } : {}),
    });
    return decideApprovalRequest(created.id, {
      decidedBy: "admin-1",
      approve: true,
      decisionReason: "ok",
    });
  }

  it("create, decide, revoke, and consume still behave unchanged", async () => {
    const created = await createApprovalRequest({
      entityType: "CONFIGURATION",
      action: "EXECUTE",
      requestedBy: "user-1",
      reason: "unchanged consume path",
    });
    expect(created.status).toBe("PENDING");
    const decided = await decideApprovalRequest(created.id, {
      decidedBy: "admin-1",
      approve: true,
      decisionReason: "ok",
    });
    expect(decided.status).toBe("APPROVED");
    expect((await consumeApprovalRequest(decided.id)).status).toBe("CONSUMED");

    const toRevoke = await approve({ reason: "revoke-still-works" });
    expect(
      (await revokeApprovalRequest(toRevoke.id, { revokedBy: "human-1", reason: "withdrawn" }))
        .status,
    ).toBe("REVOKED");
  });

  it("claims APPROVED → CLAIMED and returns a store-minted liveExecutionId", async () => {
    const approved = await approve();
    const claimed = await claimApprovalRequest(approved.id, {
      ...matching,
      requestId: "req-1",
    });
    expect(claimed.status).toBe("CLAIMED");
    expect(claimed.liveExecutionId).toEqual(expect.any(String));
    expect(claimed.claimedBy).toBe("agent-1");
    expect(claimed.requestId).toBe("req-1");
    expect(await getApprovalRequest(claimed.id)).toEqual(claimed);
  });

  it("rejects binding mismatches, expiry, revoke, and a second claim", async () => {
    const bound = await approve({
      entityType: "DOCUMENT",
      action: "UPDATE",
      requestedBy: "agent-alpha",
      artifactHash: "sha256:abc",
    });
    await expect(
      claimApprovalRequest(bound.id, {
        entityType: "RECORD",
        action: "UPDATE",
        executorId: "agent-alpha",
        artifactHash: "sha256:abc",
      }),
    ).rejects.toThrow(/authorizes entityType/);
    await expect(
      claimApprovalRequest(bound.id, {
        entityType: "DOCUMENT",
        action: "DELETE",
        executorId: "agent-alpha",
        artifactHash: "sha256:abc",
      }),
    ).rejects.toThrow(/authorizes action/);
    await expect(
      claimApprovalRequest(bound.id, {
        entityType: "DOCUMENT",
        action: "UPDATE",
        executorId: "agent-beta",
        artifactHash: "sha256:abc",
      }),
    ).rejects.toThrow(/cannot be claimed/);
    await expect(
      claimApprovalRequest(bound.id, {
        entityType: "DOCUMENT",
        action: "UPDATE",
        executorId: "agent-alpha",
        artifactHash: "sha256:evil",
      }),
    ).rejects.toThrow(/authorizes artifact/);

    const expired = await approve({
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    await expect(claimApprovalRequest(expired.id, matching)).rejects.toThrow(/expired at/);

    const revoked = await approve({ reason: "revoke-then-claim" });
    await revokeApprovalRequest(revoked.id, { revokedBy: "human-1", reason: "withdrawn" });
    await expect(claimApprovalRequest(revoked.id, matching)).rejects.toThrow(/REVOKED/);

    const once = await approve({ reason: "second-claim" });
    expect((await claimApprovalRequest(once.id, matching)).status).toBe("CLAIMED");
    await expect(claimApprovalRequest(once.id, matching)).rejects.toThrow(/not APPROVED/);
  });

  it("get returns CLAIMED and terminal records with persisted claim metadata", async () => {
    const claimed = await claimApprovalRequest((await approve()).id, matching);
    expect((await getApprovalRequest(claimed.id))?.liveExecutionId).toBe(claimed.liveExecutionId);
    await markApprovalExecutionStarted(claimed.id, claimed.liveExecutionId as string);
    const finalized = await finalizeApprovalRequest(claimed.id, {
      liveExecutionId: claimed.liveExecutionId as string,
      outcome: "FULFILLED",
      outputEvidence: "ok",
    });
    const reloaded = await getApprovalRequest(claimed.id);
    expect(reloaded?.status).toBe("FULFILLED");
    expect(reloaded?.finalOutcome).toBe("FULFILLED");
    expect(reloaded?.liveExecutionId).toBe(claimed.liveExecutionId);
    expect(reloaded).toEqual(finalized);
  });

  it("marks execution started idempotently for the same liveExecutionId", async () => {
    const claimed = await claimApprovalRequest((await approve()).id, matching);
    const started = await markApprovalExecutionStarted(
      claimed.id,
      claimed.liveExecutionId as string,
    );
    expect(started.executionStartedAt).toEqual(expect.any(String));
    const replayed = await markApprovalExecutionStarted(
      claimed.id,
      claimed.liveExecutionId as string,
    );
    expect(replayed.executionStartedAt).toBe(started.executionStartedAt);
    await expect(
      markApprovalExecutionStarted(claimed.id, "00000000-0000-4000-8000-000000000099"),
    ).rejects.toThrow(/liveExecutionId/);
    const pending = await createApprovalRequest({
      entityType: "RECORD",
      action: "CREATE",
      requestedBy: "agent-1",
      reason: "not-claimed",
    });
    await expect(
      markApprovalExecutionStarted(pending.id, "00000000-0000-4000-8000-000000000099"),
    ).rejects.toThrow(/not CLAIMED/);
  });

  it("finalizes CLAIMED to FULFILLED, FAILED, and OUTCOME_UNKNOWN", async () => {
    const fulfilledClaim = await claimApprovalRequest((await approve({ reason: "ok" })).id, matching);
    await markApprovalExecutionStarted(
      fulfilledClaim.id,
      fulfilledClaim.liveExecutionId as string,
    );
    expect(
      (
        await finalizeApprovalRequest(fulfilledClaim.id, {
          liveExecutionId: fulfilledClaim.liveExecutionId as string,
          outcome: "FULFILLED",
          runtimeExecutionId: "11111111-1111-4111-8111-111111111111",
          outputEvidence: "ok",
        })
      ).status,
    ).toBe("FULFILLED");

    const failedClaim = await claimApprovalRequest((await approve({ reason: "fail" })).id, matching);
    expect(
      (
        await finalizeApprovalRequest(failedClaim.id, {
          liveExecutionId: failedClaim.liveExecutionId as string,
          outcome: "FAILED",
          reason: "tool exploded",
        })
      ).status,
    ).toBe("FAILED");

    const unknownClaim = await claimApprovalRequest(
      (await approve({ reason: "unknown" })).id,
      matching,
    );
    await markApprovalExecutionStarted(
      unknownClaim.id,
      unknownClaim.liveExecutionId as string,
    );
    expect(
      (
        await finalizeApprovalRequest(unknownClaim.id, {
          liveExecutionId: unknownClaim.liveExecutionId as string,
          outcome: "OUTCOME_UNKNOWN",
          reason: "process died after start",
        })
      ).status,
    ).toBe("OUTCOME_UNKNOWN");
  });

  it("rejects illegal finalize and does not reopen or reclaim", async () => {
    const claimed = await claimApprovalRequest((await approve()).id, matching);
    await expect(
      finalizeApprovalRequest(claimed.id, {
        liveExecutionId: claimed.liveExecutionId as string,
        outcome: "FULFILLED",
      }),
    ).rejects.toThrow(/FULFILLED requires execution evidence/);
    await expect(
      finalizeApprovalRequest(claimed.id, {
        liveExecutionId: claimed.liveExecutionId as string,
        outcome: "FAILED",
      }),
    ).rejects.toThrow(/FAILED requires a reason/);
    await expect(
      finalizeApprovalRequest(claimed.id, {
        liveExecutionId: claimed.liveExecutionId as string,
        outcome: "OUTCOME_UNKNOWN",
        reason: "not started",
      }),
    ).rejects.toThrow(/OUTCOME_UNKNOWN requires execution to have started/);
    await expect(
      finalizeApprovalRequest(claimed.id, {
        liveExecutionId: "00000000-0000-4000-8000-000000000099",
        outcome: "FAILED",
        reason: "wrong id",
      }),
    ).rejects.toThrow(/liveExecutionId/);

    const finalized = await finalizeApprovalRequest(claimed.id, {
      liveExecutionId: claimed.liveExecutionId as string,
      outcome: "FAILED",
      reason: "known failure",
    });
    expect(
      await finalizeApprovalRequest(claimed.id, {
        liveExecutionId: claimed.liveExecutionId as string,
        outcome: "FAILED",
        reason: "known failure",
      }),
    ).toEqual(finalized);
    await expect(
      finalizeApprovalRequest(claimed.id, {
        liveExecutionId: claimed.liveExecutionId as string,
        outcome: "FULFILLED",
        outputEvidence: "nope",
      }),
    ).rejects.toThrow(/conflicting terminal/);
    await expect(claimApprovalRequest(claimed.id, matching)).rejects.toThrow(/not APPROVED/);
    await expect(
      revokeApprovalRequest(claimed.id, { revokedBy: "human-1", reason: "reopen" }),
    ).rejects.toThrow(/cannot be revoked/);
  });

  it("propagates repository unavailability fail-closed", async () => {
    configureLiveApprovalStore(
      new LiveApprovalRequestRepository({
        rpc: async () => {
          throw new Error("connection refused");
        },
      }),
    );
    await expect(claimApprovalRequest("00000000-0000-4000-8000-000000000001", matching)).rejects.toThrow(
      /connection refused|unavailable/i,
    );
    await expect(
      markApprovalExecutionStarted(
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000002",
      ),
    ).rejects.toThrow(/connection refused|unavailable/i);
    await expect(
      finalizeApprovalRequest("00000000-0000-4000-8000-000000000001", {
        liveExecutionId: "00000000-0000-4000-8000-000000000002",
        outcome: "FAILED",
        reason: "down",
      }),
    ).rejects.toThrow(/connection refused|unavailable/i);
  });
});

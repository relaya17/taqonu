import { describe, expect, it, vi } from "vitest";
import { createInProcessLiveApprovalClient } from "./live-approval-requests.in-process.js";
import {
  LiveApprovalPersistenceError,
  LiveApprovalRequestRepository,
} from "./live-approval-requests.js";

function repositoryFromClient(client = createInProcessLiveApprovalClient()) {
  return { repository: new LiveApprovalRequestRepository(client), client };
}

describe("LiveApprovalRequestRepository", () => {
  it("creates a durable PENDING approval", async () => {
    const { repository } = repositoryFromClient();
    const created = await repository.create({
      entityType: "RECORD",
      action: "CREATE",
      requestedBy: "agent-1",
      reason: "phase-3f create",
    });
    expect(created.status).toBe("PENDING");
    expect(created.entityType).toBe("RECORD");
    expect(created.action).toBe("CREATE");
    expect(created.requestedBy).toBe("agent-1");
    expect(created.artifactHash).toBeNull();
    expect(created.expiresAt).toBeNull();
    expect(await repository.get(created.id)).toEqual(created);
  });

  it("decides approve and reject durably", async () => {
    const { repository } = repositoryFromClient();
    const approved = await repository.create({
      entityType: "CONFIGURATION",
      action: "EXECUTE",
      requestedBy: "user-1",
      reason: "run",
    });
    const decided = await repository.decide(approved.id, {
      decidedBy: "admin-1",
      approve: true,
      decisionReason: "ok",
    });
    expect(decided.status).toBe("APPROVED");
    expect(decided.decidedBy).toBe("admin-1");

    const rejected = await repository.create({
      entityType: "CONFIGURATION",
      action: "EXECUTE",
      requestedBy: "user-1",
      reason: "run",
    });
    expect(
      (await repository.decide(rejected.id, {
        decidedBy: "admin-1",
        approve: false,
        decisionReason: "no",
      })).status,
    ).toBe("REJECTED");
  });

  it("revokes PENDING and APPROVED, and refuses CONSUMED", async () => {
    const { repository } = repositoryFromClient();
    const pending = await repository.create({
      entityType: "RECORD",
      action: "UPDATE",
      requestedBy: "agent-1",
      reason: "withdraw",
    });
    expect(
      (await repository.revoke(pending.id, { revokedBy: "human-1", reason: "n/a" })).status,
    ).toBe("REVOKED");

    const approved = await repository.create({
      entityType: "RECORD",
      action: "UPDATE",
      requestedBy: "agent-1",
      reason: "revoke after approve",
    });
    await repository.decide(approved.id, {
      decidedBy: "admin-1",
      approve: true,
      decisionReason: "ok",
    });
    const revoked = await repository.revoke(approved.id, {
      revokedBy: "human-2",
      reason: "withdrawn",
    });
    expect(revoked.status).toBe("REVOKED");
    await expect(repository.consume(approved.id)).rejects.toMatchObject({
      kind: "CONFLICT",
      message: expect.stringMatching(/REVOKED/),
    });
  });

  it("consumes exactly once", async () => {
    const { repository } = repositoryFromClient();
    const created = await repository.create({
      entityType: "RECORD",
      action: "CREATE",
      requestedBy: "agent-1",
      reason: "once",
    });
    await repository.decide(created.id, {
      decidedBy: "admin-1",
      approve: true,
      decisionReason: "ok",
    });
    expect((await repository.consume(created.id)).status).toBe("CONSUMED");
    await expect(repository.consume(created.id)).rejects.toBeInstanceOf(
      LiveApprovalPersistenceError,
    );
  });

  it("enforces artifact, entity, action, and requester bindings", async () => {
    const { repository } = repositoryFromClient();
    const created = await repository.create({
      entityType: "DOCUMENT",
      action: "UPDATE",
      requestedBy: "agent-alpha",
      reason: "bind",
      artifactHash: "sha256:abc",
    });
    await repository.decide(created.id, {
      decidedBy: "human-1",
      approve: true,
      decisionReason: "ok",
    });
    await expect(
      repository.consume(created.id, { artifactHash: "sha256:evil" }),
    ).rejects.toThrow(/authorizes artifact/);
    await expect(repository.consume(created.id)).rejects.toThrow(
      /requires presenting that artifact's hash/,
    );
    await expect(
      repository.consume(created.id, { artifactHash: "sha256:abc", entityType: "RECORD" }),
    ).rejects.toThrow(/authorizes entityType/);
    await expect(
      repository.consume(created.id, {
        artifactHash: "sha256:abc",
        entityType: "DOCUMENT",
        action: "DELETE",
      }),
    ).rejects.toThrow(/authorizes action/);
    await expect(
      repository.consume(created.id, {
        artifactHash: "sha256:abc",
        entityType: "DOCUMENT",
        action: "UPDATE",
        agentId: "agent-beta",
      }),
    ).rejects.toThrow(/cannot be redeemed/);
    expect(
      (
        await repository.consume(created.id, {
          artifactHash: "sha256:abc",
          entityType: "DOCUMENT",
          action: "UPDATE",
          agentId: "agent-alpha",
        })
      ).status,
    ).toBe("CONSUMED");
  });

  it("refuses expired and missing approvals", async () => {
    const { repository } = repositoryFromClient();
    const expired = await repository.create({
      entityType: "RECORD",
      action: "UPDATE",
      requestedBy: "agent-1",
      reason: "expired",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    await repository.decide(expired.id, {
      decidedBy: "admin-1",
      approve: true,
      decisionReason: "ok",
    });
    await expect(repository.consume(expired.id)).rejects.toThrow(/expired at/);
    await expect(
      repository.decide("00000000-0000-4000-8000-000000000000", {
        decidedBy: "admin-1",
        approve: true,
        decisionReason: "n/a",
      }),
    ).rejects.toMatchObject({ kind: "NOT_FOUND" });
    expect(await repository.get("00000000-0000-4000-8000-000000000000")).toBeUndefined();
  });

  it("fails closed when the RPC is unavailable", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("connection refused"));
    const repository = new LiveApprovalRequestRepository({ rpc });
    await expect(
      repository.create({
        entityType: "RECORD",
        action: "CREATE",
        requestedBy: "agent-1",
        reason: "down",
      }),
    ).rejects.toMatchObject({ kind: "UNAVAILABLE" });
    await expect(
      repository.decide("00000000-0000-4000-8000-000000000001", {
        decidedBy: "admin-1",
        approve: true,
        decisionReason: "ok",
      }),
    ).rejects.toMatchObject({ kind: "UNAVAILABLE" });
    await expect(
      repository.consume("00000000-0000-4000-8000-000000000001"),
    ).rejects.toMatchObject({ kind: "UNAVAILABLE" });
  });

  it("shares durable state across repository instances (process isolation)", async () => {
    const client = createInProcessLiveApprovalClient();
    const first = new LiveApprovalRequestRepository(client);
    const created = await first.create({
      entityType: "RECORD",
      action: "CREATE",
      requestedBy: "agent-1",
      reason: "restart",
    });
    const second = new LiveApprovalRequestRepository(client);
    expect(await second.get(created.id)).toEqual(created);
    const isolated = new LiveApprovalRequestRepository(createInProcessLiveApprovalClient());
    expect(await isolated.get(created.id)).toBeUndefined();
  });
});

describe("LiveApprovalRequestRepository claim/mark/finalize", () => {
  async function approve(
    repository: LiveApprovalRequestRepository,
    input: {
      entityType?: string;
      action?: string;
      requestedBy?: string;
      reason?: string;
      artifactHash?: string | null;
      expiresAt?: string | null;
    } = {},
  ) {
    const created = await repository.create({
      entityType: input.entityType ?? "RECORD",
      action: input.action ?? "CREATE",
      requestedBy: input.requestedBy ?? "agent-1",
      reason: input.reason ?? "claim-path",
      ...(input.artifactHash !== undefined ? { artifactHash: input.artifactHash } : {}),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
    });
    return repository.decide(created.id, {
      decidedBy: "admin-1",
      approve: true,
      decisionReason: "ok",
    });
  }

  const matching = {
    entityType: "RECORD",
    action: "CREATE",
    executorId: "agent-1",
  } as const;

  it("claims APPROVED → CLAIMED with a server-minted liveExecutionId", async () => {
    const { repository } = repositoryFromClient();
    const approved = await approve(repository);
    const claimed = await repository.claim(approved.id, {
      ...matching,
      requestId: "req-1",
    });
    expect(claimed.status).toBe("CLAIMED");
    expect(claimed.liveExecutionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(claimed.claimedBy).toBe("agent-1");
    expect(claimed.claimedAt).toEqual(expect.any(String));
    expect(claimed.requestId).toBe("req-1");
    expect(claimed.executionStartedAt).toBeNull();
    expect(claimed.finalOutcome).toBeNull();
    expect(await repository.get(claimed.id)).toEqual(claimed);
  });

  it("rejects a second claim and concurrent claimants share one liveExecutionId", async () => {
    const { repository } = repositoryFromClient();
    const approved = await approve(repository);
    const [first, second] = await Promise.allSettled([
      repository.claim(approved.id, matching),
      repository.claim(approved.id, matching),
    ]);
    const fulfilled = [first, second].filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof repository.claim>>> =>
        result.status === "fulfilled",
    );
    const rejected = [first, second].filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(fulfilled[0]?.value.status).toBe("CLAIMED");
    expect(rejected[0]?.reason).toMatchObject({
      kind: "CONFLICT",
      message: expect.stringMatching(/not APPROVED/),
    });
    const stored = await repository.get(approved.id);
    expect(stored?.liveExecutionId).toBe(fulfilled[0]?.value.liveExecutionId);
    await expect(repository.claim(approved.id, matching)).rejects.toMatchObject({
      kind: "CONFLICT",
    });
  });

  it("enforces entity, action, executor, and bound-artifact checks", async () => {
    const { repository } = repositoryFromClient();
    const approved = await approve(repository, {
      entityType: "DOCUMENT",
      action: "UPDATE",
      requestedBy: "agent-alpha",
      artifactHash: "sha256:abc",
    });
    await expect(
      repository.claim(approved.id, {
        entityType: "RECORD",
        action: "UPDATE",
        executorId: "agent-alpha",
        artifactHash: "sha256:abc",
      }),
    ).rejects.toThrow(/authorizes entityType/);
    await expect(
      repository.claim(approved.id, {
        entityType: "DOCUMENT",
        action: "DELETE",
        executorId: "agent-alpha",
        artifactHash: "sha256:abc",
      }),
    ).rejects.toThrow(/authorizes action/);
    await expect(
      repository.claim(approved.id, {
        entityType: "DOCUMENT",
        action: "UPDATE",
        executorId: "agent-beta",
        artifactHash: "sha256:abc",
      }),
    ).rejects.toThrow(/cannot be claimed/);
    await expect(
      repository.claim(approved.id, {
        entityType: "DOCUMENT",
        action: "UPDATE",
        executorId: "agent-alpha",
        artifactHash: "sha256:evil",
      }),
    ).rejects.toThrow(/authorizes artifact/);
    await expect(
      repository.claim(approved.id, {
        entityType: "DOCUMENT",
        action: "UPDATE",
        executorId: "agent-alpha",
      }),
    ).rejects.toThrow(/requires presenting that artifact's hash/);
    expect(
      (
        await repository.claim(approved.id, {
          entityType: "DOCUMENT",
          action: "UPDATE",
          executorId: "agent-alpha",
          artifactHash: "sha256:abc",
        })
      ).status,
    ).toBe("CLAIMED");
  });

  it("pins artifactHash on claim only when the approval was unbound", async () => {
    const { repository } = repositoryFromClient();
    const unbound = await approve(repository);
    const pinned = await repository.claim(unbound.id, {
      ...matching,
      artifactHash: "sha256:pinned",
    });
    expect(pinned.artifactHash).toBe("sha256:pinned");
    expect((await repository.get(unbound.id))?.artifactHash).toBe("sha256:pinned");
  });

  it("rejects expired, revoked, and missing claims", async () => {
    const { repository } = repositoryFromClient();
    const expired = await approve(repository, {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    await expect(repository.claim(expired.id, matching)).rejects.toThrow(/expired at/);

    const approved = await approve(repository, { reason: "revoke-then-claim" });
    await repository.revoke(approved.id, { revokedBy: "human-1", reason: "withdrawn" });
    await expect(repository.claim(approved.id, matching)).rejects.toThrow(/REVOKED/);

    await expect(
      repository.claim("00000000-0000-4000-8000-000000000001", matching),
    ).rejects.toMatchObject({ kind: "NOT_FOUND" });
  });

  it("marks execution started once, idempotently for the same liveExecutionId", async () => {
    const { repository } = repositoryFromClient();
    const claimed = await repository.claim(await approve(repository), matching);
    const started = await repository.markExecutionStarted(
      claimed.id,
      claimed.liveExecutionId as string,
    );
    expect(started.executionStartedAt).toEqual(expect.any(String));
    const replayed = await repository.markExecutionStarted(
      claimed.id,
      claimed.liveExecutionId as string,
    );
    expect(replayed.executionStartedAt).toBe(started.executionStartedAt);
    await expect(
      repository.markExecutionStarted(claimed.id, "00000000-0000-4000-8000-000000000099"),
    ).rejects.toThrow(/liveExecutionId/);
    const pending = await repository.create({
      entityType: "RECORD",
      action: "CREATE",
      requestedBy: "agent-1",
      reason: "not claimed",
    });
    await expect(
      repository.markExecutionStarted(pending.id, "00000000-0000-4000-8000-000000000099"),
    ).rejects.toThrow(/not CLAIMED/);
  });

  it("finalizes CLAIMED to FULFILLED, FAILED, and OUTCOME_UNKNOWN", async () => {
    const { repository } = repositoryFromClient();
    const fulfilledClaim = await repository.claim(await approve(repository, { reason: "ok" }), matching);
    await repository.markExecutionStarted(
      fulfilledClaim.id,
      fulfilledClaim.liveExecutionId as string,
    );
    const fulfilled = await repository.finalize(fulfilledClaim.id, {
      liveExecutionId: fulfilledClaim.liveExecutionId as string,
      outcome: "FULFILLED",
      runtimeExecutionId: "11111111-1111-4111-8111-111111111111",
      outputEvidence: "ok",
    });
    expect(fulfilled.status).toBe("FULFILLED");
    expect(fulfilled.finalOutcome).toBe("FULFILLED");
    expect(fulfilled.runtimeExecutionId).toBe("11111111-1111-4111-8111-111111111111");
    expect(fulfilled.outputEvidence).toBe("ok");

    const failedClaim = await repository.claim(
      await approve(repository, { reason: "fail" }),
      matching,
    );
    const failed = await repository.finalize(failedClaim.id, {
      liveExecutionId: failedClaim.liveExecutionId as string,
      outcome: "FAILED",
      reason: "tool exploded",
    });
    expect(failed.status).toBe("FAILED");
    expect(failed.finalizeReason).toBe("tool exploded");

    const unknownClaim = await repository.claim(
      await approve(repository, { reason: "unknown" }),
      matching,
    );
    await repository.markExecutionStarted(
      unknownClaim.id,
      unknownClaim.liveExecutionId as string,
    );
    const unknown = await repository.finalize(unknownClaim.id, {
      liveExecutionId: unknownClaim.liveExecutionId as string,
      outcome: "OUTCOME_UNKNOWN",
      reason: "process died after start",
    });
    expect(unknown.status).toBe("OUTCOME_UNKNOWN");
  });

  it("rejects illegal finalize and does not reopen or reclaim", async () => {
    const { repository } = repositoryFromClient();
    const claimed = await repository.claim(await approve(repository), matching);
    await expect(
      repository.finalize(claimed.id, {
        liveExecutionId: claimed.liveExecutionId as string,
        outcome: "FULFILLED",
      }),
    ).rejects.toThrow(/FULFILLED requires execution evidence/);
    await expect(
      repository.finalize(claimed.id, {
        liveExecutionId: claimed.liveExecutionId as string,
        outcome: "FAILED",
      }),
    ).rejects.toThrow(/FAILED requires a reason/);
    await expect(
      repository.finalize(claimed.id, {
        liveExecutionId: claimed.liveExecutionId as string,
        outcome: "OUTCOME_UNKNOWN",
        reason: "not started",
      }),
    ).rejects.toThrow(/OUTCOME_UNKNOWN requires execution to have started/);
    await expect(
      repository.finalize(claimed.id, {
        liveExecutionId: "00000000-0000-4000-8000-000000000099",
        outcome: "FAILED",
        reason: "wrong id",
      }),
    ).rejects.toThrow(/liveExecutionId/);

    const finalized = await repository.finalize(claimed.id, {
      liveExecutionId: claimed.liveExecutionId as string,
      outcome: "FAILED",
      reason: "known failure",
    });
    const replayed = await repository.finalize(claimed.id, {
      liveExecutionId: claimed.liveExecutionId as string,
      outcome: "FAILED",
      reason: "known failure",
    });
    expect(replayed).toEqual(finalized);
    await expect(
      repository.finalize(claimed.id, {
        liveExecutionId: claimed.liveExecutionId as string,
        outcome: "FULFILLED",
        outputEvidence: "nope",
      }),
    ).rejects.toThrow(/conflicting terminal/);
    await expect(repository.claim(claimed.id, matching)).rejects.toThrow(/not APPROVED/);
    await expect(
      repository.revoke(claimed.id, { revokedBy: "human-1", reason: "reopen" }),
    ).rejects.toThrow(/cannot be revoked/);
  });

  it("persists claim occupancy across repository instances sharing a client", async () => {
    const client = createInProcessLiveApprovalClient();
    const first = new LiveApprovalRequestRepository(client);
    const claimed = await first.claim(await approve(first), matching);
    const second = new LiveApprovalRequestRepository(client);
    const reloaded = await second.get(claimed.id);
    expect(reloaded?.status).toBe("CLAIMED");
    expect(reloaded?.liveExecutionId).toBe(claimed.liveExecutionId);
    const started = await second.markExecutionStarted(
      claimed.id,
      claimed.liveExecutionId as string,
    );
    const third = new LiveApprovalRequestRepository(client);
    expect((await third.get(claimed.id))?.executionStartedAt).toBe(started.executionStartedAt);
    await third.finalize(claimed.id, {
      liveExecutionId: claimed.liveExecutionId as string,
      outcome: "FULFILLED",
      outputEvidence: "digest",
    });
    expect((await first.get(claimed.id))?.status).toBe("FULFILLED");
    expect((await first.get(claimed.id))?.finalOutcome).toBe("FULFILLED");
  });
});

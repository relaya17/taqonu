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

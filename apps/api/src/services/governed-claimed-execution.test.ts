import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimApprovalRequest,
  createApprovalRequest,
  decideApprovalRequest,
  getApprovalRequest,
  markApprovalExecutionStarted,
} from "./approvals.js";
import { resetApprovalsForTests } from "./approvals-test-store.js";
import {
  resetGovernedClaimStartsForTests,
  runGovernedClaimedExecution,
} from "./governed-claimed-execution.js";

const AGENT = "agent-fabric-security";
const USER = "22222222-2222-4222-8222-222222222222";
const ARTIFACT = "a".repeat(64);

process.env.ATLAS_SKIP_AUDIT_LOG = "1";

describe("runGovernedClaimedExecution", () => {
  beforeEach(() => {
    resetApprovalsForTests();
    resetGovernedClaimStartsForTests();
  });

  afterEach(() => {
    resetApprovalsForTests();
    resetGovernedClaimStartsForTests();
    vi.restoreAllMocks();
  });

  const actor = {
    kind: "AGENT" as const,
    agentId: AGENT,
    onBehalfOfUserId: USER,
  };

  async function approveCreate() {
    const created = await createApprovalRequest({
      entityType: "RECORD",
      action: "CREATE",
      requestedBy: AGENT,
      reason: "helper",
      artifactHash: ARTIFACT,
    });
    return decideApprovalRequest(created.id, {
      decidedBy: USER,
      approve: true,
      decisionReason: "ok",
    });
  }

  it("no approval + ALLOWED executes once", async () => {
    let runs = 0;
    const result = await runGovernedClaimedExecution({
      executorId: AGENT,
      actor,
      entityType: "RECORD",
      action: "READ",
      requestId: "req-1",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      routeLabel: "test.helper.read",
      executeOnce: async () => {
        runs += 1;
        return { kind: "SUCCESS", value: "ok", outputEvidence: "ok" };
      },
    });
    expect(result.status).toBe("EXECUTED");
    expect(runs).toBe(1);
    expect(result.status === "EXECUTED" && result.approval).toBeNull();
  });

  it("no approval + DENIED does not execute", async () => {
    let runs = 0;
    const result = await runGovernedClaimedExecution({
      executorId: AGENT,
      actor,
      entityType: "RECORD",
      action: "READ",
      requestId: "req-1",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      routeLabel: "test.helper.paused",
      agentRuntimeStatus: "PAUSED",
      executeOnce: async () => {
        runs += 1;
        return { kind: "SUCCESS", value: "ok" };
      },
    });
    expect(result.status).toBe("DENIED");
    expect(runs).toBe(0);
  });

  it("no approval + APPROVAL_REQUIRED mints a new PENDING and does not execute", async () => {
    let runs = 0;
    const result = await runGovernedClaimedExecution({
      executorId: AGENT,
      actor,
      entityType: "RECORD",
      action: "CREATE",
      requestId: "req-1",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      routeLabel: "test.helper.need-approval",
      executeOnce: async () => {
        runs += 1;
        return { kind: "SUCCESS", value: "ok" };
      },
    });
    expect(result.status).toBe("APPROVAL_REQUIRED");
    expect(runs).toBe(0);
    if (result.status === "APPROVAL_REQUIRED") {
      expect((await getApprovalRequest(result.approvalRequestId))?.status).toBe("PENDING");
    }
  });

  it("first claim: CLAIMED → Phase 3E → mark-started → execute once → FULFILLED", async () => {
    const approved = await approveCreate();
    let runs = 0;
    const result = await runGovernedClaimedExecution({
      executorId: AGENT,
      actor,
      entityType: "RECORD",
      action: "CREATE",
      artifactHash: ARTIFACT,
      approvalRequestId: approved.id,
      requestId: "req-claim",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      routeLabel: "test.helper.claim",
      executeOnce: async () => {
        runs += 1;
        return { kind: "SUCCESS", value: "created", outputEvidence: "created" };
      },
    });
    expect(result.status).toBe("EXECUTED");
    expect(runs).toBe(1);
    const stored = await getApprovalRequest(approved.id);
    expect(stored?.status).toBe("FULFILLED");
    expect(stored?.liveExecutionId).toEqual(expect.any(String));
    expect(stored?.executionStartedAt).toEqual(expect.any(String));
  });

  it("resume CLAIMED + not started reuses liveExecutionId and does not claim twice", async () => {
    const approved = await approveCreate();
    const claimed = await claimApprovalRequest(approved.id, {
      entityType: "RECORD",
      action: "CREATE",
      executorId: AGENT,
      artifactHash: ARTIFACT,
    });
    let runs = 0;
    const result = await runGovernedClaimedExecution({
      executorId: AGENT,
      actor,
      entityType: "RECORD",
      action: "CREATE",
      artifactHash: ARTIFACT,
      approvalRequestId: claimed.id,
      requestId: "req-resume",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      routeLabel: "test.helper.resume",
      executeOnce: async () => {
        runs += 1;
        return { kind: "SUCCESS", value: "ok", outputEvidence: "ok" };
      },
    });
    expect(result.status).toBe("EXECUTED");
    expect(runs).toBe(1);
    expect(result.status === "EXECUTED" && result.approval?.liveExecutionId).toBe(
      claimed.liveExecutionId,
    );
    expect((await getApprovalRequest(claimed.id))?.liveExecutionId).toBe(claimed.liveExecutionId);
  });

  it("CLAIMED + started does not execute and finalizes OUTCOME_UNKNOWN", async () => {
    const approved = await approveCreate();
    const claimed = await claimApprovalRequest(approved.id, {
      entityType: "RECORD",
      action: "CREATE",
      executorId: AGENT,
      artifactHash: ARTIFACT,
    });
    await markApprovalExecutionStarted(claimed.id, claimed.liveExecutionId as string);
    let runs = 0;
    const result = await runGovernedClaimedExecution({
      executorId: AGENT,
      actor,
      entityType: "RECORD",
      action: "CREATE",
      artifactHash: ARTIFACT,
      approvalRequestId: claimed.id,
      requestId: "req-started",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      routeLabel: "test.helper.started",
      executeOnce: async () => {
        runs += 1;
        return { kind: "SUCCESS", value: "ok" };
      },
    });
    expect(runs).toBe(0);
    expect(result.status).toBe("OUTCOME_UNKNOWN");
    expect((await getApprovalRequest(claimed.id))?.status).toBe("OUTCOME_UNKNOWN");
  });

  it("terminal FULFILLED / FAILED / UNKNOWN replay without executing", async () => {
    const fulfilled = await approveCreate();
    await runGovernedClaimedExecution({
      executorId: AGENT,
      actor,
      entityType: "RECORD",
      action: "CREATE",
      artifactHash: ARTIFACT,
      approvalRequestId: fulfilled.id,
      requestId: "req-f",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      routeLabel: "test.helper.term-f",
      executeOnce: async () => ({ kind: "SUCCESS", value: "ok", outputEvidence: "ok" }),
    });
    let runs = 0;
    const replayFulfilled = await runGovernedClaimedExecution({
      executorId: AGENT,
      actor,
      entityType: "RECORD",
      action: "CREATE",
      artifactHash: ARTIFACT,
      approvalRequestId: fulfilled.id,
      requestId: "req-f2",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      routeLabel: "test.helper.term-f2",
      executeOnce: async () => {
        runs += 1;
        return { kind: "SUCCESS", value: "nope" };
      },
    });
    expect(replayFulfilled.status).toBe("EXECUTED");
    expect(runs).toBe(0);

    const failed = await approveCreate();
    const claimedFail = await claimApprovalRequest(failed.id, {
      entityType: "RECORD",
      action: "CREATE",
      executorId: AGENT,
      artifactHash: ARTIFACT,
    });
    await runGovernedClaimedExecution({
      executorId: AGENT,
      actor,
      entityType: "RECORD",
      action: "CREATE",
      artifactHash: ARTIFACT,
      approvalRequestId: claimedFail.id,
      requestId: "req-fail",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      routeLabel: "test.helper.term-fail",
      executeOnce: async () => ({ kind: "FAILURE", reason: "boom" }),
    });
    const replayFailed = await runGovernedClaimedExecution({
      executorId: AGENT,
      actor,
      entityType: "RECORD",
      action: "CREATE",
      artifactHash: ARTIFACT,
      approvalRequestId: claimedFail.id,
      requestId: "req-fail2",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      routeLabel: "test.helper.term-fail2",
      executeOnce: async () => {
        runs += 1;
        return { kind: "SUCCESS", value: "nope" };
      },
    });
    expect(replayFailed.status).toBe("FAILED");
    expect(runs).toBe(0);

    const unknown = await approveCreate();
    const claimedUnknown = await claimApprovalRequest(unknown.id, {
      entityType: "RECORD",
      action: "CREATE",
      executorId: AGENT,
      artifactHash: ARTIFACT,
    });
    await markApprovalExecutionStarted(
      claimedUnknown.id,
      claimedUnknown.liveExecutionId as string,
    );
    const firstUnknown = await runGovernedClaimedExecution({
      executorId: AGENT,
      actor,
      entityType: "RECORD",
      action: "CREATE",
      artifactHash: ARTIFACT,
      approvalRequestId: claimedUnknown.id,
      requestId: "req-unk",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      routeLabel: "test.helper.term-unk",
      executeOnce: async () => {
        runs += 1;
        return { kind: "SUCCESS", value: "nope" };
      },
    });
    expect(firstUnknown.status).toBe("OUTCOME_UNKNOWN");
    const replayUnknown = await runGovernedClaimedExecution({
      executorId: AGENT,
      actor,
      entityType: "RECORD",
      action: "CREATE",
      artifactHash: ARTIFACT,
      approvalRequestId: claimedUnknown.id,
      requestId: "req-unk2",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      routeLabel: "test.helper.term-unk2",
      executeOnce: async () => {
        runs += 1;
        return { kind: "SUCCESS", value: "nope" };
      },
    });
    expect(replayUnknown.status).toBe("OUTCOME_UNKNOWN");
    expect(runs).toBe(0);
  });

  it("binding mismatches fail closed without executing", async () => {
    const approved = await approveCreate();
    let runs = 0;
    const executeOnce = async () => {
      runs += 1;
      return { kind: "SUCCESS" as const, value: "ok" };
    };
    const base = {
      executorId: AGENT,
      actor,
      artifactHash: ARTIFACT,
      approvalRequestId: approved.id,
      requestId: "req-mis",
      sourceContext: { origin: "user_message" as const, trustLevel: "trusted" as const },
      routeLabel: "test.helper.mismatch",
      executeOnce,
    };
    expect(
      (await runGovernedClaimedExecution({ ...base, entityType: "DOCUMENT", action: "CREATE" }))
        .status,
    ).toBe("DENIED");
    expect(
      (await runGovernedClaimedExecution({ ...base, entityType: "RECORD", action: "UPDATE" }))
        .status,
    ).toBe("DENIED");
    expect(
      (
        await runGovernedClaimedExecution({
          ...base,
          entityType: "RECORD",
          action: "CREATE",
          executorId: "other-agent",
          actor: { ...actor, agentId: "other-agent" },
        })
      ).status,
    ).toBe("DENIED");
    expect(
      (
        await runGovernedClaimedExecution({
          ...base,
          entityType: "RECORD",
          action: "CREATE",
          artifactHash: "b".repeat(64),
        })
      ).status,
    ).toBe("DENIED");
    expect(runs).toBe(0);
    expect((await getApprovalRequest(approved.id))?.status).toBe("APPROVED");

    const claimed = await claimApprovalRequest(approved.id, {
      entityType: "RECORD",
      action: "CREATE",
      executorId: AGENT,
      artifactHash: ARTIFACT,
    });
    const stolen = await runGovernedClaimedExecution({
      ...base,
      approvalRequestId: claimed.id,
      entityType: "RECORD",
      action: "CREATE",
      executorId: "other-agent",
      actor: { ...actor, agentId: "other-agent" },
    });
    expect(stolen.status).toBe("DENIED");
    expect(runs).toBe(0);
    expect((await getApprovalRequest(claimed.id))?.status).toBe("CLAIMED");
  });

  it("Policy DENIED after claim finalizes FAILED and does not execute", async () => {
    const approved = await approveCreate();
    let runs = 0;
    const result = await runGovernedClaimedExecution({
      executorId: AGENT,
      actor,
      entityType: "RECORD",
      action: "CREATE",
      artifactHash: ARTIFACT,
      approvalRequestId: approved.id,
      requestId: "req-deny",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      routeLabel: "test.helper.deny",
      agentRuntimeStatus: "PAUSED",
      executeOnce: async () => {
        runs += 1;
        return { kind: "SUCCESS", value: "ok" };
      },
    });
    expect(result.status).toBe("DENIED");
    expect(runs).toBe(0);
    expect((await getApprovalRequest(approved.id))?.status).toBe("FAILED");
  });

  it("HUMAN_ONLY after claim does not execute and finalizes the existing claim FAILED", async () => {
    const created = await createApprovalRequest({
      entityType: "RECORD",
      action: "DELETE",
      requestedBy: AGENT,
      reason: "human-only",
      artifactHash: ARTIFACT,
    });
    const approved = await decideApprovalRequest(created.id, {
      decidedBy: USER,
      approve: true,
      decisionReason: "ok",
    });
    let runs = 0;
    const result = await runGovernedClaimedExecution({
      executorId: AGENT,
      actor,
      entityType: "RECORD",
      action: "DELETE",
      artifactHash: ARTIFACT,
      approvalRequestId: approved.id,
      requestId: "req-ho",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      routeLabel: "test.helper.human-only",
      executeOnce: async () => {
        runs += 1;
        return { kind: "SUCCESS", value: "ok" };
      },
    });
    expect(result.status).toBe("APPROVAL_REQUIRED");
    expect(runs).toBe(0);
    expect((await getApprovalRequest(approved.id))?.status).toBe("FAILED");
  });

  it("callback throw is known FAILED", async () => {
    const approved = await approveCreate();
    const result = await runGovernedClaimedExecution({
      executorId: AGENT,
      actor,
      entityType: "RECORD",
      action: "CREATE",
      artifactHash: ARTIFACT,
      approvalRequestId: approved.id,
      requestId: "req-throw",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      routeLabel: "test.helper.throw",
      executeOnce: async () => {
        throw new Error("tool exploded");
      },
    });
    expect(result.status).toBe("FAILED");
    expect(result.status === "FAILED" && result.reason).toMatch(/tool exploded/);
    expect((await getApprovalRequest(approved.id))?.status).toBe("FAILED");
  });

  it("mark-started failure does not execute and finalizes FAILED", async () => {
    const approved = await approveCreate();
    const approvals = await import("./approvals.js");
    vi.spyOn(approvals, "markApprovalExecutionStarted").mockRejectedValue(new Error("mark down"));
    let runs = 0;
    const result = await runGovernedClaimedExecution({
      executorId: AGENT,
      actor,
      entityType: "RECORD",
      action: "CREATE",
      artifactHash: ARTIFACT,
      approvalRequestId: approved.id,
      requestId: "req-mark",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      routeLabel: "test.helper.mark",
      executeOnce: async () => {
        runs += 1;
        return { kind: "SUCCESS", value: "ok" };
      },
    });
    expect(runs).toBe(0);
    expect(result.status === "FAILED" || result.status === "FINALIZE_INCOMPLETE").toBe(true);
  });

  it("finalize failure never reports success", async () => {
    const approved = await approveCreate();
    const approvals = await import("./approvals.js");
    vi.spyOn(approvals, "finalizeApprovalRequest").mockRejectedValue(new Error("finalize down"));
    const result = await runGovernedClaimedExecution({
      executorId: AGENT,
      actor,
      entityType: "RECORD",
      action: "CREATE",
      artifactHash: ARTIFACT,
      approvalRequestId: approved.id,
      requestId: "req-fin",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      routeLabel: "test.helper.fin",
      executeOnce: async () => ({ kind: "SUCCESS", value: "ok", outputEvidence: "ok" }),
    });
    expect(result.status).toBe("FINALIZE_INCOMPLETE");
    expect(result.status === "FINALIZE_INCOMPLETE" && result.intendedOutcome).toBe("FULFILLED");
  });

  it("two concurrent attempts execute the same liveExecutionId at most once", async () => {
    const approved = await approveCreate();
    let runs = 0;
    const start = () =>
      runGovernedClaimedExecution({
        executorId: AGENT,
        actor,
        entityType: "RECORD",
        action: "CREATE",
        artifactHash: ARTIFACT,
        approvalRequestId: approved.id,
        requestId: "req-race",
        sourceContext: { origin: "user_message", trustLevel: "trusted" },
        routeLabel: "test.helper.race",
        executeOnce: async () => {
          runs += 1;
          return { kind: "SUCCESS", value: "ok", outputEvidence: "ok" };
        },
      });
    const [a, b] = await Promise.all([start(), start()]);
    expect(runs).toBe(1);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toContain("EXECUTED");
    expect(runs).toBeLessThanOrEqual(1);
  });
});

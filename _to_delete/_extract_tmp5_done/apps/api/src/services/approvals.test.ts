import { afterEach, beforeEach, describe, expect, it } from "vitest";

process.env.ATLAS_SKIP_AUDIT_LOG = "1";

const {
  consumeApprovalRequest,
  createApprovalRequest,
  decideApprovalRequest,
  getApprovalRequest,
  listApprovalRequests,
  resetApprovalsForTests,
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

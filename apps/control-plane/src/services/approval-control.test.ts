import { describe, expect, it } from "vitest";
import { toObservationalApprovalRecord } from "./approval-control.js";

describe("toObservationalApprovalRecord", () => {
  it("maps a canonical live approval onto the Control observational shape", () => {
    const mapped = toObservationalApprovalRecord({
      id: "11111111-1111-4111-8111-111111111111",
      entityType: "CONFIGURATION",
      action: "EXECUTE",
      requestedBy: "user-1",
      requestedAt: "2026-01-01T00:00:00.000Z",
      status: "PENDING",
      decidedBy: null,
      expiresAt: "2026-01-01T01:00:00.000Z",
      artifactHash: "abc",
      context: { agentId: "CODE_ENGINEER" },
    });
    expect(mapped).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      agentId: "CODE_ENGINEER",
      entityType: "CONFIGURATION",
      action: "EXECUTE",
      status: "PENDING",
      artifactHash: "abc",
    });
  });

  it("maps REJECTED to DENIED for the observational health counters", () => {
    const mapped = toObservationalApprovalRecord({
      id: "11111111-1111-4111-8111-111111111111",
      entityType: "CONFIGURATION",
      action: "EXECUTE",
      requestedBy: "user-1",
      requestedAt: "2026-01-01T00:00:00.000Z",
      status: "REJECTED",
    });
    expect(mapped?.status).toBe("DENIED");
  });

  it("rejects a malformed payload rather than inventing a record", () => {
    expect(toObservationalApprovalRecord({ status: "PENDING" })).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  APPLICATION_PREFLIGHT_SCHEMA,
  applicationPreflightAllowsExecution,
  applicationPreflightRequestSchema,
  httpStatusForPreflightDecision,
  unavailablePolicyForClass,
} from "./application-preflight.js";

describe("application preflight contract", () => {
  it("only ALLOW may execute", () => {
    expect(applicationPreflightAllowsExecution("ALLOW")).toBe(true);
    expect(applicationPreflightAllowsExecution("DENY")).toBe(false);
    expect(applicationPreflightAllowsExecution("REQUIRE_APPROVAL")).toBe(false);
    expect(applicationPreflightAllowsExecution("KILLED")).toBe(false);
    expect(applicationPreflightAllowsExecution("INVALID")).toBe(false);
    expect(applicationPreflightAllowsExecution("OUT_OF_SCOPE")).toBe(false);
  });

  it("fail-closes high-risk and tool actions when Atlas is down", () => {
    expect(unavailablePolicyForClass("HIGH_RISK")).toBe("FAIL_CLOSED");
    expect(unavailablePolicyForClass("TOOL_ACTION")).toBe("FAIL_CLOSED");
    expect(unavailablePolicyForClass("INFORMATIONAL")).toBe("FAIL_OPEN");
    expect(unavailablePolicyForClass("GOVERNED_DECISION")).toBe("FAIL_OPEN");
  });

  it("maps REQUIRE_APPROVAL to HTTP 202 pending", () => {
    expect(httpStatusForPreflightDecision("REQUIRE_APPROVAL")).toBe(202);
    expect(httpStatusForPreflightDecision("ALLOW")).toBe(200);
  });

  it("rejects a forged schema version", () => {
    const parsed = applicationPreflightRequestSchema.safeParse({
      schemaVersion: "not-the-contract",
      applicationId: "civio",
      tenantId: "t",
      projectId: "p",
      actorId: "u",
      actorKind: "USER",
      operation: "civio.legal.query",
      operationClass: "GOVERNED_DECISION",
      requestId: "r1",
      idempotencyKey: "i1",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a complete request", () => {
    const parsed = applicationPreflightRequestSchema.parse({
      schemaVersion: APPLICATION_PREFLIGHT_SCHEMA,
      applicationId: "civio",
      tenantId: "tenant-a",
      projectId: "project-a",
      actorId: "user-1",
      actorKind: "USER",
      operation: "civio.legal.query",
      operationClass: "GOVERNED_DECISION",
      requestId: "req-1",
      idempotencyKey: "idem-1",
    });
    expect(parsed.applicationId).toBe("civio");
  });
});

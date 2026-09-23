import { describe, expect, it } from "vitest";
import {
  APPLICATION_PREFLIGHT_COMPLETION_PATHS,
  APPLICATION_PREFLIGHT_OPERATION_CLASSES,
  APPLICATION_PREFLIGHT_SCHEMA,
  applicationDeclaredCompletionPath,
  applicationOwnedAgentId,
  applicationPreflightAllowsExecution,
  applicationPreflightRequestSchema,
  applicationPreflightResponseSchema,
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

  it("CTRL-013: unavailablePolicyForClass covers only the four existing operation classes", () => {
    const failClosed = new Set(["HIGH_RISK", "TOOL_ACTION"]);
    expect(APPLICATION_PREFLIGHT_OPERATION_CLASSES).toEqual([
      "INFORMATIONAL",
      "GOVERNED_DECISION",
      "TOOL_ACTION",
      "HIGH_RISK",
    ]);
    for (const operationClass of APPLICATION_PREFLIGHT_OPERATION_CLASSES) {
      expect(unavailablePolicyForClass(operationClass)).toBe(
        failClosed.has(operationClass) ? "FAIL_CLOSED" : "FAIL_OPEN",
      );
    }
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
    expect(parsed.agentId).toBeUndefined();
    expect(parsed.declaredCompletionPath).toBeUndefined();
  });

  it("accepts an explicit application-owned agentId and records omitted as absent", () => {
    const withAgent = applicationPreflightRequestSchema.parse({
      schemaVersion: APPLICATION_PREFLIGHT_SCHEMA,
      applicationId: "hotelos",
      tenantId: "tenant-a",
      projectId: "project-a",
      actorId: "user-1",
      actorKind: "USER",
      agentId: "agent.cio",
      operation: "hotelos.gateway.agent.cio",
      operationClass: "GOVERNED_DECISION",
      requestId: "req-cio",
      idempotencyKey: "idem-cio",
    });
    expect(withAgent.agentId).toBe("agent.cio");
    expect(applicationOwnedAgentId(withAgent.agentId)).toBe("agent.cio");

    const legacy = applicationPreflightRequestSchema.parse({
      schemaVersion: APPLICATION_PREFLIGHT_SCHEMA,
      applicationId: "caseflow",
      tenantId: "tenant-a",
      projectId: "project-a",
      actorId: "caseflow-runtime",
      actorKind: "USER",
      agentId: null,
      operation: "caseflow.openai.chat",
      operationClass: "GOVERNED_DECISION",
      requestId: "req-cf",
      idempotencyKey: "idem-cf",
    });
    expect(legacy.agentId).toBeNull();
    expect(applicationOwnedAgentId(legacy.agentId)).toBeNull();
    expect(applicationOwnedAgentId(undefined)).toBeNull();
  });

  it("rejects an empty agentId string rather than treating it as a real identity", () => {
    const parsed = applicationPreflightRequestSchema.safeParse({
      schemaVersion: APPLICATION_PREFLIGHT_SCHEMA,
      applicationId: "hotelos",
      tenantId: "tenant-a",
      projectId: "project-a",
      actorId: "user-1",
      actorKind: "USER",
      agentId: "",
      operation: "hotelos.gateway.agent.cio",
      operationClass: "GOVERNED_DECISION",
      requestId: "req-empty",
      idempotencyKey: "idem-empty",
    });
    expect(parsed.success).toBe(false);
  });

  it("requires agentId on the response so absence is explicit null", () => {
    const parsed = applicationPreflightResponseSchema.parse({
      schemaVersion: APPLICATION_PREFLIGHT_SCHEMA,
      decision: "ALLOW",
      executed: false,
      reason: "allowed",
      requestId: "req-1",
      applicationId: "hotelos",
      agentId: null,
      tenantId: "tenant-a",
      projectId: "project-a",
      operation: "hotelos.gateway.embed",
      operationClass: "INFORMATIONAL",
      unavailablePolicy: "FAIL_OPEN",
      approvalRequestId: null,
      killSwitchCategory: null,
      decisionId: "decision-1",
      declaredCompletionPath: null,
    });
    expect(parsed.agentId).toBeNull();
    expect(parsed.declaredCompletionPath).toBeNull();

    const legacyResponse = applicationPreflightResponseSchema.parse({
      schemaVersion: APPLICATION_PREFLIGHT_SCHEMA,
      decision: "ALLOW",
      executed: false,
      reason: "allowed",
      requestId: "req-legacy",
      applicationId: "hotelos",
      agentId: null,
      tenantId: "tenant-a",
      projectId: "project-a",
      operation: "hotelos.gateway.embed",
      operationClass: "INFORMATIONAL",
      unavailablePolicy: "FAIL_OPEN",
      approvalRequestId: null,
      killSwitchCategory: null,
      decisionId: "decision-legacy",
    });
    expect(legacyResponse.declaredCompletionPath).toBeUndefined();
  });

  it("CTRL-016: accepts LOCAL_COMPLETION_PATH and MODEL_PATH and rejects unknown paths", () => {
    expect(APPLICATION_PREFLIGHT_COMPLETION_PATHS).toEqual([
      "LOCAL_COMPLETION_PATH",
      "MODEL_PATH",
    ]);
    const local = applicationPreflightRequestSchema.parse({
      schemaVersion: APPLICATION_PREFLIGHT_SCHEMA,
      applicationId: "caseflow",
      tenantId: "tenant-a",
      projectId: "project-a",
      actorId: "caseflow-runtime",
      actorKind: "USER",
      operation: "caseflow.openai.chat",
      operationClass: "GOVERNED_DECISION",
      declaredCompletionPath: "LOCAL_COMPLETION_PATH",
      requestId: "req-local",
      idempotencyKey: "idem-local",
    });
    expect(local.declaredCompletionPath).toBe("LOCAL_COMPLETION_PATH");
    expect(applicationDeclaredCompletionPath(local.declaredCompletionPath)).toBe(
      "LOCAL_COMPLETION_PATH",
    );

    const model = applicationPreflightRequestSchema.parse({
      schemaVersion: APPLICATION_PREFLIGHT_SCHEMA,
      applicationId: "caseflow",
      tenantId: "tenant-a",
      projectId: "project-a",
      actorId: "caseflow-runtime",
      actorKind: "USER",
      operation: "caseflow.openai.chat",
      operationClass: "GOVERNED_DECISION",
      declaredCompletionPath: "MODEL_PATH",
      requestId: "req-model",
      idempotencyKey: "idem-model",
    });
    expect(model.declaredCompletionPath).toBe("MODEL_PATH");

    const explicitNull = applicationPreflightRequestSchema.parse({
      schemaVersion: APPLICATION_PREFLIGHT_SCHEMA,
      applicationId: "caseflow",
      tenantId: "tenant-a",
      projectId: "project-a",
      actorId: "caseflow-runtime",
      actorKind: "USER",
      operation: "caseflow.openai.chat",
      operationClass: "GOVERNED_DECISION",
      declaredCompletionPath: null,
      requestId: "req-null-path",
      idempotencyKey: "idem-null-path",
    });
    expect(explicitNull.declaredCompletionPath).toBeNull();
    expect(applicationDeclaredCompletionPath(undefined)).toBeNull();
    expect(applicationDeclaredCompletionPath(null)).toBeNull();

    const unknown = applicationPreflightRequestSchema.safeParse({
      schemaVersion: APPLICATION_PREFLIGHT_SCHEMA,
      applicationId: "caseflow",
      tenantId: "tenant-a",
      projectId: "project-a",
      actorId: "caseflow-runtime",
      actorKind: "USER",
      operation: "caseflow.openai.chat",
      operationClass: "GOVERNED_DECISION",
      declaredCompletionPath: "UNNECESSARY",
      requestId: "req-unknown",
      idempotencyKey: "idem-unknown",
    });
    expect(unknown.success).toBe(false);
  });

  it("CTRL-016: response echo is not execution, sufficiency, or UNNECESSARY", () => {
    const parsed = applicationPreflightResponseSchema.parse({
      schemaVersion: APPLICATION_PREFLIGHT_SCHEMA,
      decision: "ALLOW",
      executed: false,
      reason: "allowed",
      requestId: "req-1",
      applicationId: "caseflow",
      agentId: null,
      tenantId: "tenant-a",
      projectId: "project-a",
      operation: "caseflow.openai.chat",
      operationClass: "GOVERNED_DECISION",
      unavailablePolicy: "FAIL_OPEN",
      approvalRequestId: null,
      killSwitchCategory: null,
      decisionId: "decision-1",
      declaredCompletionPath: "LOCAL_COMPLETION_PATH",
    });
    expect(parsed.executed).toBe(false);
    expect(parsed.declaredCompletionPath).toBe("LOCAL_COMPLETION_PATH");
    expect(parsed).not.toHaveProperty("knowledgeSufficient");
    expect(parsed).not.toHaveProperty("UNNECESSARY");
    expect(parsed).not.toHaveProperty("executionId");
    expect(parsed).not.toHaveProperty("outcomeStatus");
    expect(parsed).not.toHaveProperty("resultStatus");
    expect(parsed).not.toHaveProperty("proposedPath");
  });
});

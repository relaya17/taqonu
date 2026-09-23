import { describe, expect, it } from "vitest";
import {
  APPLICATION_EXECUTION_REPORT_PATH,
  APPLICATION_EXECUTION_REPORT_SCHEMA,
  APPLICATION_PREFLIGHT_SCHEMA,
  applicationExecutionReportRequestSchema,
  applicationExecutionReportResponseSchema,
  applicationPreflightRequestSchema,
} from "../index.js";

describe("application execution report contract", () => {
  it("uses a schema and path separate from preflight", () => {
    expect(APPLICATION_EXECUTION_REPORT_SCHEMA).toBe(
      "atlas.application-execution-report.v1",
    );
    expect(APPLICATION_EXECUTION_REPORT_PATH).toBe(
      "/api/v1/governance/application-execution-report",
    );
    expect(APPLICATION_EXECUTION_REPORT_SCHEMA).not.toBe(
      APPLICATION_PREFLIGHT_SCHEMA,
    );
  });

  it("accepts the minimum truthful report fields", () => {
    const parsed = applicationExecutionReportRequestSchema.parse({
      schemaVersion: APPLICATION_EXECUTION_REPORT_SCHEMA,
      applicationId: "caseflow",
      tenantId: "tenant-a",
      projectId: "project-a",
      decisionId: "dec-1",
      requestId: "req-1",
      operation: "caseflow.openai.chat",
      executionId: "chatcmpl-abc123",
      executionStatus: "SUCCESS",
    });
    expect(parsed.executionId).toBe("chatcmpl-abc123");
    expect(parsed.executionStatus).toBe("SUCCESS");
    expect(parsed.agentId).toBeUndefined();
    expect(parsed).not.toHaveProperty("actualCost");
    expect(parsed).not.toHaveProperty("tokens");
    expect(parsed).not.toHaveProperty("provider");
    expect(parsed).not.toHaveProperty("currency");
    expect(parsed).not.toHaveProperty("modelCallCount");
  });

  it("accepts optional attribution only when the application supplies real values", () => {
    const parsed = applicationExecutionReportRequestSchema.parse({
      schemaVersion: APPLICATION_EXECUTION_REPORT_SCHEMA,
      applicationId: "caseflow",
      tenantId: "tenant-a",
      projectId: "project-a",
      decisionId: "dec-1",
      requestId: "req-1",
      operation: "caseflow.openai.chat",
      executionId: "chatcmpl-abc123",
      executionStatus: "SUCCESS",
      provider: "openai",
      model: "gpt-4.1",
      tokens: { prompt: 12, completion: 4 },
      modelCallCount: 1,
      retries: 0,
      declaredCompletionPath: "MODEL_PATH",
      actualCost: 0.0021,
      currency: "USD",
    });
    expect(parsed.provider).toBe("openai");
    expect(parsed.tokens).toEqual({ prompt: 12, completion: 4 });
    expect(parsed.actualCost).toBe(0.0021);
    expect(parsed.declaredCompletionPath).toBe("MODEL_PATH");
    expect(parsed.retries).toBe(0);
  });

  it("rejects malformed optional attribution without inventing replacements", () => {
    const base = {
      schemaVersion: APPLICATION_EXECUTION_REPORT_SCHEMA,
      applicationId: "caseflow",
      tenantId: "tenant-a",
      projectId: "project-a",
      decisionId: "dec-1",
      requestId: "req-1",
      operation: "caseflow.openai.chat",
      executionId: "chatcmpl-abc123",
      executionStatus: "SUCCESS",
    };
    expect(
      applicationExecutionReportRequestSchema.safeParse({
        ...base,
        actualCost: -1,
      }).success,
    ).toBe(false);
    expect(
      applicationExecutionReportRequestSchema.safeParse({
        ...base,
        tokens: -4,
      }).success,
    ).toBe(false);
    expect(
      applicationExecutionReportRequestSchema.safeParse({
        ...base,
        tokens: {},
      }).success,
    ).toBe(false);
    expect(
      applicationExecutionReportRequestSchema.safeParse({
        ...base,
        declaredCompletionPath: "UNNECESSARY",
      }).success,
    ).toBe(false);
    expect(
      applicationExecutionReportRequestSchema.safeParse({
        ...base,
        currency: "12",
      }).success,
    ).toBe(false);
  });

  it("accepts FAILURE and a null agentId", () => {
    const parsed = applicationExecutionReportRequestSchema.parse({
      schemaVersion: APPLICATION_EXECUTION_REPORT_SCHEMA,
      applicationId: "caseflow",
      tenantId: "tenant-a",
      projectId: "project-a",
      decisionId: "dec-1",
      requestId: "req-1",
      operation: "caseflow.openai.chat",
      executionId: "chatcmpl-fail-1",
      executionStatus: "FAILURE",
      agentId: null,
    });
    expect(parsed.executionStatus).toBe("FAILURE");
    expect(parsed.agentId).toBeNull();
  });

  it("rejects missing executionId, missing status, and invented outcomes", () => {
    const base = {
      schemaVersion: APPLICATION_EXECUTION_REPORT_SCHEMA,
      applicationId: "caseflow",
      tenantId: "tenant-a",
      projectId: "project-a",
      decisionId: "dec-1",
      requestId: "req-1",
      operation: "caseflow.openai.chat",
      executionId: "chatcmpl-abc123",
      executionStatus: "SUCCESS",
    };
    expect(
      applicationExecutionReportRequestSchema.safeParse({
        ...base,
        executionId: "",
      }).success,
    ).toBe(false);
    expect(
      applicationExecutionReportRequestSchema.safeParse({
        schemaVersion: APPLICATION_EXECUTION_REPORT_SCHEMA,
        applicationId: "caseflow",
        tenantId: "tenant-a",
        projectId: "project-a",
        decisionId: "dec-1",
        requestId: "req-1",
        operation: "caseflow.openai.chat",
        executionId: "chatcmpl-abc123",
      }).success,
    ).toBe(false);
    expect(
      applicationExecutionReportRequestSchema.safeParse({
        ...base,
        executionStatus: "ALLOW",
      }).success,
    ).toBe(false);
  });

  it("does not add execution fields to the preflight request schema", () => {
    const parsed = applicationPreflightRequestSchema.parse({
      schemaVersion: APPLICATION_PREFLIGHT_SCHEMA,
      applicationId: "caseflow",
      tenantId: "tenant-a",
      projectId: "project-a",
      actorId: "caseflow-runtime",
      actorKind: "USER",
      operation: "caseflow.openai.chat",
      operationClass: "GOVERNED_DECISION",
      requestId: "req-1",
      idempotencyKey: "idem-1",
    });
    expect(parsed).not.toHaveProperty("executionId");
    expect(parsed).not.toHaveProperty("executionStatus");
  });

  it("parses an accepted report response", () => {
    const parsed = applicationExecutionReportResponseSchema.parse({
      schemaVersion: APPLICATION_EXECUTION_REPORT_SCHEMA,
      accepted: true,
      reason: "Execution report correlated to a preceding ALLOW",
      decisionId: "dec-1",
      requestId: "req-1",
      executionId: "chatcmpl-abc123",
      executionStatus: "SUCCESS",
      applicationId: "caseflow",
      agentId: null,
    });
    expect(parsed.accepted).toBe(true);
    expect(parsed.executionStatus).toBe("SUCCESS");
  });
});

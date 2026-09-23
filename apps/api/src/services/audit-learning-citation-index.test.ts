import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  APPLICATION_LEARNING_PROPOSAL_SCHEMA,
} from "@atlas/shared";
import {
  appendUnifiedAuditEntry,
  getAuditQueryIndexStatsForTests,
  listIndexedUnifiedByType,
  lookupIndexedFailureCitation,
  setAuditLogPathForTests,
} from "./audit-log.js";
import { createApplicationLearningProposal } from "./application-learning-proposal.js";

function writeFailure(input: {
  decisionId: string;
  executionId: string;
  requestId: string;
  applicationId?: string;
  tenantId?: string;
  projectId?: string;
  operation?: string;
  agentId?: string | null;
}): void {
  appendUnifiedAuditEntry({
    type: "application.execution.reported",
    entityType: "application_execution_report",
    action: input.operation ?? "caseflow.openai.chat",
    actorId: "caseflow:connector",
    actorKind: "SYSTEM",
    agentId: input.agentId ?? null,
    reason: "Application reported an execution correlated to a preceding ALLOW",
    policy: "atlas.application-execution-report.v1",
    risk: "LOW",
    approval: "NOT_REQUIRED",
    decision: "ALLOW",
    input: {
      auditType: "application.execution.reported",
      decisionId: input.decisionId,
      requestId: input.requestId,
      executionId: input.executionId,
      executionStatus: "FAILURE",
      applicationId: input.applicationId ?? "caseflow",
      tenantId: input.tenantId ?? "tenant-a",
      projectId: input.projectId ?? "project-a",
      operation: input.operation ?? "caseflow.openai.chat",
      agentId: input.agentId ?? null,
    },
    output: {
      accepted: true,
      executionStatus: "FAILURE",
      decisionId: input.decisionId,
      executionId: input.executionId,
    },
    result: "SUCCESS",
    verificationVerdict: "NOT_APPLICABLE",
  });
}

describe("R09 learning citation index", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(
      tmpdir(),
      `atlas-cite-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    mkdirSync(dir, { recursive: true });
    setAuditLogPathForTests(join(dir, "audit.ndjson"));
  });

  afterEach(() => {
    setAuditLogPathForTests(null);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("indexes FAILURE reports by decisionId:executionId and ignores SUCCESS", () => {
    writeFailure({
      decisionId: "dec-1",
      executionId: "exec-1",
      requestId: "req-1",
    });
    appendUnifiedAuditEntry({
      type: "application.execution.reported",
      actorId: "caseflow:connector",
      actorKind: "SYSTEM",
      reason: "success is not a citation",
      risk: "LOW",
      approval: "NOT_REQUIRED",
      decision: "ALLOW",
      input: {
        decisionId: "dec-ok",
        executionId: "exec-ok",
        requestId: "req-ok",
        executionStatus: "SUCCESS",
        applicationId: "caseflow",
        tenantId: "tenant-a",
        projectId: "project-a",
        operation: "caseflow.openai.chat",
      },
      output: { executionStatus: "SUCCESS" },
      result: "SUCCESS",
    });
    const found = lookupIndexedFailureCitation("dec-1", "exec-1");
    expect(found?.applicationId).toBe("caseflow");
    expect(found?.tenantId).toBe("tenant-a");
    expect(lookupIndexedFailureCitation("dec-ok", "exec-ok")).toBeNull();
    expect(getAuditQueryIndexStatsForTests().failureCount).toBe(1);
  });

  it("does not treat a same-key citation from another tenant as authoritative", () => {
    writeFailure({
      decisionId: "dec-1",
      executionId: "exec-1",
      requestId: "req-1",
      tenantId: "tenant-a",
    });
    const result = createApplicationLearningProposal({
      rawBody: {
        schemaVersion: APPLICATION_LEARNING_PROPOSAL_SCHEMA,
        recommendation: "must stay isolated",
        citations: [
          {
            auditType: "application.execution.reported",
            decisionId: "dec-1",
            requestId: "req-1",
            executionId: "exec-1",
            executionStatus: "FAILURE",
            applicationId: "caseflow",
            tenantId: "tenant-b",
            projectId: "project-a",
            operation: "caseflow.openai.chat",
          },
          {
            auditType: "application.execution.reported",
            decisionId: "dec-2",
            requestId: "req-2",
            executionId: "exec-2",
            executionStatus: "FAILURE",
            applicationId: "caseflow",
            tenantId: "tenant-b",
            projectId: "project-a",
            operation: "caseflow.openai.chat",
          },
        ],
      },
    });
    expect(result.status).toBe(400);
  });

  it("lookup stays O(1) after noise rows are already indexed", () => {
    for (let i = 0; i < 80; i += 1) {
      appendUnifiedAuditEntry({
        type: "patch.applied",
        actorId: "noise",
        actorKind: "USER",
        reason: `noise-${i}`,
        risk: "LOW",
        approval: "NOT_REQUIRED",
        result: "SUCCESS",
      });
    }
    writeFailure({
      decisionId: "dec-1",
      executionId: "exec-1",
      requestId: "req-1",
    });
    writeFailure({
      decisionId: "dec-2",
      executionId: "exec-2",
      requestId: "req-2",
    });
    lookupIndexedFailureCitation("dec-1", "exec-1");
    const afterWarm = getAuditQueryIndexStatsForTests();
    expect(afterWarm.failureCount).toBe(2);
    const parsed = afterWarm.linesParsed;
    expect(lookupIndexedFailureCitation("dec-2", "exec-2")?.executionId).toBe(
      "exec-2",
    );
    expect(lookupIndexedFailureCitation("missing", "nope")).toBeNull();
    expect(getAuditQueryIndexStatsForTests().linesParsed).toBe(parsed);
    expect(listIndexedUnifiedByType("application.execution.reported")).toHaveLength(
      2,
    );
  });
});

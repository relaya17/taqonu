import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  APPLICATION_LEARNING_PROPOSAL_CREATED_AUDIT,
  APPLICATION_LEARNING_PROPOSAL_DECIDED_AUDIT,
  APPLICATION_LEARNING_PROPOSAL_SCHEMA,
  CONTROL_PLANE_SERVICE_ID,
} from "@atlas/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-learning-proposal-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
delete process.env.ATLAS_SKIP_AUDIT_LOG;

const { appendUnifiedAuditEntry, listUnifiedAuditEntries, setAuditLogPathForTests } =
  await import("./audit-log.js");
const {
  createApplicationLearningProposal,
  decideApplicationLearningProposal,
  getApplicationLearningProposal,
} = await import("./application-learning-proposal.js");
const approvals = await import("./approvals.js");

function citation(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    auditType: "application.execution.reported",
    decisionId: "dec-1",
    requestId: "req-1",
    executionId: "exec-1",
    executionStatus: "FAILURE",
    applicationId: "caseflow",
    tenantId: "tenant-a",
    projectId: "project-a",
    operation: "caseflow.openai.chat",
    ...overrides,
  };
}

function writeFailureAudit(
  overrides: Record<string, unknown> = {},
  agentId: string | null = null,
): void {
  const input = citation(overrides);
  appendUnifiedAuditEntry({
    type: "application.execution.reported",
    entityType: "application_execution_report",
    action: String(input.operation),
    actorId: `${String(input.applicationId)}:connector`,
    actorKind: "SYSTEM",
    agentId,
    reason: "Application reported an execution correlated to a preceding ALLOW",
    policy: "atlas.application-execution-report.v1",
    risk: "LOW",
    approval: "NOT_REQUIRED",
    approvalId: null,
    decision: "ALLOW",
    input: { ...input, agentId },
    output: {
      accepted: true,
      decisionId: input.decisionId,
      requestId: input.requestId,
      executionId: input.executionId,
      executionStatus: input.executionStatus,
    },
    result: "SUCCESS",
    verificationVerdict: "NOT_APPLICABLE",
  });
}

function createBody(citations: Record<string, unknown>[]) {
  return {
    schemaVersion: APPLICATION_LEARNING_PROPOSAL_SCHEMA,
    citations,
    recommendation: "Review repeated execution FAILURE reports in this scope.",
  };
}

describe("application learning proposal service", () => {
  beforeEach(() => {
    setAuditLogPathForTests(join(tmpDir, `audit-${Date.now()}-${Math.random()}.ndjson`));
  });

  afterEach(() => {
    setAuditLogPathForTests(null);
    vi.restoreAllMocks();
  });

  it("rejects a single FAILURE as repeated", () => {
    writeFailureAudit();
    const result = createApplicationLearningProposal({
      rawBody: createBody([citation()]),
    });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({
      error: "A single FAILURE cannot be described as repeated",
    });
  });

  it("rejects two copies of the same decisionId+executionId as one FAILURE", () => {
    writeFailureAudit();
    const result = createApplicationLearningProposal({
      rawBody: createBody([
        citation(),
        citation({ requestId: "req-other" }),
      ]),
    });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({
      error: "A single FAILURE cannot be described as repeated",
    });
  });

  it("creates a proposal from multiple FAILURE audits in the same scope", () => {
    writeFailureAudit();
    writeFailureAudit({
      decisionId: "dec-2",
      requestId: "req-2",
      executionId: "exec-2",
    });
    const createApproval = vi.spyOn(approvals, "createApprovalRequest");
    const result = createApplicationLearningProposal({
      rawBody: createBody([
        citation(),
        citation({ decisionId: "dec-2", requestId: "req-2", executionId: "exec-2" }),
      ]),
    });
    expect(result.status).toBe(201);
    if ("error" in result.body) throw new Error(result.body.error);
    expect(result.body.requestedBy).toBe(CONTROL_PLANE_SERVICE_ID);
    expect(result.body.state).toBe("PENDING");
    expect(result.body.autoApply).toBe(false);
    expect(result.body.executes).toBe(false);
    expect(result.body.mutatesGovernance).toBe(false);
    expect(result.body.mutatesMemory).toBe(false);
    expect(result.body.mutatesKnowledge).toBe(false);
    expect(result.body.agentId).toBeNull();
    expect(result.body.citedReports).toHaveLength(2);
    expect(createApproval).not.toHaveBeenCalled();
  });

  it("rejects mixed application, tenant, project, or operation", () => {
    writeFailureAudit();
    writeFailureAudit({
      decisionId: "dec-2",
      requestId: "req-2",
      executionId: "exec-2",
      applicationId: "civio",
    });
    expect(
      createApplicationLearningProposal({
        rawBody: createBody([
          citation(),
          citation({
            decisionId: "dec-2",
            requestId: "req-2",
            executionId: "exec-2",
            applicationId: "civio",
          }),
        ]),
      }).status,
    ).toBe(400);

    expect(
      createApplicationLearningProposal({
        rawBody: createBody([
          citation(),
          citation({ tenantId: "other-tenant", decisionId: "dec-2", executionId: "exec-2", requestId: "req-2" }),
        ]),
      }).status,
    ).toBe(400);

    expect(
      createApplicationLearningProposal({
        rawBody: createBody([
          citation(),
          citation({ projectId: "other-project", decisionId: "dec-2", executionId: "exec-2", requestId: "req-2" }),
        ]),
      }).status,
    ).toBe(400);

    expect(
      createApplicationLearningProposal({
        rawBody: createBody([
          citation(),
          citation({ operation: "other.op", decisionId: "dec-2", executionId: "exec-2", requestId: "req-2" }),
        ]),
      }).status,
    ).toBe(400);
  });

  it("rejects SUCCESS reports and citations that are not in audit", () => {
    appendUnifiedAuditEntry({
      type: "application.execution.reported",
      entityType: "application_execution_report",
      action: "caseflow.openai.chat",
      actorId: "caseflow:connector",
      actorKind: "SYSTEM",
      agentId: null,
      reason: "accepted",
      policy: "atlas.application-execution-report.v1",
      risk: "LOW",
      approval: "NOT_REQUIRED",
      decision: "ALLOW",
      input: citation({ executionStatus: "SUCCESS" }),
      output: { accepted: true, executionStatus: "SUCCESS" },
      result: "SUCCESS",
      verificationVerdict: "NOT_APPLICABLE",
    });
    writeFailureAudit({ decisionId: "dec-2", requestId: "req-2", executionId: "exec-2" });
    const missing = createApplicationLearningProposal({
      rawBody: createBody([
        citation(),
        citation({ decisionId: "dec-2", requestId: "req-2", executionId: "exec-2" }),
      ]),
    });
    expect(missing.status).toBe(400);
  });

  it("does not treat process-local absence as evidence when audit is missing", () => {
    const result = createApplicationLearningProposal({
      rawBody: createBody([
        citation(),
        citation({ decisionId: "dec-2", requestId: "req-2", executionId: "exec-2" }),
      ]),
    });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({
      error:
        "Each citation must match an authoritative application.execution.reported FAILURE audit",
    });
  });

  it("preserves null agentId and does not invent one", () => {
    writeFailureAudit({}, null);
    writeFailureAudit(
      { decisionId: "dec-2", requestId: "req-2", executionId: "exec-2" },
      null,
    );
    const result = createApplicationLearningProposal({
      rawBody: createBody([
        citation(),
        citation({ decisionId: "dec-2", requestId: "req-2", executionId: "exec-2" }),
      ]),
    });
    expect(result.status).toBe(201);
    if ("error" in result.body) throw new Error(result.body.error);
    expect(result.body.agentId).toBeNull();
  });

  it("returns the existing proposal for the same citations", () => {
    writeFailureAudit();
    writeFailureAudit({ decisionId: "dec-2", requestId: "req-2", executionId: "exec-2" });
    const body = createBody([
      citation(),
      citation({ decisionId: "dec-2", requestId: "req-2", executionId: "exec-2" }),
    ]);
    const first = createApplicationLearningProposal({ rawBody: body });
    const second = createApplicationLearningProposal({ rawBody: body });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    if ("error" in first.body || "error" in second.body) {
      throw new Error("duplicate create failed");
    }
    expect(second.body.proposalId).toBe(first.body.proposalId);
  });

  it("records ACCEPT with SoD and does not create an ApprovalRequest", async () => {
    writeFailureAudit();
    writeFailureAudit({ decisionId: "dec-2", requestId: "req-2", executionId: "exec-2" });
    const created = createApplicationLearningProposal({
      rawBody: createBody([
        citation(),
        citation({ decisionId: "dec-2", requestId: "req-2", executionId: "exec-2" }),
      ]),
    });
    if ("error" in created.body) throw new Error(created.body.error);
    const createApproval = vi.spyOn(approvals, "createApprovalRequest");
    const decideApproval = vi.spyOn(approvals, "decideApprovalRequest");
    const decided = decideApplicationLearningProposal({
      proposalId: created.body.proposalId,
      rawBody: { decision: "ACCEPT", reason: "Reviewed cited FAILURE reports." },
      decidedBy: "22222222-2222-4222-8222-222222222222",
    });
    expect(decided.status).toBe(200);
    if ("error" in decided.body) throw new Error(decided.body.error);
    expect(decided.body.state).toBe("ACCEPTED");
    expect(decided.body.learningDecision).toBe("ACCEPT");
    expect(decided.body.decidedBy).toBe("22222222-2222-4222-8222-222222222222");
    expect(decided.body.requestedBy).toBe(CONTROL_PLANE_SERVICE_ID);
    expect(decided.body.autoApply).toBe(false);
    expect(createApproval).not.toHaveBeenCalled();
    expect(decideApproval).not.toHaveBeenCalled();

    const events = listUnifiedAuditEntries();
    const decisionAudit = events.find(
      (entry) => entry.type === APPLICATION_LEARNING_PROPOSAL_DECIDED_AUDIT,
    );
    expect(decisionAudit).toBeDefined();
    expect(decisionAudit?.approval).toBe("NOT_REQUIRED");
    expect(decisionAudit?.approvalId).toBeNull();
    expect(decisionAudit?.decision).toBeNull();
    expect(decisionAudit?.verificationVerdict).toBe("NOT_APPLICABLE");
    expect(events.some((entry) => entry.type === APPLICATION_LEARNING_PROPOSAL_CREATED_AUDIT)).toBe(
      true,
    );
    expect(getApplicationLearningProposal(created.body.proposalId)?.state).toBe(
      "ACCEPTED",
    );
  });

  it("rejects cp:service deciding its own proposal", () => {
    writeFailureAudit();
    writeFailureAudit({ decisionId: "dec-2", requestId: "req-2", executionId: "exec-2" });
    const created = createApplicationLearningProposal({
      rawBody: createBody([
        citation(),
        citation({ decisionId: "dec-2", requestId: "req-2", executionId: "exec-2" }),
      ]),
    });
    if ("error" in created.body) throw new Error(created.body.error);
    expect(() =>
      decideApplicationLearningProposal({
        proposalId: created.body.proposalId,
        rawBody: { decision: "REJECT", reason: "self decide" },
        decidedBy: CONTROL_PLANE_SERVICE_ID,
      }),
    ).toThrow(/cp:service/);
  });
});

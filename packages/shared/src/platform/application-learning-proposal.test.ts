import { describe, expect, it } from "vitest";
import {
  APPLICATION_LEARNING_PROPOSAL_PATH,
  APPLICATION_LEARNING_PROPOSAL_SCHEMA,
  APPLICATION_EXECUTION_REPORT_SCHEMA,
  APPLICATION_PREFLIGHT_SCHEMA,
  applicationLearningCitationSchema,
  applicationLearningProposalCreateRequestSchema,
  applicationLearningProposalDecideRequestSchema,
  applicationLearningProposalSchema,
  learningCitationKey,
  learningCitationsShareScope,
  uniqueLearningCitationKeys,
} from "../index.js";

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

describe("application learning proposal contract", () => {
  it("uses a schema and path separate from preflight and execution-report", () => {
    expect(APPLICATION_LEARNING_PROPOSAL_SCHEMA).toBe(
      "atlas.application-learning-proposal.v1",
    );
    expect(APPLICATION_LEARNING_PROPOSAL_PATH).toBe(
      "/api/v1/governance/application-learning-proposal",
    );
    expect(APPLICATION_LEARNING_PROPOSAL_SCHEMA).not.toBe(
      APPLICATION_PREFLIGHT_SCHEMA,
    );
    expect(APPLICATION_LEARNING_PROPOSAL_SCHEMA).not.toBe(
      APPLICATION_EXECUTION_REPORT_SCHEMA,
    );
  });

  it("locks non-execution invariants on a valid proposal", () => {
    const parsed = applicationLearningProposalSchema.parse({
      schemaVersion: APPLICATION_LEARNING_PROPOSAL_SCHEMA,
      proposalId: "11111111-1111-4111-8111-111111111111",
      applicationId: "caseflow",
      tenantId: "tenant-a",
      projectId: "project-a",
      operation: "caseflow.openai.chat",
      agentId: null,
      citedReports: [citation(), citation({ decisionId: "dec-2", executionId: "exec-2", requestId: "req-2" })],
      recommendation: "Review repeated execution FAILURE reports in this scope.",
      epistemicState: "PROPOSED",
      state: "PENDING",
      requestedBy: "cp:service",
      decidedBy: null,
      learningDecision: null,
      autoApply: false,
      executes: false,
      mutatesGovernance: false,
      mutatesMemory: false,
      mutatesKnowledge: false,
    });
    expect(parsed.autoApply).toBe(false);
    expect(parsed.executes).toBe(false);
    expect(parsed.mutatesGovernance).toBe(false);
    expect(parsed.mutatesMemory).toBe(false);
    expect(parsed.mutatesKnowledge).toBe(false);
    expect(parsed.epistemicState).toBe("PROPOSED");
    expect(parsed.requestedBy).toBe("cp:service");
    expect(parsed.agentId).toBeNull();
  });

  it("rejects SUCCESS citations and invented execution statuses", () => {
    expect(
      applicationLearningCitationSchema.safeParse(
        citation({ executionStatus: "SUCCESS" }),
      ).success,
    ).toBe(false);
    expect(
      applicationLearningCitationSchema.safeParse(
        citation({ executionStatus: "VERIFIED" }),
      ).success,
    ).toBe(false);
  });

  it("rejects missing decisionId or executionId", () => {
    expect(
      applicationLearningCitationSchema.safeParse(citation({ decisionId: "" }))
        .success,
    ).toBe(false);
    expect(
      applicationLearningCitationSchema.safeParse(citation({ executionId: "" }))
        .success,
    ).toBe(false);
  });

  it("rejects autoApply true and execution-authority fields", () => {
    const base = {
      schemaVersion: APPLICATION_LEARNING_PROPOSAL_SCHEMA,
      proposalId: "11111111-1111-4111-8111-111111111111",
      applicationId: "caseflow",
      tenantId: "tenant-a",
      projectId: "project-a",
      operation: "caseflow.openai.chat",
      agentId: null,
      citedReports: [citation()],
      recommendation: "Review.",
      epistemicState: "PROPOSED",
      state: "PENDING",
      requestedBy: "cp:service",
      decidedBy: null,
      learningDecision: null,
      autoApply: false,
      executes: false,
      mutatesGovernance: false,
      mutatesMemory: false,
      mutatesKnowledge: false,
    };
    expect(
      applicationLearningProposalSchema.safeParse({ ...base, autoApply: true })
        .success,
    ).toBe(false);
    expect(
      applicationLearningProposalSchema.safeParse({ ...base, executes: true })
        .success,
    ).toBe(false);
    expect(
      applicationLearningProposalSchema.safeParse({
        ...base,
        requestedBy: "human-admin",
      }).success,
    ).toBe(false);
  });

  it("accepts ACCEPT and REJECT only — not ALLOW", () => {
    expect(
      applicationLearningProposalDecideRequestSchema.parse({
        decision: "ACCEPT",
        reason: "Reviewed cited FAILURE reports.",
      }).decision,
    ).toBe("ACCEPT");
    expect(
      applicationLearningProposalDecideRequestSchema.parse({
        decision: "REJECT",
        reason: "Evidence does not justify a recommendation.",
      }).decision,
    ).toBe("REJECT");
    expect(
      applicationLearningProposalDecideRequestSchema.safeParse({
        decision: "ALLOW",
        reason: "no",
      }).success,
    ).toBe(false);
    expect(
      applicationLearningProposalDecideRequestSchema.safeParse({
        decision: "APPROVED",
        reason: "no",
      }).success,
    ).toBe(false);
  });

  it("create request requires citations and a recommendation", () => {
    expect(
      applicationLearningProposalCreateRequestSchema.safeParse({
        schemaVersion: APPLICATION_LEARNING_PROPOSAL_SCHEMA,
        citations: [],
        recommendation: "Review.",
      }).success,
    ).toBe(false);
    expect(
      applicationLearningProposalCreateRequestSchema.safeParse({
        schemaVersion: APPLICATION_LEARNING_PROPOSAL_SCHEMA,
        citations: [citation()],
        recommendation: "",
      }).success,
    ).toBe(false);
  });

  it("treats the same decisionId+executionId as one citation key", () => {
    const a = citation();
    const b = citation({ requestId: "other" });
    expect(learningCitationKey(a as never)).toBe("dec-1:exec-1");
    expect(uniqueLearningCitationKeys([a, b] as never)).toEqual(["dec-1:exec-1"]);
  });

  it("detects mixed scopes without inventing a detector product", () => {
    expect(
      learningCitationsShareScope([
        citation() as never,
        citation({ tenantId: "other" }) as never,
      ]),
    ).toBe(false);
    expect(
      learningCitationsShareScope([
        citation() as never,
        citation({ decisionId: "dec-2", executionId: "exec-2", requestId: "req-2" }) as never,
      ]),
    ).toBe(true);
  });
});

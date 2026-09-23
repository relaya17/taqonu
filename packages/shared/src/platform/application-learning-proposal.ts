/**
 * Application learning proposal — human-governed recommendation from
 * cited execution FAILURE audits. Not execution authority.
 *
 * Separate from atlas.application-preflight.v1 and
 * atlas.application-execution-report.v1.
 * Never becomes an ApprovalRequest.
 */

import { z } from "zod";
import { epistemicStateSchema, uuidSchema } from "../schemas/common.schema.js";

export const APPLICATION_LEARNING_PROPOSAL_SCHEMA =
  "atlas.application-learning-proposal.v1" as const;

export const APPLICATION_LEARNING_PROPOSAL_PATH =
  "/api/v1/governance/application-learning-proposal" as const;

export const APPLICATION_LEARNING_PROPOSAL_CREATED_AUDIT =
  "application.learning.proposal.created" as const;

export const APPLICATION_LEARNING_PROPOSAL_DECIDED_AUDIT =
  "application.learning.decision.recorded" as const;

export const APPLICATION_LEARNING_DECISIONS = ["ACCEPT", "REJECT"] as const;
export type ApplicationLearningDecision =
  (typeof APPLICATION_LEARNING_DECISIONS)[number];

export const APPLICATION_LEARNING_STATES = [
  "PENDING",
  "ACCEPTED",
  "REJECTED",
] as const;
export type ApplicationLearningState =
  (typeof APPLICATION_LEARNING_STATES)[number];

export const applicationLearningCitationSchema = z.object({
  auditType: z.literal("application.execution.reported"),
  decisionId: z.string().trim().min(1).max(128),
  requestId: z.string().trim().min(1).max(128),
  executionId: z.string().trim().min(1).max(200),
  executionStatus: z.literal("FAILURE"),
  applicationId: z.string().trim().min(1).max(64),
  tenantId: z.string().trim().min(1).max(128),
  projectId: z.string().trim().min(1).max(128),
  operation: z.string().trim().min(1).max(200),
});
export type ApplicationLearningCitation = z.infer<
  typeof applicationLearningCitationSchema
>;

export const applicationLearningProposalSchema = z.object({
  schemaVersion: z.literal(APPLICATION_LEARNING_PROPOSAL_SCHEMA),
  proposalId: uuidSchema,
  applicationId: z.string().trim().min(1).max(64),
  tenantId: z.string().trim().min(1).max(128),
  projectId: z.string().trim().min(1).max(128),
  operation: z.string().trim().min(1).max(200),
  agentId: z.string().trim().min(1).max(200).nullable(),
  citedReports: z.array(applicationLearningCitationSchema).min(1),
  recommendation: z.string().trim().min(1).max(2000),
  epistemicState: z.literal("PROPOSED"),
  state: z.enum(APPLICATION_LEARNING_STATES),
  requestedBy: z.literal("cp:service"),
  decidedBy: z.string().trim().min(1).max(200).nullable(),
  learningDecision: z.enum(APPLICATION_LEARNING_DECISIONS).nullable(),
  autoApply: z.literal(false),
  executes: z.literal(false),
  mutatesGovernance: z.literal(false),
  mutatesMemory: z.literal(false),
  mutatesKnowledge: z.literal(false),
});
export type ApplicationLearningProposal = z.infer<
  typeof applicationLearningProposalSchema
>;

export const applicationLearningProposalCreateRequestSchema = z.object({
  schemaVersion: z.literal(APPLICATION_LEARNING_PROPOSAL_SCHEMA),
  citations: z.array(applicationLearningCitationSchema).min(1),
  recommendation: z.string().trim().min(1).max(2000),
});
export type ApplicationLearningProposalCreateRequest = z.infer<
  typeof applicationLearningProposalCreateRequestSchema
>;

export const applicationLearningProposalDecideRequestSchema = z.object({
  decision: z.enum(APPLICATION_LEARNING_DECISIONS),
  reason: z.string().trim().min(1).max(2000),
});
export type ApplicationLearningProposalDecideRequest = z.infer<
  typeof applicationLearningProposalDecideRequestSchema
>;

export function learningCitationKey(
  citation: Pick<ApplicationLearningCitation, "decisionId" | "executionId">,
): string {
  return `${citation.decisionId}:${citation.executionId}`;
}

export function uniqueLearningCitationKeys(
  citations: readonly Pick<
    ApplicationLearningCitation,
    "decisionId" | "executionId"
  >[],
): readonly string[] {
  return [...new Set(citations.map(learningCitationKey))];
}

export function learningCitationsShareScope(
  citations: readonly ApplicationLearningCitation[],
): boolean {
  const first = citations[0];
  if (!first) return false;
  return citations.every(
    (citation) =>
      citation.applicationId === first.applicationId &&
      citation.tenantId === first.tenantId &&
      citation.projectId === first.projectId &&
      citation.operation === first.operation,
  );
}

/** Compile-time lock: PROPOSED remains an existing epistemic state. */
export const APPLICATION_LEARNING_EPISTEMIC_STATE =
  epistemicStateSchema.enum.PROPOSED;

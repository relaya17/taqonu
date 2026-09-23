/**
 * CTRL-019 learning proposals from cited execution FAILURE audits.
 *
 * Audit NDJSON is the source of truth. This service never creates an
 * ApprovalRequest and never authorizes execution or mutation.
 */

import { randomUUID } from "node:crypto";
import {
  APPLICATION_LEARNING_PROPOSAL_CREATED_AUDIT,
  APPLICATION_LEARNING_PROPOSAL_DECIDED_AUDIT,
  APPLICATION_LEARNING_PROPOSAL_SCHEMA,
  AtlasError,
  CONTROL_PLANE_SERVICE_ID,
  applicationLearningProposalCreateRequestSchema,
  applicationLearningProposalDecideRequestSchema,
  applicationLearningProposalSchema,
  learningCitationKey,
  learningCitationsShareScope,
  uniqueLearningCitationKeys,
  type ApplicationLearningCitation,
  type ApplicationLearningDecision,
  type ApplicationLearningProposal,
} from "@atlas/shared";
import {
  appendUnifiedAuditEntry,
  listIndexedUnifiedByType,
  lookupIndexedFailureCitation,
} from "./audit-log.js";

const LEARNING_REQUESTED_BY = CONTROL_PLANE_SERVICE_ID;

export function resetApplicationLearningProposalForTests(): void {
  // Intentionally empty: proposals live in unified audit, not a process store.
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function findAuthoritativeFailure(
  citation: ApplicationLearningCitation,
): ApplicationLearningCitation | null {
  const recorded = lookupIndexedFailureCitation(
    citation.decisionId,
    citation.executionId,
  );
  if (!recorded) return null;
  if (learningCitationKey(recorded) !== learningCitationKey(citation)) {
    return null;
  }
  if (
    recorded.requestId !== citation.requestId ||
    recorded.applicationId !== citation.applicationId ||
    recorded.tenantId !== citation.tenantId ||
    recorded.projectId !== citation.projectId ||
    recorded.operation !== citation.operation
  ) {
    return null;
  }
  return {
    auditType: "application.execution.reported",
    decisionId: recorded.decisionId,
    requestId: recorded.requestId,
    executionId: recorded.executionId,
    executionStatus: "FAILURE",
    applicationId: recorded.applicationId,
    tenantId: recorded.tenantId,
    projectId: recorded.projectId,
    operation: recorded.operation,
  };
}

function proposalFromAuditInput(
  input: Record<string, unknown>,
): ApplicationLearningProposal | null {
  const parsed = applicationLearningProposalSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

function listRecordedProposals(): ApplicationLearningProposal[] {
  const byId = new Map<string, ApplicationLearningProposal>();
  for (const entry of listIndexedUnifiedByType(
    APPLICATION_LEARNING_PROPOSAL_CREATED_AUDIT,
  )) {
    const proposal = proposalFromAuditInput(asRecord(entry.input));
    if (proposal) byId.set(proposal.proposalId, proposal);
  }
  for (const entry of listIndexedUnifiedByType(
    APPLICATION_LEARNING_PROPOSAL_DECIDED_AUDIT,
  )) {
    const decided = proposalFromAuditInput(asRecord(entry.output));
    if (decided) byId.set(decided.proposalId, decided);
  }
  return [...byId.values()];
}

function sameCitationSet(
  left: readonly ApplicationLearningCitation[],
  right: readonly ApplicationLearningCitation[],
): boolean {
  const a = [...uniqueLearningCitationKeys(left)].sort().join("|");
  const b = [...uniqueLearningCitationKeys(right)].sort().join("|");
  return a === b;
}

function agentIdFromAudit(
  citations: readonly ApplicationLearningCitation[],
): string | null {
  const ids = new Set<string>();
  let sawNull = false;
  for (const citation of citations) {
    const recorded = lookupIndexedFailureCitation(
      citation.decisionId,
      citation.executionId,
    );
    if (!recorded) {
      sawNull = true;
      continue;
    }
    if (typeof recorded.agentId === "string" && recorded.agentId.trim()) {
      ids.add(recorded.agentId);
    } else {
      sawNull = true;
    }
  }
  if (sawNull || ids.size !== 1) return null;
  return [...ids][0] ?? null;
}

function writeProposalAudit(
  type: typeof APPLICATION_LEARNING_PROPOSAL_CREATED_AUDIT | typeof APPLICATION_LEARNING_PROPOSAL_DECIDED_AUDIT,
  proposal: ApplicationLearningProposal,
  extraInput: Record<string, unknown> = {},
): void {
  appendUnifiedAuditEntry({
    type,
    entityType: "application_learning_proposal",
    action: proposal.operation,
    actorId:
      type === APPLICATION_LEARNING_PROPOSAL_DECIDED_AUDIT
        ? proposal.decidedBy
        : proposal.requestedBy,
    actorKind:
      type === APPLICATION_LEARNING_PROPOSAL_DECIDED_AUDIT ? "USER" : "SYSTEM",
    agentId: proposal.agentId,
    tenantId: proposal.tenantId,
    projectId: proposal.projectId,
    reason:
      type === APPLICATION_LEARNING_PROPOSAL_CREATED_AUDIT
        ? "Learning proposal constructed from cited execution FAILURE audits"
        : "Human recorded a non-authorizing learning decision",
    policy: APPLICATION_LEARNING_PROPOSAL_SCHEMA,
    risk: "LOW",
    approval: "NOT_REQUIRED",
    approvalId: null,
    decision: null,
    input: {
      ...proposal,
      ...extraInput,
      executionAuthority: false,
    },
    output: {
      ...proposal,
      executionAuthority: false,
    },
    result: "SUCCESS",
    verificationVerdict: "NOT_APPLICABLE",
  });
}

export function createApplicationLearningProposal(input: {
  readonly rawBody: unknown;
}): {
  readonly status: number;
  readonly body: ApplicationLearningProposal | { readonly error: string };
} {
  const parsed = applicationLearningProposalCreateRequestSchema.safeParse(
    input.rawBody,
  );
  if (!parsed.success) {
    return {
      status: 400,
      body: { error: "Learning proposal body is invalid" },
    };
  }

  const citations = parsed.data.citations;
  if (!learningCitationsShareScope(citations)) {
    return {
      status: 400,
      body: {
        error:
          "Cited FAILURE reports must share applicationId, tenantId, projectId, and operation",
      },
    };
  }

  const uniqueKeys = uniqueLearningCitationKeys(citations);
  if (uniqueKeys.length === 1) {
    return {
      status: 400,
      body: { error: "A single FAILURE cannot be described as repeated" },
    };
  }

  const authoritative: ApplicationLearningCitation[] = [];
  const seen = new Set<string>();
  for (const citation of citations) {
    const key = learningCitationKey(citation);
    if (seen.has(key)) continue;
    const recorded = findAuthoritativeFailure(citation);
    if (!recorded) {
      return {
        status: 400,
        body: {
          error:
            "Each citation must match an authoritative application.execution.reported FAILURE audit",
        },
      };
    }
    seen.add(key);
    authoritative.push(recorded);
  }

  if (authoritative.length === 1) {
    return {
      status: 400,
      body: { error: "A single FAILURE cannot be described as repeated" },
    };
  }

  const existing = listRecordedProposals().find(
    (proposal) =>
      proposal.applicationId === authoritative[0]!.applicationId &&
      proposal.tenantId === authoritative[0]!.tenantId &&
      proposal.projectId === authoritative[0]!.projectId &&
      proposal.operation === authoritative[0]!.operation &&
      sameCitationSet(proposal.citedReports, authoritative),
  );
  if (existing) {
    return { status: 200, body: existing };
  }

  const first = authoritative[0]!;
  const proposal = applicationLearningProposalSchema.parse({
    schemaVersion: APPLICATION_LEARNING_PROPOSAL_SCHEMA,
    proposalId: randomUUID(),
    applicationId: first.applicationId,
    tenantId: first.tenantId,
    projectId: first.projectId,
    operation: first.operation,
    agentId: agentIdFromAudit(authoritative),
    citedReports: authoritative,
    recommendation: parsed.data.recommendation,
    epistemicState: "PROPOSED",
    state: "PENDING",
    requestedBy: LEARNING_REQUESTED_BY,
    decidedBy: null,
    learningDecision: null,
    autoApply: false,
    executes: false,
    mutatesGovernance: false,
    mutatesMemory: false,
    mutatesKnowledge: false,
  });

  writeProposalAudit(APPLICATION_LEARNING_PROPOSAL_CREATED_AUDIT, proposal);
  return { status: 201, body: proposal };
}

export function decideApplicationLearningProposal(input: {
  readonly proposalId: string;
  readonly rawBody: unknown;
  readonly decidedBy: string;
}): {
  readonly status: number;
  readonly body: ApplicationLearningProposal | { readonly error: string };
} {
  const parsed = applicationLearningProposalDecideRequestSchema.safeParse(
    input.rawBody,
  );
  if (!parsed.success) {
    return {
      status: 400,
      body: { error: "Learning decision body is invalid" },
    };
  }

  if (input.decidedBy === LEARNING_REQUESTED_BY) {
    throw new AtlasError(
      "CONFLICT",
      "Separation of duties forbids cp:service from deciding its own learning proposal",
      { statusCode: 409 },
    );
  }

  const existing = listRecordedProposals().find(
    (proposal) => proposal.proposalId === input.proposalId,
  );
  if (!existing) {
    throw new AtlasError(
      "NOT_FOUND",
      `Learning proposal ${input.proposalId} was not found`,
      { statusCode: 404 },
    );
  }

  if (existing.state !== "PENDING") {
    throw new AtlasError(
      "CONFLICT",
      `Learning proposal ${input.proposalId} is already ${existing.state}`,
      { statusCode: 409 },
    );
  }

  const decision: ApplicationLearningDecision = parsed.data.decision;
  const decided = applicationLearningProposalSchema.parse({
    ...existing,
    state: decision === "ACCEPT" ? "ACCEPTED" : "REJECTED",
    decidedBy: input.decidedBy,
    learningDecision: decision,
    autoApply: false,
    executes: false,
    mutatesGovernance: false,
    mutatesMemory: false,
    mutatesKnowledge: false,
  });

  writeProposalAudit(APPLICATION_LEARNING_PROPOSAL_DECIDED_AUDIT, decided, {
    reason: parsed.data.reason,
    requestedBy: existing.requestedBy,
    decidedBy: input.decidedBy,
  });
  return { status: 200, body: decided };
}

export function getApplicationLearningProposal(
  proposalId: string,
): ApplicationLearningProposal | undefined {
  return listRecordedProposals().find(
    (proposal) => proposal.proposalId === proposalId,
  );
}

export function listApplicationLearningProposalsForTests(): readonly ApplicationLearningProposal[] {
  return listRecordedProposals();
}

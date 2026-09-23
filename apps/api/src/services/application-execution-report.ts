/**
 * Application execution report-back.
 *
 * Correlates an application-owned execution identifier to a preceding ALLOW.
 * Process-local decision lookup is the same lifetime as the preflight cache:
 * restart without persist is not production correlation proof.
 *
 * ALLOW is not SUCCESS. Accepting this report is not execution success.
 */

import {
  APPLICATION_EXECUTION_REPORT_SCHEMA,
  applicationExecutionReportRequestSchema,
  applicationOwnedAgentId,
  applicationPreflightAllowsExecution,
  type ApplicationExecutionReportResponse,
  type ApplicationExecutionStatus,
} from "@atlas/shared";
import { appendUnifiedAuditEntry } from "./audit-log.js";
import {
  consumeApplicationConnectorNonce,
  loadApplicationConnectorBinding,
  lookupRememberedPreflightDecision,
} from "./application-preflight.js";
import {
  readApplicationConnectorHmacHeaders,
  verifyApplicationConnectorSignature,
} from "./application-connector-hmac.js";

export interface AcceptedExecutionReport {
  readonly decisionId: string;
  readonly requestId: string;
  readonly executionId: string;
  readonly executionStatus: ApplicationExecutionStatus;
  readonly applicationId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly operation: string;
  readonly agentId: string | null;
}

const acceptedReports = new Map<string, AcceptedExecutionReport>();

function reportKey(decisionId: string, executionId: string): string {
  return `${decisionId}:${executionId}`;
}

export function resetApplicationExecutionReportForTests(): void {
  acceptedReports.clear();
}

export function listAcceptedExecutionReportsForTests(): readonly AcceptedExecutionReport[] {
  return [...acceptedReports.values()];
}

function respond(input: {
  readonly status: number;
  readonly accepted: boolean;
  readonly reason: string;
  readonly decisionId: string;
  readonly requestId: string;
  readonly executionId: string | null;
  readonly executionStatus: ApplicationExecutionStatus | null;
  readonly applicationId: string;
  readonly agentId: string | null;
}): {
  readonly status: number;
  readonly body: ApplicationExecutionReportResponse;
} {
  return {
    status: input.status,
    body: {
      schemaVersion: APPLICATION_EXECUTION_REPORT_SCHEMA,
      accepted: input.accepted,
      reason: input.reason,
      decisionId: input.decisionId,
      requestId: input.requestId,
      executionId: input.executionId,
      executionStatus: input.executionStatus,
      applicationId: input.applicationId,
      agentId: input.agentId,
    },
  };
}

export async function evaluateApplicationExecutionReport(input: {
  readonly rawBody: string;
  readonly headers: { readonly [name: string]: string | string[] | undefined };
}): Promise<{
  readonly status: number;
  readonly body: ApplicationExecutionReportResponse | { readonly error: string };
}> {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(input.rawBody);
  } catch {
    return { status: 400, body: { error: "Execution report body must be JSON" } };
  }

  const parsed = applicationExecutionReportRequestSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { status: 400, body: { error: "Execution report request is invalid" } };
  }
  const request = parsed.data;
  const agentId = applicationOwnedAgentId(request.agentId);

  const binding = loadApplicationConnectorBinding(request.applicationId);
  if (!binding.ok) {
    return respond({
      status: binding.reason.includes("out of preflight scope") ? 403 : 401,
      accepted: false,
      reason: binding.reason,
      decisionId: request.decisionId,
      requestId: request.requestId,
      executionId: request.executionId,
      executionStatus: null,
      applicationId: request.applicationId,
      agentId,
    });
  }

  const hmacHeaders = readApplicationConnectorHmacHeaders(input.headers);
  const verified = verifyApplicationConnectorSignature({
    secret: binding.binding.secret,
    rawBody: input.rawBody,
    timestamp: hmacHeaders.timestamp,
    nonce: hmacHeaders.nonce,
    signature: hmacHeaders.signature,
  });
  if (!verified.ok) {
    return respond({
      status: 401,
      accepted: false,
      reason: verified.reason,
      decisionId: request.decisionId,
      requestId: request.requestId,
      executionId: request.executionId,
      executionStatus: null,
      applicationId: request.applicationId,
      agentId,
    });
  }

  if (!hmacHeaders.nonce) {
    return respond({
      status: 401,
      accepted: false,
      reason: "Application connector HMAC headers are required",
      decisionId: request.decisionId,
      requestId: request.requestId,
      executionId: request.executionId,
      executionStatus: null,
      applicationId: request.applicationId,
      agentId,
    });
  }

  const nonce = consumeApplicationConnectorNonce(
    binding.binding.applicationId,
    hmacHeaders.nonce,
  );
  if (!nonce.ok) {
    return respond({
      status: 401,
      accepted: false,
      reason: nonce.reason,
      decisionId: request.decisionId,
      requestId: request.requestId,
      executionId: request.executionId,
      executionStatus: null,
      applicationId: request.applicationId,
      agentId,
    });
  }

  if (
    request.applicationId !== binding.binding.applicationId ||
    request.tenantId !== binding.binding.tenantId ||
    request.projectId !== binding.binding.projectId
  ) {
    return respond({
      status: 403,
      accepted: false,
      reason: "Tenant or project does not match the authenticated application binding",
      decisionId: request.decisionId,
      requestId: request.requestId,
      executionId: request.executionId,
      executionStatus: null,
      applicationId: binding.binding.applicationId,
      agentId,
    });
  }

  const remembered = lookupRememberedPreflightDecision(request.decisionId);
  if (!remembered) {
    return respond({
      status: 409,
      accepted: false,
      reason: "No preceding preflight authorization exists for this decisionId",
      decisionId: request.decisionId,
      requestId: request.requestId,
      executionId: request.executionId,
      executionStatus: null,
      applicationId: request.applicationId,
      agentId,
    });
  }

  if (remembered.applicationId !== request.applicationId) {
    return respond({
      status: 409,
      accepted: false,
      reason: "Execution report application does not match the preceding authorization",
      decisionId: request.decisionId,
      requestId: request.requestId,
      executionId: request.executionId,
      executionStatus: null,
      applicationId: request.applicationId,
      agentId,
    });
  }

  if (
    remembered.tenantId !== request.tenantId ||
    remembered.projectId !== request.projectId
  ) {
    return respond({
      status: 409,
      accepted: false,
      reason: "Execution report tenant or project does not match the preceding authorization",
      decisionId: request.decisionId,
      requestId: request.requestId,
      executionId: request.executionId,
      executionStatus: null,
      applicationId: request.applicationId,
      agentId,
    });
  }

  if (remembered.requestId !== request.requestId) {
    return respond({
      status: 409,
      accepted: false,
      reason: "Execution report requestId does not match the preceding authorization",
      decisionId: request.decisionId,
      requestId: request.requestId,
      executionId: request.executionId,
      executionStatus: null,
      applicationId: request.applicationId,
      agentId,
    });
  }

  if (remembered.operation !== request.operation) {
    return respond({
      status: 409,
      accepted: false,
      reason: "Execution report operation does not match the preceding authorization",
      decisionId: request.decisionId,
      requestId: request.requestId,
      executionId: request.executionId,
      executionStatus: null,
      applicationId: request.applicationId,
      agentId,
    });
  }

  if (!applicationPreflightAllowsExecution(remembered.decision)) {
    return respond({
      status: 409,
      accepted: false,
      reason: `Execution report requires a preceding ALLOW; found ${remembered.decision}`,
      decisionId: request.decisionId,
      requestId: request.requestId,
      executionId: request.executionId,
      executionStatus: null,
      applicationId: request.applicationId,
      agentId,
    });
  }

  if (
    remembered.agentId &&
    agentId &&
    remembered.agentId !== agentId
  ) {
    return respond({
      status: 409,
      accepted: false,
      reason: "Execution report agentId does not match the preceding authorization",
      decisionId: request.decisionId,
      requestId: request.requestId,
      executionId: request.executionId,
      executionStatus: null,
      applicationId: request.applicationId,
      agentId,
    });
  }

  const recordedAgentId = agentId ?? remembered.agentId;
  const key = reportKey(request.decisionId, request.executionId);
  const prior = acceptedReports.get(key);
  if (prior) {
    if (prior.executionStatus !== request.executionStatus) {
      return respond({
        status: 409,
        accepted: false,
        reason: "Conflicting execution report for the same decisionId and executionId",
        decisionId: request.decisionId,
        requestId: request.requestId,
        executionId: request.executionId,
        executionStatus: null,
        applicationId: request.applicationId,
        agentId: recordedAgentId,
      });
    }
    return respond({
      status: 200,
      accepted: true,
      reason: "Replay of an already accepted execution report",
      decisionId: prior.decisionId,
      requestId: prior.requestId,
      executionId: prior.executionId,
      executionStatus: prior.executionStatus,
      applicationId: prior.applicationId,
      agentId: prior.agentId,
    });
  }

  const recorded: AcceptedExecutionReport = {
    decisionId: request.decisionId,
    requestId: request.requestId,
    executionId: request.executionId,
    executionStatus: request.executionStatus,
    applicationId: request.applicationId,
    tenantId: request.tenantId,
    projectId: request.projectId,
    operation: request.operation,
    agentId: recordedAgentId,
  };
  acceptedReports.set(key, recorded);


  appendUnifiedAuditEntry({
    type: "application.execution.reported",
    entityType: "application_execution_report",
    action: request.operation,
    actorId: `${request.applicationId}:connector`,
    actorKind: "SYSTEM",
    agentId: recordedAgentId,
    reason: "Application reported an execution correlated to a preceding ALLOW",
    policy: APPLICATION_EXECUTION_REPORT_SCHEMA,
    risk: "LOW",
    approval: "NOT_REQUIRED",
    decision: "ALLOW",
    input: {
      decisionId: request.decisionId,
      requestId: request.requestId,
      executionId: request.executionId,
      executionStatus: request.executionStatus,
      applicationId: request.applicationId,
      tenantId: request.tenantId,
      projectId: request.projectId,
      operation: request.operation,
      agentId: recordedAgentId,
    },
    output: {
      accepted: true,
      decisionId: request.decisionId,
      requestId: request.requestId,
      executionId: request.executionId,
      executionStatus: request.executionStatus,
    },
    result: "SUCCESS",
    verificationVerdict: "NOT_APPLICABLE",
  });

  return respond({
    status: 200,
    accepted: true,
    reason: "Execution report correlated to a preceding ALLOW",
    decisionId: recorded.decisionId,
    requestId: recorded.requestId,
    executionId: recorded.executionId,
    executionStatus: recorded.executionStatus,
    applicationId: recorded.applicationId,
    agentId: recorded.agentId,
  });
}

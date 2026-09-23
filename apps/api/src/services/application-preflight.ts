/**
 * Atlas application preflight — permission to execute, not an execute hop.
 *
 * HMAC authenticates the application. Env binding authenticates tenant/project.
 * Caller-supplied tenantId/applicationId cannot impersonate another binding.
 */

import { randomUUID } from "node:crypto";
import {
  APPLICATION_PREFLIGHT_KNOWN_APPLICATIONS,
  APPLICATION_PREFLIGHT_SCHEMA,
  APPLICATION_PREFLIGHT_SECRET_MIN_LENGTH,
  FABRIC_AGENT_IDS,
  applicationDeclaredCompletionPath,
  applicationOwnedAgentId,
  applicationPreflightRequestSchema,
  classifyApplicationAgentObservation,
  httpStatusForPreflightDecision,
  parseApplicationExpectedAgentIds,
  unavailablePolicyForClass,
  type ApplicationPreflightDecision,
  type ApplicationPreflightOperationClass,
  type ApplicationPreflightRequest,
  type ApplicationPreflightResponse,
} from "@atlas/shared";
import {
  createApprovalRequest,
  getApprovalRequest,
} from "./approvals.js";
import { appendUnifiedAuditEntry } from "./audit-log.js";
import { firstActiveEffectiveKillSwitch } from "./kill-switch-runtime.js";
import {
  readApplicationConnectorHmacHeaders,
  verifyApplicationConnectorSignature,
} from "./application-connector-hmac.js";

const KNOWN = new Set<string>(APPLICATION_PREFLIGHT_KNOWN_APPLICATIONS);
const FABRIC = new Set<string>(FABRIC_AGENT_IDS);
const NONCE_TTL_MS = 10 * 60 * 1000;

const usedNonces = new Map<string, number>();
const idempotencyCache = new Map<
  string,
  { readonly fingerprint: string; readonly response: ApplicationPreflightResponse }
>();

export interface RememberedPreflightDecision {
  readonly decision: ApplicationPreflightDecision;
  readonly decisionId: string;
  readonly requestId: string;
  readonly operation: string;
  readonly applicationId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly agentId: string | null;
}

/** Process-local decisionId index. Same lifetime as idempotencyCache. Not durable. */
const decisionsById = new Map<string, RememberedPreflightDecision>();

export function resetApplicationPreflightForTests(): void {
  usedNonces.clear();
  idempotencyCache.clear();
  decisionsById.clear();
}

/** Process-local ALLOW/DENY lookup for execution report-back. Not durable. */
export function lookupRememberedPreflightDecision(
  decisionId: string,
): RememberedPreflightDecision | null {
  return decisionsById.get(decisionId) ?? null;
}

export function consumeApplicationConnectorNonce(
  applicationId: string,
  nonce: string,
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  const now = Date.now();
  pruneNonces(now);
  const nonceKey = `${applicationId}:${nonce}`;
  if (usedNonces.has(nonceKey)) {
    return { ok: false, reason: "Application connector nonce has already been used" };
  }
  usedNonces.set(nonceKey, now + NONCE_TTL_MS);
  return { ok: true };
}

export interface ApplicationConnectorBinding {
  readonly applicationId: string;
  readonly secret: string;
  readonly tenantId: string;
  readonly projectId: string;
}

function envTrim(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function envPrefix(applicationId: string): string {
  return applicationId.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

export function loadApplicationConnectorBinding(
  applicationId: string,
):
  | { readonly ok: true; readonly binding: ApplicationConnectorBinding }
  | { readonly ok: false; readonly reason: string } {
  if (!KNOWN.has(applicationId) || applicationId === "def-000") {
    return { ok: false, reason: "Application is out of preflight scope" };
  }
  const prefix = envPrefix(applicationId);
  const secret =
    envTrim(`ATLAS_${prefix}_CONNECTOR_SECRET`) ||
    (applicationId === "civio" ? envTrim("ATLAS_CIVIO_CONNECTOR_SECRET") : "");
  const tenantId =
    envTrim(`ATLAS_${prefix}_CONNECTOR_TENANT_ID`) ||
    (applicationId === "civio" ? envTrim("ATLAS_CIVIO_TENANT_ID") : "");
  const projectId =
    envTrim(`ATLAS_${prefix}_CONNECTOR_PROJECT_ID`) ||
    (applicationId === "civio" ? envTrim("ATLAS_CIVIO_PROJECT_ID") : "");
  if (secret.length < APPLICATION_PREFLIGHT_SECRET_MIN_LENGTH) {
    return {
      ok: false,
      reason: `ATLAS_${prefix}_CONNECTOR_SECRET must be set (min ${APPLICATION_PREFLIGHT_SECRET_MIN_LENGTH} characters).`,
    };
  }
  if (!tenantId || !projectId) {
    return {
      ok: false,
      reason: `ATLAS_${prefix}_CONNECTOR_TENANT_ID and ATLAS_${prefix}_CONNECTOR_PROJECT_ID must be set.`,
    };
  }
  return {
    ok: true,
    binding: { applicationId, secret, tenantId, projectId },
  };
}

/**
 * Application-owned Expected Agent set.
 * Operator acting for the application sets
 * `ATLAS_{APP}_EXPECTED_AGENT_IDS` (comma-separated).
 * Unset = no declaration. Empty value = explicit empty set.
 * Not Fabric, not CP `RegisteredApplication.agentIds`, not first-seen.
 */
export function loadApplicationExpectedAgentIds(
  applicationId: string,
): readonly string[] | null {
  const prefix = envPrefix(applicationId);
  return parseApplicationExpectedAgentIds(
    process.env[`ATLAS_${prefix}_EXPECTED_AGENT_IDS`],
  );
}

function pruneNonces(now: number): void {
  for (const [nonce, expires] of usedNonces) {
    if (expires <= now) usedNonces.delete(nonce);
  }
}

function fingerprintOf(request: ApplicationPreflightRequest): string {
  const parts = [
    request.applicationId,
    request.tenantId,
    request.projectId,
    request.actorId,
    applicationOwnedAgentId(request.agentId) ?? "",
    request.operation,
    request.operationClass,
    request.requestId,
    request.idempotencyKey,
    request.approvalId ?? "",
  ];
  const declaredPath = applicationDeclaredCompletionPath(
    request.declaredCompletionPath,
  );
  if (declaredPath) parts.push(declaredPath);
  return parts.join("\n");
}

function denyImpersonation(
  request: ApplicationPreflightRequest,
): ApplicationPreflightDecision | null {
  const agentId = applicationOwnedAgentId(request.agentId) ?? "";
  if (request.applicationId === "def-000") return "OUT_OF_SCOPE";
  if (request.actorId.startsWith("psa:") || agentId.startsWith("psa:")) {
    return "OUT_OF_SCOPE";
  }
  if (agentId.startsWith("cp:") || request.actorId.startsWith("cp:")) {
    return "OUT_OF_SCOPE";
  }
  if (FABRIC.has(agentId) || FABRIC.has(request.actorId)) {
    return "OUT_OF_SCOPE";
  }
  return null;
}

function killCategoriesFor(
  operationClass: ApplicationPreflightOperationClass,
): readonly ("aiWorkers" | "agentDispatch")[] {
  if (operationClass === "HIGH_RISK" || operationClass === "TOOL_ACTION") {
    return ["aiWorkers", "agentDispatch"];
  }
  return ["aiWorkers"];
}

function approvalStatusFor(
  decision: ApplicationPreflightDecision,
): "NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED" {
  if (decision === "REQUIRE_APPROVAL") return "PENDING";
  return "NOT_REQUIRED";
}

function auditDecisionFor(
  decision: ApplicationPreflightDecision,
): "ALLOW" | "DENY" | "REQUIRE_APPROVAL" | null {
  if (decision === "ALLOW") return "ALLOW";
  if (decision === "REQUIRE_APPROVAL") return "REQUIRE_APPROVAL";
  return "DENY";
}

function finish(input: {
  readonly request: ApplicationPreflightRequest;
  readonly decision: ApplicationPreflightDecision;
  readonly reason: string;
  readonly approvalRequestId?: string | null;
  readonly killSwitchCategory?: string | null;
}): ApplicationPreflightResponse {
  const agentId = applicationOwnedAgentId(input.request.agentId);
  const declaredCompletionPath = applicationDeclaredCompletionPath(
    input.request.declaredCompletionPath,
  );
  const expectedAgentIds = loadApplicationExpectedAgentIds(
    input.request.applicationId,
  );
  const agentObservation = classifyApplicationAgentObservation({
    observedAgentId: agentId,
    expectedAgentIds,
  });
  const response: ApplicationPreflightResponse = {
    schemaVersion: APPLICATION_PREFLIGHT_SCHEMA,
    decision: input.decision,
    executed: false,
    reason: input.reason,
    requestId: input.request.requestId,
    applicationId: input.request.applicationId,
    agentId,
    tenantId: input.request.tenantId,
    projectId: input.request.projectId,
    operation: input.request.operation,
    operationClass: input.request.operationClass,
    unavailablePolicy: unavailablePolicyForClass(input.request.operationClass),
    approvalRequestId: input.approvalRequestId ?? null,
    killSwitchCategory: input.killSwitchCategory ?? null,
    decisionId: randomUUID(),
    declaredCompletionPath,
  };
  appendUnifiedAuditEntry({
    type: "application.preflight.evaluated",
    entityType: "application_preflight",
    action: input.request.operation,
    actorId: `${input.request.applicationId}:${input.request.actorId}`,
    actorKind: input.request.actorKind,
    agentId,
    reason: input.reason,
    policy: "atlas.application-preflight.v1",
    risk:
      input.request.risk ??
      (input.request.operationClass === "HIGH_RISK" ||
      input.request.operationClass === "TOOL_ACTION"
        ? "HIGH"
        : "LOW"),
    approval: approvalStatusFor(input.decision),
    approvalId: input.approvalRequestId ?? null,
    decision: auditDecisionFor(input.decision),
    input: {
      requestId: input.request.requestId,
      applicationId: input.request.applicationId,
      agentId,
      actorId: input.request.actorId,
      operation: input.request.operation,
      operationClass: input.request.operationClass,
      idempotencyKey: input.request.idempotencyKey,
      declaredCompletionPath,
      expectedAgentIds,
      agentObservation: agentObservation.observation,
    },
    output: {
      decision: input.decision,
      executed: false,
      decisionId: response.decisionId,
      killSwitchCategory: input.killSwitchCategory ?? null,
      declaredCompletionPath,
      agentObservation: agentObservation.observation,
    },
    result: "SUCCESS",
    verificationVerdict: "NOT_APPLICABLE",
  });
  decisionsById.set(response.decisionId, {
    decision: response.decision,
    decisionId: response.decisionId,
    requestId: input.request.requestId,
    operation: input.request.operation,
    applicationId: input.request.applicationId,
    tenantId: input.request.tenantId,
    projectId: input.request.projectId,
    agentId,
  });
  return response;
}

/**
 * Runs only after HMAC + tenant/project binding succeed.
 * Unset connector secret never reaches this function: evaluateApplicationPreflight
 * returns 401 INVALID from loadApplicationConnectorBinding first.
 * finish() always stamps unavailablePolicyForClass — the four existing classes only:
 *   GOVERNED_DECISION / INFORMATIONAL → FAIL_OPEN (client may skip if Atlas is down)
 *   HIGH_RISK / TOOL_ACTION → FAIL_CLOSED (client must not execute if Atlas is down)
 * Approval-store failure on HIGH/TOOL is DENY + HTTP 503 ("Fail closed:"), not ALLOW.
 */
async function evaluateAuthorized(
  request: ApplicationPreflightRequest,
): Promise<ApplicationPreflightResponse> {
  const impersonation = denyImpersonation(request);
  if (impersonation) {
    return finish({
      request,
      decision: impersonation,
      reason: "Application may not impersonate Atlas, PSA, Fabric, or Control",
    });
  }

  const kill = firstActiveEffectiveKillSwitch(
    killCategoriesFor(request.operationClass),
  );
  if (kill) {
    return finish({
      request,
      decision: "KILLED",
      reason: `Kill switch ${kill.category} is active`,
      killSwitchCategory: kill.category,
    });
  }

  if (/\.(delete|destroy|drop)$/i.test(request.operation)) {
    return finish({
      request,
      decision: "DENY",
      reason: "Destructive application operations are denied by Atlas preflight policy",
    });
  }

  const needsApproval =
    request.operationClass === "HIGH_RISK" ||
    request.operationClass === "TOOL_ACTION" ||
    request.risk === "HIGH" ||
    request.risk === "CRITICAL";

  if (needsApproval) {
    if (request.approvalId) {
      const existing = await getApprovalRequest(request.approvalId);
      if (!existing) {
        return finish({
          request,
          decision: "DENY",
          reason: "Approval request was not found",
        });
      }
      if (existing.status !== "APPROVED") {
        return finish({
          request,
          decision: existing.status === "PENDING" ? "REQUIRE_APPROVAL" : "DENY",
          reason: `Approval is ${existing.status}`,
          approvalRequestId: existing.id,
        });
      }
      if (existing.expiresAt && Date.parse(existing.expiresAt) <= Date.now()) {
        return finish({
          request,
          decision: "DENY",
          reason: "Approval has expired",
          approvalRequestId: existing.id,
        });
      }
      const context = existing.context ?? {};
      if (
        context["applicationId"] !== request.applicationId ||
        context["tenantId"] !== request.tenantId ||
        context["operation"] !== request.operation
      ) {
        return finish({
          request,
          decision: "DENY",
          reason: "Approval context does not match this preflight request",
          approvalRequestId: existing.id,
        });
      }
      return finish({
        request,
        decision: "ALLOW",
        reason: "Approved application operation may execute",
        approvalRequestId: existing.id,
      });
    }

    try {
      const created = await createApprovalRequest({
        entityType: "application_preflight",
        action: request.operation,
        requestedBy: `${request.applicationId}:${request.actorId}`,
        reason: `Atlas preflight requires approval for ${request.applicationId} ${request.operation}`,
        context: {
          applicationId: request.applicationId,
          tenantId: request.tenantId,
          projectId: request.projectId,
          operation: request.operation,
          operationClass: request.operationClass,
          requestId: request.requestId,
          idempotencyKey: request.idempotencyKey,
          ...(applicationOwnedAgentId(request.agentId)
            ? { agentId: applicationOwnedAgentId(request.agentId) }
            : {}),
        },
      });
      return finish({
        request,
        decision: "REQUIRE_APPROVAL",
        reason: "Human approval is required before the application may execute",
        approvalRequestId: created.id,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "approval store unavailable";
      return finish({
        request,
        decision: "DENY",
        reason: `Fail closed: ${message}`,
      });
    }
  }

  return finish({
    request,
    decision: "ALLOW",
    reason: "Atlas preflight allowed the application operation",
  });
}

export async function evaluateApplicationPreflight(input: {
  readonly rawBody: string;
  readonly headers: { readonly [name: string]: string | string[] | undefined };
}): Promise<{
  readonly status: number;
  readonly body: ApplicationPreflightResponse | { readonly error: string };
}> {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(input.rawBody);
  } catch {
    return { status: 400, body: { error: "Preflight body must be JSON" } };
  }

  const parsed = applicationPreflightRequestSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { status: 400, body: { error: "Preflight request is invalid" } };
  }
  const request = parsed.data;

  const binding = loadApplicationConnectorBinding(request.applicationId);
  if (!binding.ok) {
    const outOfScope = binding.reason.includes("out of preflight scope");
    return {
      status: outOfScope ? 403 : 401,
      body: finish({
        request,
        decision: outOfScope ? "OUT_OF_SCOPE" : "INVALID",
        reason: binding.reason,
      }),
    };
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
    return {
      status: 401,
      body: finish({
        request,
        decision: "INVALID",
        reason: verified.reason,
      }),
    };
  }

  const now = Date.now();
  pruneNonces(now);
  const nonceKey = `${request.applicationId}:${hmacHeaders.nonce}`;
  if (usedNonces.has(nonceKey)) {
    return {
      status: 401,
      body: finish({
        request,
        decision: "INVALID",
        reason: "Application connector nonce has already been used",
      }),
    };
  }
  usedNonces.set(nonceKey, now + NONCE_TTL_MS);

  if (
    request.tenantId !== binding.binding.tenantId ||
    request.projectId !== binding.binding.projectId
  ) {
    return {
      status: 403,
      body: finish({
        request,
        decision: "OUT_OF_SCOPE",
        reason: "Tenant or project does not match the authenticated application binding",
      }),
    };
  }

  const idemKey = `${request.applicationId}:${request.idempotencyKey}`;
  const prior = idempotencyCache.get(idemKey);
  const fingerprint = fingerprintOf(request);
  if (prior) {
    if (prior.fingerprint !== fingerprint) {
      return {
        status: 409,
        body: finish({
          request,
          decision: "DENY",
          reason: "Idempotency key was reused with a different preflight payload",
        }),
      };
    }
    return {
      status: httpStatusForPreflightDecision(prior.response.decision),
      body: prior.response,
    };
  }

  const evaluated = await evaluateAuthorized(request);
  idempotencyCache.set(idemKey, { fingerprint, response: evaluated });
  return {
    status: evaluated.reason.startsWith("Fail closed:")
      ? 503
      : httpStatusForPreflightDecision(evaluated.decision),
    body: evaluated,
  };
}

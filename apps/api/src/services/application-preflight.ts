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
  type UnifiedAuditEntryInput,
} from "@atlas/shared";
import {
  ApplicationGovernancePersistenceError,
  type PersistedPreflightDecision,
} from "@atlas/database";
import {
  createApprovalRequest,
  getApprovalRequest,
} from "./approvals.js";
import { appendAuditLogLine, appendUnifiedAuditEntry } from "./audit-log.js";
import { firstActiveEffectiveKillSwitch } from "./kill-switch-runtime.js";
import {
  readApplicationConnectorHmacHeaders,
  verifyApplicationConnectorSignature,
} from "./application-connector-hmac.js";
import {
  APPLICATION_CONNECTOR_NONCE_TTL_MS,
  applicationGovernanceMode,
  clearApplicationGovernanceStoreForTests,
  decisionExpiresAtIso,
  governanceUnavailableResponse,
  nonceExpiresAtIso,
  requireApplicationGovernanceStore,
} from "./application-governance-store.js";

const KNOWN = new Set<string>(APPLICATION_PREFLIGHT_KNOWN_APPLICATIONS);
const FABRIC = new Set<string>(FABRIC_AGENT_IDS);
const NONCE_TTL_MS = APPLICATION_CONNECTOR_NONCE_TTL_MS;

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
  clearApplicationGovernanceStoreForTests();
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

export async function consumeApplicationConnectorNonceAuthoritative(
  applicationId: string,
  nonce: string,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }> {
  const mode = applicationGovernanceMode();
  if (mode === "unavailable") {
    throw new ApplicationGovernancePersistenceError(
      "UNAVAILABLE",
      "Application governance store is unavailable",
    );
  }
  if (mode === "durable") {
    return requireApplicationGovernanceStore().consumeNonce({
      applicationId,
      nonce,
      expiresAt: nonceExpiresAtIso(),
    });
  }
  return consumeApplicationConnectorNonce(applicationId, nonce);
}

function rememberedFromPersisted(
  row: PersistedPreflightDecision,
): RememberedPreflightDecision {
  return {
    decision: row.decision as RememberedPreflightDecision["decision"],
    decisionId: row.decisionId,
    requestId: row.requestId,
    operation: row.operation,
    applicationId: row.applicationId,
    tenantId: row.tenantId,
    projectId: row.projectId,
    agentId: row.agentId,
  };
}

export async function resolveRememberedPreflightDecision(
  decisionId: string,
): Promise<RememberedPreflightDecision | null> {
  const mode = applicationGovernanceMode();
  if (mode === "durable") {
    const row = await requireApplicationGovernanceStore().lookupDecision(decisionId);
    if (!row || row.expired) return null;
    return rememberedFromPersisted(row);
  }
  return lookupRememberedPreflightDecision(decisionId);
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

function buildPreflightResponse(input: {
  readonly request: ApplicationPreflightRequest;
  readonly decision: ApplicationPreflightDecision;
  readonly reason: string;
  readonly approvalRequestId?: string | null;
  readonly killSwitchCategory?: string | null;
}): {
  readonly response: ApplicationPreflightResponse;
  readonly agentId: string | null;
  readonly declaredCompletionPath: ApplicationPreflightResponse["declaredCompletionPath"];
  readonly expectedAgentIds: readonly string[] | null;
  readonly agentObservation: ReturnType<typeof classifyApplicationAgentObservation>;
} {
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
  return { response, agentId, declaredCompletionPath, expectedAgentIds, agentObservation };
}

function preflightAuditPayload(input: {
  readonly request: ApplicationPreflightRequest;
  readonly response: ApplicationPreflightResponse;
  readonly agentId: string | null;
  readonly declaredCompletionPath: ApplicationPreflightResponse["declaredCompletionPath"];
  readonly expectedAgentIds: readonly string[] | null;
  readonly agentObservation: ReturnType<typeof classifyApplicationAgentObservation>;
}): Record<string, unknown> {
  return {
    type: "application.preflight.evaluated",
    entityType: "application_preflight",
    action: input.request.operation,
    actorId: `${input.request.applicationId}:${input.request.actorId}`,
    actorKind: input.request.actorKind,
    agentId: input.agentId,
    tenantId: input.request.tenantId,
    projectId: input.request.projectId,
    reason: input.response.reason,
    policy: "atlas.application-preflight.v1",
    risk:
      input.request.risk ??
      (input.request.operationClass === "HIGH_RISK" ||
      input.request.operationClass === "TOOL_ACTION"
        ? "HIGH"
        : "LOW"),
    approval: approvalStatusFor(input.response.decision),
    approvalId: input.response.approvalRequestId ?? null,
    decision: auditDecisionFor(input.response.decision),
    input: {
      requestId: input.request.requestId,
      applicationId: input.request.applicationId,
      tenantId: input.request.tenantId,
      projectId: input.request.projectId,
      agentId: input.agentId,
      actorId: input.request.actorId,
      operation: input.request.operation,
      operationClass: input.request.operationClass,
      idempotencyKey: input.request.idempotencyKey,
      declaredCompletionPath: input.declaredCompletionPath,
      expectedAgentIds: input.expectedAgentIds,
      agentObservation: input.agentObservation.observation,
    },
    output: {
      decision: input.response.decision,
      executed: false,
      decisionId: input.response.decisionId,
      killSwitchCategory: input.response.killSwitchCategory ?? null,
      declaredCompletionPath: input.declaredCompletionPath,
      agentObservation: input.agentObservation.observation,
    },
    result: "SUCCESS",
    verificationVerdict: "NOT_APPLICABLE",
  };
}

function persistLocalPreflight(
  request: ApplicationPreflightRequest,
  built: ReturnType<typeof buildPreflightResponse>,
): void {
  appendUnifiedAuditEntry(
    preflightAuditPayload({ request, ...built }) as UnifiedAuditEntryInput,
  );
  decisionsById.set(built.response.decisionId, {
    decision: built.response.decision,
    decisionId: built.response.decisionId,
    requestId: request.requestId,
    operation: request.operation,
    applicationId: request.applicationId,
    tenantId: request.tenantId,
    projectId: request.projectId,
    agentId: built.agentId,
  });
}

async function persistDurablePreflight(input: {
  readonly request: ApplicationPreflightRequest;
  readonly built: ReturnType<typeof buildPreflightResponse>;
  readonly fingerprint: string;
}): Promise<ApplicationPreflightResponse> {
  const recorded = await requireApplicationGovernanceStore().recordOutcome({
    decisionId: input.built.response.decisionId,
    requestId: input.request.requestId,
    applicationId: input.request.applicationId,
    tenantId: input.request.tenantId,
    projectId: input.request.projectId,
    operation: input.request.operation,
    operationClass: input.request.operationClass,
    decision: input.built.response.decision,
    agentId: input.built.agentId,
    approvalId: input.built.response.approvalRequestId,
    httpStatus: httpStatusForPreflightDecision(input.built.response.decision),
    response: { ...input.built.response },
    expiresAt: decisionExpiresAtIso(),
    idempotencyKey: input.request.idempotencyKey,
    fingerprint: input.fingerprint,
    auditId: randomUUID(),
    auditPayload: preflightAuditPayload({
      request: input.request,
      ...input.built,
    }),
  });
  if (recorded.kind === "IDEMPOTENT_HIT") {
    return recorded.response as unknown as ApplicationPreflightResponse;
  }
  if (recorded.kind === "IDEMPOTENT_CONFLICT") {
    return {
      ...input.built.response,
      decision: "DENY",
      reason: "Idempotency key was reused with a different preflight payload",
    };
  }
  appendAuditLogLine(
    preflightAuditPayload({ request: input.request, ...input.built }),
  );
  return input.built.response;
}

async function finish(input: {
  readonly request: ApplicationPreflightRequest;
  readonly decision: ApplicationPreflightDecision;
  readonly reason: string;
  readonly approvalRequestId?: string | null;
  readonly killSwitchCategory?: string | null;
  readonly persist?: "authority" | "evidence";
  readonly fingerprint?: string;
}): Promise<ApplicationPreflightResponse> {
  const built = buildPreflightResponse(input);
  const mode = applicationGovernanceMode();
  if (mode === "durable" && input.persist === "authority") {
    if (!input.fingerprint) {
      throw new ApplicationGovernancePersistenceError(
        "UNAVAILABLE",
        "Preflight T1 requires a fingerprint",
      );
    }
    return persistDurablePreflight({
      request: input.request,
      built,
      fingerprint: input.fingerprint,
    });
  }
  if (mode === "durable") {
    appendAuditLogLine(preflightAuditPayload({ request: input.request, ...built }));
    return built.response;
  }
  persistLocalPreflight(input.request, built);
  return built.response;
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
  fingerprint: string,
): Promise<ApplicationPreflightResponse> {
  const persistAuthority = (
    input: Omit<Parameters<typeof finish>[0], "persist" | "fingerprint">,
  ) => finish({ ...input, persist: "authority", fingerprint });
  const impersonation = denyImpersonation(request);
  if (impersonation) {
    return persistAuthority({
      request,
      decision: impersonation,
      reason: "Application may not impersonate Atlas, PSA, Fabric, or Control",
    });
  }

  const kill = firstActiveEffectiveKillSwitch(
    killCategoriesFor(request.operationClass),
  );
  if (kill) {
    return persistAuthority({
      request,
      decision: "KILLED",
      reason: `Kill switch ${kill.category} is active`,
      killSwitchCategory: kill.category,
    });
  }

  if (/\.(delete|destroy|drop)$/i.test(request.operation)) {
    return persistAuthority({
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
        return persistAuthority({
          request,
          decision: "DENY",
          reason: "Approval request was not found",
        });
      }
      if (existing.status !== "APPROVED") {
        return persistAuthority({
          request,
          decision: existing.status === "PENDING" ? "REQUIRE_APPROVAL" : "DENY",
          reason: `Approval is ${existing.status}`,
          approvalRequestId: existing.id,
        });
      }
      if (existing.expiresAt && Date.parse(existing.expiresAt) <= Date.now()) {
        return persistAuthority({
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
        return persistAuthority({
          request,
          decision: "DENY",
          reason: "Approval context does not match this preflight request",
          approvalRequestId: existing.id,
        });
      }
      return persistAuthority({
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
      return persistAuthority({
        request,
        decision: "REQUIRE_APPROVAL",
        reason: "Human approval is required before the application may execute",
        approvalRequestId: created.id,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "approval store unavailable";
      return persistAuthority({
        request,
        decision: "DENY",
        reason: `Fail closed: ${message}`,
      });
    }
  }

  return persistAuthority({
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
      body: await finish({
        request,
        decision: outOfScope ? "OUT_OF_SCOPE" : "INVALID",
        reason: binding.reason,
        persist: "evidence",
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
      body: await finish({
        request,
        decision: "INVALID",
        reason: verified.reason,
        persist: "evidence",
      }),
    };
  }

  if (applicationGovernanceMode() === "unavailable") {
    return governanceUnavailableResponse();
  }

  if (!hmacHeaders.nonce) {
    return {
      status: 401,
      body: await finish({
        request,
        decision: "INVALID",
        reason: "Application connector HMAC headers are required",
        persist: "evidence",
      }),
    };
  }

  let nonce;
  try {
    nonce = await consumeApplicationConnectorNonceAuthoritative(
      request.applicationId,
      hmacHeaders.nonce,
    );
  } catch (error) {
    if (
      error instanceof ApplicationGovernancePersistenceError &&
      error.kind === "UNAVAILABLE"
    ) {
      return governanceUnavailableResponse();
    }
    throw error;
  }
  if (!nonce.ok) {
    return {
      status: 401,
      body: await finish({
        request,
        decision: "INVALID",
        reason: nonce.reason,
        persist: "evidence",
      }),
    };
  }

  if (
    request.tenantId !== binding.binding.tenantId ||
    request.projectId !== binding.binding.projectId
  ) {
    return {
      status: 403,
      body: await finish({
        request,
        decision: "OUT_OF_SCOPE",
        reason: "Tenant or project does not match the authenticated application binding",
        persist: "evidence",
      }),
    };
  }

  const fingerprint = fingerprintOf(request);
  const mode = applicationGovernanceMode();
  if (mode === "durable") {
    let prior;
    try {
      prior = await requireApplicationGovernanceStore().lookupIdempotency({
        applicationId: request.applicationId,
        idempotencyKey: request.idempotencyKey,
      });
    } catch (error) {
      if (
        error instanceof ApplicationGovernancePersistenceError &&
        error.kind === "UNAVAILABLE"
      ) {
        return governanceUnavailableResponse();
      }
      throw error;
    }
    if (prior) {
      if (prior.fingerprint !== fingerprint) {
        return {
          status: 409,
          body: await finish({
            request,
            decision: "DENY",
            reason: "Idempotency key was reused with a different preflight payload",
            persist: "evidence",
          }),
        };
      }
      const stored = prior.response as unknown as ApplicationPreflightResponse;
      return {
        status: prior.httpStatus || httpStatusForPreflightDecision(stored.decision),
        body: stored,
      };
    }
    try {
      const evaluated = await evaluateAuthorized(request, fingerprint);
      return {
        status: evaluated.reason.startsWith("Fail closed:")
          ? 503
          : httpStatusForPreflightDecision(evaluated.decision),
        body: evaluated,
      };
    } catch (error) {
      if (
        error instanceof ApplicationGovernancePersistenceError &&
        error.kind === "UNAVAILABLE"
      ) {
        return governanceUnavailableResponse();
      }
      throw error;
    }
  }

  const idemKey = `${request.applicationId}:${request.idempotencyKey}`;
  const prior = idempotencyCache.get(idemKey);
  if (prior) {
    if (prior.fingerprint !== fingerprint) {
      return {
        status: 409,
        body: await finish({
          request,
          decision: "DENY",
          reason: "Idempotency key was reused with a different preflight payload",
          persist: "evidence",
        }),
      };
    }
    return {
      status: httpStatusForPreflightDecision(prior.response.decision),
      body: prior.response,
    };
  }

  const evaluated = await evaluateAuthorized(request, fingerprint);
  idempotencyCache.set(idemKey, { fingerprint, response: evaluated });
  return {
    status: evaluated.reason.startsWith("Fail closed:")
      ? 503
      : httpStatusForPreflightDecision(evaluated.decision),
    body: evaluated,
  };
}

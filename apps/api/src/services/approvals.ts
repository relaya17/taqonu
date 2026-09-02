import {
  AtlasError,
  type ApprovalRequest,
} from "@atlas/shared";
import {
  LiveApprovalPersistenceError,
  LiveApprovalRequestRepository,
  createDatabaseClients,
  isLiveSupabase,
  type CreateLiveApprovalInput,
  type DecideLiveApprovalInput,
  type PresentedLiveExecution,
  type RevokeLiveApprovalInput,
} from "@atlas/database";
import { appendUnifiedAuditEntry } from "./audit-log.js";

/**
 * Live approval service boundary. Authority is the configured
 * `LiveApprovalRequestRepository` (PostgreSQL RPCs in production).
 * There is no process-local Map and no in-memory fallback.
 */
let store: LiveApprovalRequestRepository | null = null;
let storeClearedForTests = false;

export type CreateApprovalRequestInput = CreateLiveApprovalInput;
export type DecideApprovalRequestInput = DecideLiveApprovalInput;
export type RevokeApprovalRequestInput = RevokeLiveApprovalInput;
export type PresentedExecution = PresentedLiveExecution;

export function configureLiveApprovalStore(
  next: LiveApprovalRequestRepository,
): void {
  store = next;
  storeClearedForTests = false;
}

export function clearLiveApprovalStoreForTests(): void {
  store = null;
  storeClearedForTests = true;
}

function notConfigured(): never {
  throw new AtlasError(
    "INTEGRATION_ERROR",
    "Live approval store is not configured",
    { statusCode: 503 },
  );
}

function productionPostgresEnv(): {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
} {
  return {
    SUPABASE_URL: process.env.SUPABASE_URL ?? "",
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ?? "",
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  };
}

function bindProductionPostgresStore(): LiveApprovalRequestRepository {
  const env = productionPostgresEnv();
  if (
    !env.SUPABASE_URL ||
    !env.SUPABASE_ANON_KEY ||
    !env.SUPABASE_SERVICE_ROLE_KEY ||
    !isLiveSupabase({
      SUPABASE_URL: env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
    })
  ) {
    notConfigured();
  }
  try {
    const { service } = createDatabaseClients({
      url: env.SUPABASE_URL,
      anonKey: env.SUPABASE_ANON_KEY,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    });
    return new LiveApprovalRequestRepository(service);
  } catch (error) {
    throw new AtlasError(
      "INTEGRATION_ERROR",
      error instanceof Error
        ? error.message
        : "Live approval store is unavailable",
      { statusCode: 503, cause: error },
    );
  }
}

function requireStore(): LiveApprovalRequestRepository {
  if (store !== null) return store;
  if (storeClearedForTests) notConfigured();
  store = bindProductionPostgresStore();
  return store;
}

function rethrowStoreError(error: unknown): never {
  if (error instanceof AtlasError) throw error;
  if (error instanceof LiveApprovalPersistenceError) {
    if (error.kind === "NOT_FOUND") {
      throw new AtlasError("NOT_FOUND", error.message, { statusCode: 404, cause: error });
    }
    if (error.kind === "CONFLICT") {
      throw new AtlasError("CONFLICT", error.message, { statusCode: 409, cause: error });
    }
    throw new AtlasError("INTEGRATION_ERROR", error.message, {
      statusCode: 503,
      cause: error,
    });
  }
  throw new AtlasError(
    "INTEGRATION_ERROR",
    error instanceof Error ? error.message : "Live approval store is unavailable",
    { statusCode: 503, cause: error },
  );
}

function inferRisk(entityType: string, action: string): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  if (action === "DELETE" || action === "EXECUTE") return "HIGH";
  if (action === "UPDATE") return "MEDIUM";
  return entityType === "CONFIGURATION" ? "MEDIUM" : "LOW";
}

/** Creates a new PENDING approval request and writes a unified audit entry. */
export async function createApprovalRequest(
  input: CreateApprovalRequestInput,
): Promise<ApprovalRequest> {
  let request: ApprovalRequest;
  try {
    request = await requireStore().create(input);
  } catch (error) {
    rethrowStoreError(error);
  }

  appendUnifiedAuditEntry({
    type: "approval.requested",
    actorId: input.requestedBy,
    actorKind: "USER",
    reason: input.reason,
    input: {
      approvalId: request.id,
      entityType: input.entityType,
      action: input.action,
      context: request.context,
      artifactHash: request.artifactHash,
      expiresAt: request.expiresAt,
      expectedObservations: request.expectedObservations,
      baselineObservations: request.baselineObservations,
    },
    output: { status: request.status },
    policy: `${input.entityType}.${input.action}`,
    risk: inferRisk(input.entityType, input.action),
    approval: "PENDING",
    result: "SUCCESS",
  });

  return request;
}

/** Lists all approval requests, optionally filtered by status. */
export async function listApprovalRequests(
  status?: ApprovalRequest["status"],
): Promise<ApprovalRequest[]> {
  try {
    return await requireStore().list(status);
  } catch (error) {
    rethrowStoreError(error);
  }
}

/** Looks up a single approval request by id. */
export async function getApprovalRequest(
  id: string,
): Promise<ApprovalRequest | undefined> {
  try {
    return await requireStore().get(id);
  } catch (error) {
    rethrowStoreError(error);
  }
}

/**
 * Records a human decision (approve/reject) on a PENDING approval request.
 * Throws NOT_FOUND if the id doesn't exist, and throws (CONFLICT) if the
 * request isn't PENDING — a decision can only be made once.
 */
export async function decideApprovalRequest(
  id: string,
  input: DecideApprovalRequestInput,
): Promise<ApprovalRequest> {
  let updated: ApprovalRequest;
  try {
    updated = await requireStore().decide(id, input);
  } catch (error) {
    rethrowStoreError(error);
  }

  appendUnifiedAuditEntry({
    type: "approval.decided",
    actorId: input.decidedBy,
    actorKind: "USER",
    reason: input.decisionReason,
    input: {
      approvalId: id,
      entityType: updated.entityType,
      action: updated.action,
      approve: input.approve,
    },
    output: { status: updated.status },
    policy: `${updated.entityType}.${updated.action}`,
    risk: inferRisk(updated.entityType, updated.action),
    approval: updated.status === "APPROVED" ? "APPROVED" : "REJECTED",
    result: "SUCCESS",
  });

  return updated;
}

/**
 * Revokes an approval, moving it to the terminal REVOKED state so it can
 * never authorize an execution again. REVOCATION BEATS APPROVAL.
 */
export async function revokeApprovalRequest(
  id: string,
  input: RevokeApprovalRequestInput,
): Promise<ApprovalRequest> {
  let existing: ApprovalRequest | undefined;
  try {
    existing = await requireStore().get(id);
  } catch (error) {
    rethrowStoreError(error);
  }

  let updated: ApprovalRequest;
  try {
    updated = await requireStore().revoke(id, input);
  } catch (error) {
    rethrowStoreError(error);
  }

  appendUnifiedAuditEntry({
    type: "approval.revoked",
    actorId: input.revokedBy,
    actorKind: "USER",
    reason: input.reason,
    input: {
      approvalId: id,
      entityType: updated.entityType,
      action: updated.action,
      previousStatus: existing?.status ?? null,
      artifactHash: updated.artifactHash,
    },
    output: { status: updated.status },
    policy: `${updated.entityType}.${updated.action}`,
    risk: inferRisk(updated.entityType, updated.action),
    approval: "REJECTED",
    result: "SUCCESS",
  });

  return updated;
}

/**
 * Consumes an APPROVED approval request, flipping it to CONSUMED so it can
 * authorize exactly ONE real action execution (never replayed).
 */
export async function consumeApprovalRequest(
  id: string,
  presented?: PresentedExecution,
): Promise<ApprovalRequest> {
  try {
    return await requireStore().consume(id, presented);
  } catch (error) {
    rethrowStoreError(error);
  }
}


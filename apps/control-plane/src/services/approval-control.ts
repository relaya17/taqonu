/**
 * Control Plane approval overlay.
 *
 * Mirrors `kill-switch-control.ts`: Control never owns the canonical
 * approval store and never decides authorization itself. Every read and
 * decision is a real HTTP call to apps/api's `APPROVAL_CONTROL_PATH` via
 * the existing `callAtlasApi` CP → API SERVICE hop. If that hop fails,
 * this returns `{ ok: false }` — never an empty success list that would
 * look like "no approvals exist".
 *
 * The in-memory `addApprovalRecord` list remains an observational mirror
 * updated after a successful fetch so health/self-audit can see counts.
 * It is not authority.
 */
import {
  APPROVAL_CONTROL_PATH,
  APPROVAL_CONTROL_MINT_PATH,
  approvalControlDecidePath,
} from "@atlas/shared";
import { callAtlasApi } from "./lifecycle-handoff.js";
import {
  replaceApprovalRecords,
  type ApprovalRecord,
} from "./governance-state.js";

export type ApprovalControlResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly reason: string; readonly httpStatus: number };

function httpStatusFromApiFailureReason(reason: string): number {
  const match = /^API returned (\d{3})/.exec(reason);
  return match ? Number(match[1]) : 502;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function mapStatus(status: string): ApprovalRecord["status"] {
  if (status === "APPROVED") return "APPROVED";
  if (status === "CONSUMED" || status === "CLAIMED" || status === "FULFILLED") {
    return "CONSUMED";
  }
  if (
    status === "REJECTED" ||
    status === "REVOKED" ||
    status === "FAILED" ||
    status === "OUTCOME_UNKNOWN"
  ) {
    return "DENIED";
  }
  return "PENDING";
}

function agentIdFromItem(item: Record<string, unknown>): string {
  const context = asRecord(item["context"]);
  const fromContext =
    context !== null
      ? stringField(context, "agentId") ?? stringField(context, "fabricAgentId")
      : null;
  return fromContext ?? stringField(item, "requestedBy") ?? "UNKNOWN";
}

export function toObservationalApprovalRecord(
  item: Record<string, unknown>,
): ApprovalRecord | null {
  const id = stringField(item, "id");
  const entityType = stringField(item, "entityType");
  const action = stringField(item, "action");
  const status = stringField(item, "status");
  const createdAt = stringField(item, "requestedAt") ?? stringField(item, "createdAt");
  if (!id || !entityType || !action || !status || !createdAt) return null;
  return {
    id,
    agentId: agentIdFromItem(item),
    entityType,
    action,
    status: mapStatus(status),
    decidedBy: stringField(item, "decidedBy"),
    createdAt,
    expiresAt: stringField(item, "expiresAt") ?? createdAt,
    artifactHash: stringField(item, "artifactHash") ?? "",
  };
}

function projectObservationalMirror(items: readonly unknown[]): void {
  const records = items
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => item !== null)
    .map(toObservationalApprovalRecord)
    .filter((item): item is ApprovalRecord => item !== null);
  replaceApprovalRecords(records);
}

/**
 * Lists canonical live approvals from apps/api. Query `status` is forwarded
 * unchanged; apps/api validates it against the real status enum.
 */
export async function fetchCanonicalApprovals(filter?: {
  readonly status?: string;
  readonly agentId?: string;
}): Promise<ApprovalControlResult<readonly Record<string, unknown>[]>> {
  const params = new URLSearchParams();
  if (filter?.status) params.set("status", filter.status);
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  const result = await callAtlasApi(`${APPROVAL_CONTROL_PATH}${suffix}`, {
    method: "GET",
  });
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason,
      httpStatus: httpStatusFromApiFailureReason(result.reason),
    };
  }
  const body = asRecord(result.body);
  const items = body !== null && Array.isArray(body["items"]) ? body["items"] : null;
  if (items === null) {
    return { ok: false, reason: "Malformed response from Atlas API", httpStatus: 502 };
  }
  const records = items.filter(
    (item): item is Record<string, unknown> => asRecord(item) !== null,
  );
  const agentId = filter?.agentId;
  const filtered =
    agentId !== undefined
      ? records.filter((item) => agentIdFromItem(item) === agentId)
      : records;
  projectObservationalMirror(filtered);
  return { ok: true, data: filtered };
}

export async function decideCanonicalApproval(input: {
  readonly id: string;
  readonly approve: boolean;
  readonly decidedBy: string;
  readonly reason: string;
}): Promise<ApprovalControlResult<Record<string, unknown>>> {
  const result = await callAtlasApi(approvalControlDecidePath(input.id), {
    method: "POST",
    body: {
      approve: input.approve,
      decidedBy: input.decidedBy,
      reason: input.reason,
    },
  });
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason,
      httpStatus: httpStatusFromApiFailureReason(result.reason),
    };
  }
  const body = asRecord(result.body);
  if (body === null) {
    return { ok: false, reason: "Malformed response from Atlas API", httpStatus: 502 };
  }
  return { ok: true, data: body };
}

export async function mintCanonicalApproval(input: {
  readonly entityType: string;
  readonly action: string;
  readonly requestedBy: string;
  readonly reason: string;
  readonly agentId?: string;
  readonly applicationId?: string;
  readonly operation?: string;
}): Promise<ApprovalControlResult<{ id: string }>> {
  const result = await callAtlasApi(APPROVAL_CONTROL_MINT_PATH, {
    method: "POST",
    body: {
      entityType: input.entityType,
      action: input.action,
      requestedBy: input.requestedBy,
      reason: input.reason,
      ...(input.agentId ? { agentId: input.agentId } : {}),
      ...(input.applicationId ? { applicationId: input.applicationId } : {}),
      ...(input.operation ? { operation: input.operation } : {}),
    },
  });
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason,
      httpStatus: httpStatusFromApiFailureReason(result.reason),
    };
  }
  const body = asRecord(result.body);
  const id = body !== null ? stringField(body, "id") : null;
  if (!id) {
    return { ok: false, reason: "Malformed response from Atlas API", httpStatus: 502 };
  }
  return { ok: true, data: { id } };
}

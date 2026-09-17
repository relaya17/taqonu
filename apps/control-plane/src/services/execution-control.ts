/**
 * Control Plane live-execution overlay.
 *
 * Mirrors kill-switch-control.ts: Control never reads apps/api `osStore`.
 * GET hops to EXECUTION_CONTROL_PATH via the existing callAtlasApi SERVICE hop.
 */
import { EXECUTION_CONTROL_PATH } from "@atlas/shared";
import { callAtlasApi } from "./lifecycle-handoff.js";

export type ExecutionVisibility =
  | "active"
  | "completed"
  | "failed"
  | "blocked"
  | "paused";

export interface CanonicalExecutionItem {
  readonly id: string;
  readonly projectId: string | null;
  readonly mode: string;
  readonly status: string;
  readonly visibility: ExecutionVisibility;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly createdBy: string;
  readonly userRequest: string;
}

export type ExecutionControlResult<T> =
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
  return typeof value === "string" ? value : null;
}

function mapItem(value: unknown): CanonicalExecutionItem | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = stringField(record, "id");
  const mode = stringField(record, "mode");
  const status = stringField(record, "status");
  const visibility = stringField(record, "visibility");
  const startedAt = stringField(record, "startedAt");
  const createdBy = stringField(record, "createdBy");
  const userRequest = stringField(record, "userRequest");
  if (!id || !mode || !status || !visibility || !startedAt || !createdBy || userRequest === null) {
    return null;
  }
  const projectIdRaw = record["projectId"];
  const completedAtRaw = record["completedAt"];
  return {
    id,
    projectId: typeof projectIdRaw === "string" ? projectIdRaw : null,
    mode,
    status,
    visibility: visibility as ExecutionVisibility,
    startedAt,
    completedAt: typeof completedAtRaw === "string" ? completedAtRaw : null,
    createdBy,
    userRequest,
  };
}

export async function fetchCanonicalExecutions(): Promise<
  ExecutionControlResult<{ items: readonly CanonicalExecutionItem[]; total: number }>
> {
  const result = await callAtlasApi(EXECUTION_CONTROL_PATH, { method: "GET" });
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason,
      httpStatus: httpStatusFromApiFailureReason(result.reason),
    };
  }
  const body = asRecord(result.body);
  if (!body || !Array.isArray(body["items"])) {
    return { ok: false, reason: "Malformed response from Atlas API", httpStatus: 502 };
  }
  const items = body["items"]
    .map(mapItem)
    .filter((item): item is CanonicalExecutionItem => item !== null);
  return { ok: true, data: { items, total: items.length } };
}

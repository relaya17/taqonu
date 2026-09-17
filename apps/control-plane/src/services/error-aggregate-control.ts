/**
 * Control Plane error-aggregator overlay.
 * Canonical records live in the API process (`defaultErrorAggregator`).
 */
import { ERROR_AGGREGATE_CONTROL_PATH } from "@atlas/shared";
import { callAtlasApi } from "./lifecycle-handoff.js";

export type ErrorAggregateControlResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly reason: string; readonly httpStatus: number };

function httpStatusFromApiFailureReason(reason: string): number {
  const match = /^API returned (\d{3})/.exec(reason);
  return match ? Number(match[1]) : 502;
}

export async function fetchErrorAggregates(): Promise<
  ErrorAggregateControlResult<Record<string, unknown>>
> {
  const result = await callAtlasApi(ERROR_AGGREGATE_CONTROL_PATH, { method: "GET" });
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason,
      httpStatus: httpStatusFromApiFailureReason(result.reason),
    };
  }
  if (result.body === null || typeof result.body !== "object") {
    return { ok: false, reason: "Malformed response from Atlas API", httpStatus: 502 };
  }
  return { ok: true, data: result.body as Record<string, unknown> };
}

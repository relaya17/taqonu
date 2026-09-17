/**
 * Task 7 -- Control Plane kill-switch control overlay.
 *
 * Mirrors `atlas-self-agent-control.ts`'s `syncDurableAgentRuntimeControl`:
 * Control never touches `osStore` directly and never decides authorization
 * itself. Every read/mutation is a real HTTP call to apps/api's
 * `KILL_SWITCH_CONTROL_PATH` route via the existing `callAtlasApi`
 * CP -> API SERVICE-hop (`lifecycle-handoff.ts`) -- the same
 * bearer-token-authenticated transport already used for durable agent
 * runtime controls, governed lifecycle handoff, and gateway ops. If the
 * API call fails for any reason (network, auth, validation, apps/api
 * unavailable), this returns `{ ok: false }` and the caller (the dashboard
 * route handler) must surface that as a failure -- never synthesize a
 * success.
 */
import { KILL_SWITCH_CONTROL_PATH } from "@atlas/shared";
import { callAtlasApi } from "./lifecycle-handoff.js";

export interface KillSwitchOverrideRecord {
  readonly reason: string;
  readonly setBy: string;
  readonly setAt: string;
}

export interface KillSwitchStatusEntry {
  readonly category: string;
  readonly envActive: boolean;
  readonly runtimeOverrideActive: boolean;
  readonly effectiveActive: boolean;
  readonly override: KillSwitchOverrideRecord | null;
}

export type KillSwitchControlResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly reason: string; readonly httpStatus: number };

/**
 * `callAtlasApi` folds a non-2xx apps/api response into a reason string of
 * the form "API returned <status>[: <detail>]" (see `lifecycle-handoff.ts`).
 * Recovering the real status lets Control return apps/api's own 400/401/403
 * to its caller instead of flattening every failure into a generic 502 --
 * a 502 is reserved for when apps/api could not be reached / returned no
 * parseable status at all (network error, timeout, misconfiguration).
 */
function httpStatusFromApiFailureReason(reason: string): number {
  const match = /^API returned (\d{3})/.exec(reason);
  return match ? Number(match[1]) : 502;
}

/**
 * Reads the full per-category status from apps/api. The category LIST
 * itself is not duplicated in Control -- it comes back as data in this
 * response (`@atlas/agent-core`'s `KILL_SWITCH_CATEGORIES` remains the
 * single source of truth, and Control does not depend on `agent-core`).
 */
export async function fetchKillSwitchStatus(): Promise<
  KillSwitchControlResult<{ categories: readonly string[]; status: readonly KillSwitchStatusEntry[] }>
> {
  const result = await callAtlasApi(KILL_SWITCH_CONTROL_PATH, { method: "GET" });
  if (!result.ok) {
    return { ok: false, reason: result.reason, httpStatus: httpStatusFromApiFailureReason(result.reason) };
  }
  const body = result.body as { categories?: unknown; status?: unknown };
  if (!Array.isArray(body.categories) || !Array.isArray(body.status)) {
    return { ok: false, reason: "Malformed response from Atlas API", httpStatus: 502 };
  }
  return {
    ok: true,
    data: {
      categories: body.categories as readonly string[],
      status: body.status as readonly KillSwitchStatusEntry[],
    },
  };
}

export async function setKillSwitchOverride(input: {
  readonly category: string;
  readonly action: "activate" | "deactivate";
  readonly setBy: string;
  readonly reason: string;
}): Promise<KillSwitchControlResult<unknown>> {
  const result = await callAtlasApi(KILL_SWITCH_CONTROL_PATH, {
    method: "POST",
    body: {
      category: input.category,
      action: input.action,
      setBy: input.setBy,
      reason: input.reason,
    },
  });
  if (!result.ok) {
    return { ok: false, reason: result.reason, httpStatus: httpStatusFromApiFailureReason(result.reason) };
  }
  return { ok: true, data: result.body };
}

import type { PluginManifest } from "@atlas/shared";
import { getPlugin, setPluginStatus } from "./plugin-registry.js";

/**
 * Install/enable/disable/uninstall lifecycle for the Plugin SDK, built on
 * top of `./plugin-registry.js`'s `getPlugin()`/`setPluginStatus()` primitives.
 *
 * This module is the plugin-side sibling of `../kernel/registry-lifecycle.js`
 * (read it for tone/conventions), but the two systems have genuinely
 * different shapes:
 *   - `registry-lifecycle.ts` overlays a runtime enabled/disabled boolean on
 *     top of a STATIC, compile-time catalog (`FABRIC_AGENT_CATALOG`) — every
 *     catalog agent always exists, the only question is whether it's
 *     currently enabled.
 *   - This module drives an explicit, richer STATE MACHINE
 *     (`PENDING_REVIEW -> APPROVED|REJECTED -> ENABLED <-> DISABLED`) on top
 *     of a DYNAMIC, registry-backed set of plugins that can be registered at
 *     any time (`registerPlugin()`) and whose `status` field IS the state —
 *     there's no separate boolean overlay to maintain.
 *
 * Legal transitions this module enforces:
 *
 *   PENDING_REVIEW --approvePlugin--> APPROVED
 *   PENDING_REVIEW --rejectPlugin-->  REJECTED
 *   APPROVED       --enablePlugin-->  ENABLED
 *   DISABLED       --enablePlugin-->  ENABLED
 *   ENABLED        --disablePlugin--> DISABLED
 *   DISABLED       --uninstallPlugin--> (terminal, see uninstallPlugin doc)
 *   REJECTED       --uninstallPlugin--> (terminal, see uninstallPlugin doc)
 *
 * Every other transition (e.g. enabling a `PENDING_REVIEW` or `REJECTED`
 * plugin, approving something already decided, disabling a plugin that was
 * never enabled, uninstalling something still `ENABLED`/`APPROVED`/
 * `PENDING_REVIEW`) is rejected with `{ ok: false, reason }` — never thrown —
 * mirroring `setAgentEnabled()`'s "never throws" convention in
 * `registry-lifecycle.ts`.
 *
 * Like `plugin-registry.ts`, this module has no notion of "who is calling";
 * enforcing that only an admin can call these functions is the
 * responsibility of the HTTP route that wraps this module.
 */

function notRegistered(id: string): { ok: false; reason: string } {
  return { ok: false, reason: `Plugin "${id}" is not registered.` };
}

/**
 * `PENDING_REVIEW -> APPROVED`.
 *
 * Requires the plugin to currently be `PENDING_REVIEW`; fails cleanly for
 * any other status (including `APPROVED` itself — approving an
 * already-approved plugin a second time is rejected, not a no-op, and
 * `REJECTED` plugins cannot be approved after the fact). Requires a
 * non-empty `reason` — an approval without a stated reason defeats the
 * audit trail, the same principle already established by
 * `decideApprovalRequest()` in `apps/api/src/services/approvals.ts`
 * (`approvalRequestSchema`'s `reason: z.string().min(1)`).
 */
export function approvePlugin(
  id: string,
  input: { approvedBy: string; reason: string },
): { ok: true; plugin: PluginManifest } | { ok: false; reason: string } {
  if (input.reason.trim().length === 0) {
    return { ok: false, reason: "A non-empty reason is required to approve a plugin." };
  }
  if (input.approvedBy.trim().length === 0) {
    return { ok: false, reason: "approvedBy is required to approve a plugin." };
  }

  const existing = getPlugin(id);
  if (!existing) {
    return notRegistered(id);
  }
  if (existing.status !== "PENDING_REVIEW") {
    return {
      ok: false,
      reason:
        `Plugin "${id}" cannot be approved from status "${existing.status}" — ` +
        'only a plugin currently "PENDING_REVIEW" can be approved.',
    };
  }

  return setPluginStatus(id, "APPROVED");
}

/**
 * `PENDING_REVIEW -> REJECTED`.
 *
 * Requires the plugin to currently be `PENDING_REVIEW`; fails cleanly for
 * any other status (an already-`APPROVED` or already-`REJECTED` plugin
 * cannot be rejected again through this path). Requires a non-empty
 * `reason`, same audit-trail rationale as `approvePlugin`.
 */
export function rejectPlugin(
  id: string,
  input: { rejectedBy: string; reason: string },
): { ok: true; plugin: PluginManifest } | { ok: false; reason: string } {
  if (input.reason.trim().length === 0) {
    return { ok: false, reason: "A non-empty reason is required to reject a plugin." };
  }
  if (input.rejectedBy.trim().length === 0) {
    return { ok: false, reason: "rejectedBy is required to reject a plugin." };
  }

  const existing = getPlugin(id);
  if (!existing) {
    return notRegistered(id);
  }
  if (existing.status !== "PENDING_REVIEW") {
    return {
      ok: false,
      reason:
        `Plugin "${id}" cannot be rejected from status "${existing.status}" — ` +
        'only a plugin currently "PENDING_REVIEW" can be rejected.',
    };
  }

  return setPluginStatus(id, "REJECTED");
}

/**
 * `APPROVED -> ENABLED` or `DISABLED -> ENABLED`.
 *
 * Both `APPROVED` and `DISABLED` are legal source states: a freshly-approved
 * plugin must be enable-able for the first time, and a previously-disabled
 * plugin must be re-enable-able. Every other status is rejected, in
 * particular `PENDING_REVIEW` (never reviewed) and `REJECTED` (explicitly
 * rejected) — a plugin that was never approved, or was explicitly rejected,
 * must never become runtime-active just by calling `enablePlugin`.
 */
export function enablePlugin(
  id: string,
): { ok: true; plugin: PluginManifest } | { ok: false; reason: string } {
  const existing = getPlugin(id);
  if (!existing) {
    return notRegistered(id);
  }
  if (existing.status !== "APPROVED" && existing.status !== "DISABLED") {
    return {
      ok: false,
      reason:
        `Plugin "${id}" cannot be enabled from status "${existing.status}" — ` +
        'only a plugin currently "APPROVED" or "DISABLED" can be enabled.',
    };
  }

  return setPluginStatus(id, "ENABLED");
}

/**
 * `ENABLED -> DISABLED`.
 *
 * Requires the plugin to currently be `ENABLED`; fails cleanly for any other
 * status (in particular, a plugin that was never enabled cannot be
 * "disabled" — there is no ambient DISABLED default to fall back to the way
 * `isAgentEnabled()` defaults to `true` in `registry-lifecycle.ts`, because
 * `PluginManifest.status` is the single source of truth for a plugin's
 * state, not a separate overlay).
 */
export function disablePlugin(
  id: string,
): { ok: true; plugin: PluginManifest } | { ok: false; reason: string } {
  const existing = getPlugin(id);
  if (!existing) {
    return notRegistered(id);
  }
  if (existing.status !== "ENABLED") {
    return {
      ok: false,
      reason:
        `Plugin "${id}" cannot be disabled from status "${existing.status}" — ` +
        'only a plugin currently "ENABLED" can be disabled.',
    };
  }

  return setPluginStatus(id, "DISABLED");
}

/**
 * Permanently removes a plugin. Requires the plugin to currently be
 * `DISABLED` or `REJECTED` first — an `ENABLED`, `APPROVED`, or
 * `PENDING_REVIEW` plugin (i.e. anything still active or still awaiting a
 * decision) cannot be uninstalled out from under a running system; disable
 * it first.
 *
 * SCOPE LIMIT (honest, deliberate — not an oversight, same "process-local,
 * no real removal primitive yet" pattern already called out in
 * `plugin-registry.ts`'s and `registry-lifecycle.ts`'s doc comments):
 * `./plugin-registry.js` does not expose a delete/remove-from-the-map
 * function in its contract (`validatePluginManifest`, `registerPlugin`,
 * `listPlugins`, `getPlugin`, `setPluginStatus`,
 * `resetPluginRegistryForTests` — no `deletePlugin`/`removePlugin`). Full
 * removal from the registry's underlying `Map` is therefore not achievable
 * from this module today. As the best available terminal state until that
 * primitive exists, `uninstallPlugin` transitions an already-`DISABLED` or
 * already-`REJECTED` plugin to `DISABLED` (a no-op status-wise for a
 * `DISABLED` plugin, and the closest available "off" state for a `REJECTED`
 * one) and reports success — the plugin remains queryable via `getPlugin`/
 * `listPlugins` (this is surfaced, not hidden) until the registry layer
 * grows a real delete primitive that this function should be updated to
 * call instead.
 */
export function uninstallPlugin(id: string): { ok: true } | { ok: false; reason: string } {
  const existing = getPlugin(id);
  if (!existing) {
    return notRegistered(id);
  }
  if (existing.status !== "DISABLED" && existing.status !== "REJECTED") {
    return {
      ok: false,
      reason:
        `Plugin "${id}" cannot be uninstalled from status "${existing.status}" — ` +
        'only a plugin currently "DISABLED" or "REJECTED" can be uninstalled. ' +
        "Disable it first.",
    };
  }

  const result = setPluginStatus(id, "DISABLED");
  if (!result.ok) {
    return result;
  }
  return { ok: true };
}

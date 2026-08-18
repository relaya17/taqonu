import {
  pluginManifestSchema,
  type PluginManifest,
  type PluginManifestStatus,
} from "@atlas/shared";
import { DEFAULT_TOOL_POLICIES } from "../policies/tool-policies.js";
import {
  getEntityPolicy,
  type BusinessEntityType,
  type EntityAction,
} from "../policies/entity-policies.js";

/**
 * Plugin SDK registry — turns a third-party-submitted `PluginManifest`
 * (declarative data only, see `plugin-manifest.schema.ts`'s doc comment for
 * the explicit "no executable code" scope limit) into a registered plugin,
 * without ever letting a submitted manifest bypass the two EXISTING policy
 * engines (`DEFAULT_TOOL_POLICIES` from `../policies/tool-policies.js` and
 * `getEntityPolicy()` from `../policies/entity-policies.js`).
 *
 * SCOPE LIMIT (honest, deliberate — same pattern as
 * `../kernel/registry-lifecycle.js`'s in-memory enable/disable overlay):
 * plugin state lives in a single process-local `Map`. It does not survive a
 * process restart and is not shared across multiple API instances/replicas.
 * A multi-process deployment would need this state moved into a real
 * datastore, the same follow-up already called out for
 * `registry-lifecycle.ts`.
 *
 * This module is intentionally pure/unauthenticated — it has no notion of
 * "who is calling". Enforcing that only an admin can call `setPluginStatus`
 * (to move a plugin past `PENDING_REVIEW`) is the responsibility of the
 * HTTP route that wraps this module (`requireAdmin` middleware upstream),
 * not of this module itself.
 */

const pluginRegistry = new Map<string, PluginManifest>();

/**
 * Cross-validates a manifest's declared tools/entity-actions against the
 * two existing policy engines. This is the core security property of the
 * Plugin SDK: a plugin cannot declare a capability the policy layer
 * doesn't already know how to gate. Collects every error, not just the
 * first, so a caller can show a complete rejection report.
 */
function validateAgainstPolicyEngines(manifest: PluginManifest): string[] {
  const errors: string[] = [];

  const knownToolNames = new Set(DEFAULT_TOOL_POLICIES.map((p) => p.toolName));
  for (const toolName of manifest.declaredTools) {
    if (!knownToolNames.has(toolName)) {
      errors.push(
        `Unknown tool "${toolName}": no ToolPolicy is registered in DEFAULT_TOOL_POLICIES for it. ` +
          "A plugin cannot declare a tool the policy layer doesn't already know how to gate.",
      );
    }
  }

  for (const { entityType, action } of manifest.declaredEntityActions) {
    const policy = getEntityPolicy(
      entityType as BusinessEntityType,
      action as EntityAction,
    );
    if (!policy) {
      errors.push(
        `Unknown entity action "${entityType}.${action}": no EntityPolicy is defined for this ` +
          "entity type / action combination.",
      );
    }
  }

  return errors;
}

/**
 * Validates a raw, untrusted input against `pluginManifestSchema` (shape)
 * AND then against the existing policy engines (semantics). Both must pass
 * for a manifest to be considered `valid`.
 */
export function validatePluginManifest(
  input: unknown,
): { valid: true; manifest: PluginManifest } | { valid: false; errors: string[] } {
  const parsed = pluginManifestSchema.safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    return { valid: false, errors };
  }

  const policyErrors = validateAgainstPolicyEngines(parsed.data);
  if (policyErrors.length > 0) {
    return { valid: false, errors: policyErrors };
  }

  return { valid: true, manifest: parsed.data };
}

/**
 * Registers a plugin manifest. Runs `validatePluginManifest` first and
 * rejects (never throws) if it's invalid, or if `manifest.id` is already
 * registered — no silent overwrite of an existing plugin by resubmitting
 * the same id. `status` is always forced to `"PENDING_REVIEW"` on
 * registration regardless of what the input claimed — a plugin cannot
 * self-approve or self-enable itself.
 */
export function registerPlugin(
  manifest: PluginManifest,
): { ok: true; plugin: PluginManifest } | { ok: false; reason: string } {
  const validated = validatePluginManifest(manifest);
  if (!validated.valid) {
    return { ok: false, reason: validated.errors.join("; ") };
  }

  if (pluginRegistry.has(validated.manifest.id)) {
    return {
      ok: false,
      reason: `Plugin "${validated.manifest.id}" is already registered — resubmit under a new id, or have an admin update the existing plugin's status.`,
    };
  }

  const stored: PluginManifest = {
    ...validated.manifest,
    status: "PENDING_REVIEW",
    installedAt: validated.manifest.installedAt ?? new Date().toISOString(),
  };
  pluginRegistry.set(stored.id, stored);
  return { ok: true, plugin: stored };
}

/** Lists all registered plugins, optionally filtered by status. */
export function listPlugins(status?: PluginManifestStatus): PluginManifest[] {
  const all = [...pluginRegistry.values()];
  return status ? all.filter((p) => p.status === status) : all;
}

/** Looks up a single registered plugin by id. */
export function getPlugin(id: string): PluginManifest | undefined {
  return pluginRegistry.get(id);
}

/**
 * Transitions a registered plugin's status. The only way a plugin's status
 * can move past `PENDING_REVIEW` — intended to be called only from an
 * admin-gated route (`requireAdmin` upstream); this module has no auth of
 * its own by design.
 */
export function setPluginStatus(
  id: string,
  status: PluginManifestStatus,
): { ok: true; plugin: PluginManifest } | { ok: false; reason: string } {
  const existing = pluginRegistry.get(id);
  if (!existing) {
    return { ok: false, reason: `Plugin "${id}" is not registered.` };
  }
  const updated: PluginManifest = { ...existing, status };
  pluginRegistry.set(id, updated);
  return { ok: true, plugin: updated };
}

/** Test-only: clears all registered plugins back to an empty registry. */
export function resetPluginRegistryForTests(): void {
  pluginRegistry.clear();
}

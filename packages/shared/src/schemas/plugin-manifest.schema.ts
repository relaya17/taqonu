import { z } from "zod";
import { isoDateTimeSchema } from "./common.schema.js";
import { patchRiskSchema } from "./patch.schema.js";

/**
 * Plugin SDK manifest — the declarative contract a THIRD PARTY submits to
 * register a new agent/tool/workflow into the Fabric Agent system, instead
 * of the agent being hand-coded into `FABRIC_AGENT_CATALOG`
 * (`@atlas/shared/constants/agents.ts`).
 *
 * SCOPE LIMIT (honest, deliberate — not an oversight): a plugin manifest is
 * pure declarative DATA. It carries no executable code, script, URL to
 * fetch-and-run, or template string — only a name/id/version/author plus
 * arrays of tool names, capability strings, and entity/action pairs the
 * plugin *wants* to be granted. This first version of the SDK does not
 * support arbitrary third-party code execution at all; that is a
 * substantially harder security problem (sandboxing, supply-chain review,
 * resource limits, ...) intentionally left out of scope here rather than
 * half-solved.
 *
 * `declaredTools` and `declaredEntityActions` are NOT validated here against
 * `DEFAULT_TOOL_POLICIES` / `getEntityPolicy()` — those policy engines live
 * in `@atlas/agent-core`, which this package (`@atlas/shared`) cannot import
 * without inverting the dependency direction. This schema only validates
 * *shape* (non-empty strings, kebab-case id, semver-ish version, ...). The
 * real security-relevant cross-check — "does every declared tool/entity-
 * action actually resolve to a known, already-gated policy" — happens in
 * `packages/agent-core/src/plugins/plugin-registry.ts`'s
 * `validatePluginManifest()`, which is the only place a manifest is allowed
 * to become "registered".
 *
 * `declaredCapabilities` deliberately reuses the exact same capability
 * vocabulary as `registeredAgentSchema.permissions`
 * (`./kernel.schema.js`) rather than inventing a parallel one, so a
 * plugin-provided agent's permissions can be compared/merged against a
 * built-in catalog agent's permissions using one shared vocabulary.
 *
 * `riskLevel` reuses `patchRiskSchema` (`./patch.schema.js`) — the same
 * LOW/MEDIUM/HIGH/CRITICAL tier already used by `registeredAgentSchema`'s
 * own `riskLevel` field and by `atlas-eval.schema.ts`, rather than a new
 * risk vocabulary.
 *
 * `status` starts (and after registration, always sits) at
 * `PENDING_REVIEW` — a plugin can never self-approve or self-enable itself
 * just by claiming a different status in its submitted manifest. Moving a
 * plugin past `PENDING_REVIEW` is an explicit, separate, admin-driven
 * action (see `setPluginStatus()` in `plugin-registry.ts`).
 */
export const pluginManifestStatusSchema = z.enum([
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "ENABLED",
  "DISABLED",
]);

/** Same capability vocabulary as `registeredAgentSchema.permissions`. */
export const pluginDeclaredCapabilitySchema = z.enum([
  "READ_REPO",
  "READ_EVIDENCE",
  "WRITE_EVIDENCE",
  "PROPOSE_PATCH",
  "APPLY_PATCH",
  "CALL_EXTERNAL",
  "ESCALATE",
  "JUDGE",
  "ORCHESTRATE",
]);

export const pluginDeclaredEntityActionSchema = z.object({
  entityType: z.string().min(1).max(64),
  action: z.string().min(1).max(64),
});

export const pluginManifestIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{2,63}$/, "id must be kebab-case, 3-64 chars, e.g. my-plugin-id");

export const pluginManifestVersionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, "version must be semver-ish, e.g. 1.0.0");

export const pluginManifestSchema = z.object({
  id: pluginManifestIdSchema,
  name: z.string().min(1).max(120),
  version: pluginManifestVersionSchema,
  description: z.string().min(1).max(2000),
  author: z.string().min(1).max(200),
  declaredTools: z.array(z.string().min(1).max(120)).default([]),
  declaredCapabilities: z.array(pluginDeclaredCapabilitySchema).default([]),
  declaredEntityActions: z.array(pluginDeclaredEntityActionSchema).default([]),
  riskLevel: patchRiskSchema,
  installedAt: isoDateTimeSchema.optional(),
  status: pluginManifestStatusSchema.default("PENDING_REVIEW"),
});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;
export type PluginManifestStatus = z.infer<typeof pluginManifestStatusSchema>;

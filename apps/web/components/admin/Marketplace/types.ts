import type {
  PluginManifest,
  PluginManifestStatus,
} from "@atlas/shared";

export type { PluginManifest, PluginManifestStatus };

/** Same capability vocabulary as `pluginDeclaredCapabilitySchema` in the shared schema. */
export const PLUGIN_CAPABILITIES = [
  "READ_REPO",
  "READ_EVIDENCE",
  "WRITE_EVIDENCE",
  "PROPOSE_PATCH",
  "APPLY_PATCH",
  "CALL_EXTERNAL",
  "ESCALATE",
  "JUDGE",
  "ORCHESTRATE",
] as const;

export const PLUGIN_RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export const PLUGIN_STATUSES: PluginManifestStatus[] = [
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "ENABLED",
  "DISABLED",
];

/** Hebrew labels for each lifecycle status. */
export const STATUS_LABELS: Record<PluginManifestStatus, string> = {
  PENDING_REVIEW: "ממתין לבדיקה",
  APPROVED: "אושר",
  REJECTED: "נדחה",
  ENABLED: "מופעל",
  DISABLED: "מושבת",
};

/** Mirrors `severityColor` in app/admin/page.tsx — color-codes each lifecycle status. */
export function statusColor(
  status: PluginManifestStatus,
): "warning" | "info" | "success" | "default" | "error" {
  if (status === "PENDING_REVIEW") return "warning";
  if (status === "APPROVED") return "info";
  if (status === "ENABLED") return "success";
  if (status === "DISABLED") return "default";
  return "error";
}

/**
 * Which admin actions are legal from a given status — mirrors the exact
 * state machine enforced server-side in
 * `packages/agent-core/src/plugins/plugin-lifecycle.ts`:
 *
 *   PENDING_REVIEW --approve--> APPROVED
 *   PENDING_REVIEW --reject-->  REJECTED
 *   APPROVED       --enable-->  ENABLED
 *   DISABLED       --enable-->  ENABLED
 *   ENABLED        --disable--> DISABLED
 *   DISABLED       --uninstall--> (terminal-ish, stays DISABLED)
 *   REJECTED       --uninstall--> (terminal-ish, becomes DISABLED)
 */
export function legalActions(status: PluginManifestStatus): {
  approve: boolean;
  reject: boolean;
  enable: boolean;
  disable: boolean;
  uninstall: boolean;
} {
  return {
    approve: status === "PENDING_REVIEW",
    reject: status === "PENDING_REVIEW",
    enable: status === "APPROVED" || status === "DISABLED",
    disable: status === "ENABLED",
    uninstall: status === "DISABLED" || status === "REJECTED",
  };
}

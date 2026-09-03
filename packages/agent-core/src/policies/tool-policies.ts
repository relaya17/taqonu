import type { ToolPolicy, ToolRisk } from "@atlas/shared";
import type { BusinessEntityType, EntityAction } from "./entity-policies.js";

/**
 * Default least-privilege tool policies. Write tools always require approval.
 *
 * `entityType` / `action` are canonical governed-operation identity for the
 * tool (ADR: tool → ToolPolicy → pair). They are not approval, occupancy, or
 * execution authority. Pairings are taken from the existing entity taxonomy
 * and production joins (tool-execute tests, gateway DOCUMENT.READ for
 * knowledge_search/analyze_repo, engineering-loop RECORD.EXECUTE, gmail as
 * COMMUNICATION.CREATE). Each pair's EntityPolicy.risk matches this row's
 * `risk` so identity does not fight the entity table.
 */
function policy(
  toolName: string,
  risk: ToolRisk,
  requiresApproval: boolean,
  entityType: BusinessEntityType,
  action: EntityAction,
  rest: {
    readonly timeoutMs: number;
    readonly secretsAccess: ToolPolicy["secretsAccess"];
    readonly allowedCommands?: readonly string[];
  },
): ToolPolicy {
  return {
    toolName,
    risk,
    requiresApproval,
    allowedProjects: [],
    allowedCommands: rest.allowedCommands ?? [],
    timeoutMs: rest.timeoutMs,
    secretsAccess: rest.secretsAccess,
    entityType,
    action,
  };
}

export const DEFAULT_TOOL_POLICIES: readonly ToolPolicy[] = [
  // ── Tool Runtime: read-only filesystem tools ────────────────────────
  // These are enforced at execution time by tools/runtime.ts. They are
  // READ_ONLY and need no approval, but `secretsAccess: "NONE"` is a real
  // control here, not a label: the runtime scans each tool's OUTPUT and
  // denies it if a credential is detected — a `.env` committed into a repo
  // is exactly the case a read tool would otherwise happily return.
  // Canonical pair: DOCUMENT.READ — same cell tool-execute tests already use
  // for fs.read_file, and DOCUMENT is the files/content bucket.
  policy("fs.read_file", "READ_ONLY", false, "DOCUMENT", "READ", {
    timeoutMs: 10_000,
    secretsAccess: "NONE",
  }),
  policy("fs.read_directory", "READ_ONLY", false, "DOCUMENT", "READ", {
    timeoutMs: 10_000,
    secretsAccess: "NONE",
  }),
  policy("fs.search_repo", "READ_ONLY", false, "DOCUMENT", "READ", {
    timeoutMs: 30_000,
    secretsAccess: "NONE",
  }),
  // ── Tool Runtime: mutating / executing tools ────────────────────────
  // Deliberately `requiresApproval: true`. `executeTool()` returns
  // APPROVAL_REQUIRED for these and never runs them — the approval routing
  // itself lives once, in dispatchAgentAction(). No implementation is
  // registered for them yet, so they are doubly unreachable rather than
  // half-governed.
  // fs.write_patch mutates file content → DOCUMENT.UPDATE (HIGH_RISK_WRITE).
  // Code *apply* stays DOCUMENT.EXECUTE on the human write route, which is
  // not this tool.
  policy("fs.write_patch", "HIGH_RISK_WRITE", true, "DOCUMENT", "UPDATE", {
    timeoutMs: 60_000,
    secretsAccess: "NONE",
  }),
  // CI runners match engineering-loop's RECORD.EXECUTE (HIGH_RISK_WRITE).
  policy("ci.run_tests", "HIGH_RISK_WRITE", true, "RECORD", "EXECUTE", {
    timeoutMs: 600_000,
    secretsAccess: "NONE",
    allowedCommands: ["pnpm test", "pnpm exec vitest run"],
  }),
  policy("ci.run_typecheck", "HIGH_RISK_WRITE", true, "RECORD", "EXECUTE", {
    timeoutMs: 300_000,
    secretsAccess: "NONE",
    allowedCommands: ["pnpm exec tsc -p tsconfig.json --noEmit"],
  }),
  policy("ci.run_lint", "HIGH_RISK_WRITE", true, "RECORD", "EXECUTE", {
    timeoutMs: 300_000,
    secretsAccess: "NONE",
    allowedCommands: ["pnpm run lint"],
  }),
  policy("github.getRepository", "READ_ONLY", false, "DOCUMENT", "READ", {
    timeoutMs: 30_000,
    secretsAccess: "NONE",
  }),
  policy("github.searchCode", "READ_ONLY", false, "DOCUMENT", "READ", {
    timeoutMs: 30_000,
    secretsAccess: "NONE",
  }),
  policy("memory.search", "READ_ONLY", false, "RECORD", "READ", {
    timeoutMs: 15_000,
    secretsAccess: "NONE",
  }),
  // Fabric catalog names used by Gateway handoff. Policy exists so
  // executeTool can reach a registered implementation; without a policy the
  // runtime fail-closes before the registry. No new runtime — same table.
  // Gateway map: analyze_repo / knowledge_search → DOCUMENT.READ.
  policy("analyze_repo", "READ_ONLY", false, "DOCUMENT", "READ", {
    timeoutMs: 30_000,
    secretsAccess: "NONE",
  }),
  policy("knowledge_search", "READ_ONLY", false, "DOCUMENT", "READ", {
    timeoutMs: 30_000,
    secretsAccess: "NONE",
  }),
  policy("research.verifiedSearch", "READ_ONLY", false, "DOCUMENT", "READ", {
    timeoutMs: 60_000,
    secretsAccess: "NONE",
  }),
  policy("vercel.deployments.read", "READ_ONLY", false, "RECORD", "READ", {
    timeoutMs: 30_000,
    secretsAccess: "METADATA_ONLY",
  }),
  // Env metadata is configuration-shaped, but CONFIGURATION.READ is
  // LOW_RISK_WRITE in the entity table; this tool is READ_ONLY. RECORD.READ
  // keeps risk identity aligned (operational metadata, not a config mutate).
  policy("vercel.env.read_metadata", "READ_ONLY", false, "RECORD", "READ", {
    timeoutMs: 15_000,
    secretsAccess: "METADATA_ONLY",
  }),
  // Creating a PR mutates an operational record. Gateway's mutating handoff
  // uses RECORD.UPDATE for propose_patch; same cell, this tool name.
  policy("github.create_pr", "HIGH_RISK_WRITE", true, "RECORD", "UPDATE", {
    timeoutMs: 60_000,
    secretsAccess: "NONE",
  }),
  // DESTRUCTIVE execute that is not money or messaging: CONFIGURATION.EXECUTE
  // (kernel/gates already use that cell for "run a control-plane action").
  policy("terminal.execute", "DESTRUCTIVE", true, "CONFIGURATION", "EXECUTE", {
    timeoutMs: 60_000,
    secretsAccess: "DENY_VALUES",
  }),
  // Send is creating a communication. COMMUNICATION.EXECUTE is DESTRUCTIVE;
  // this tool is HIGH_RISK_WRITE → COMMUNICATION.CREATE.
  policy("google.gmail.send", "HIGH_RISK_WRITE", true, "COMMUNICATION", "CREATE", {
    timeoutMs: 30_000,
    secretsAccess: "NONE",
  }),
];

export function getToolPolicy(toolName: string): ToolPolicy | undefined {
  return DEFAULT_TOOL_POLICIES.find((entry) => entry.toolName === toolName);
}

export type CanonicalToolOperation = {
  readonly entityType: BusinessEntityType;
  readonly action: EntityAction;
};

/**
 * Server-authoritative governed operation for a tool. Undefined when there
 * is no ToolPolicy (fail closed — same as `executeTool`).
 */
export function resolveCanonicalToolOperation(
  toolName: string,
): CanonicalToolOperation | undefined {
  const entry = getToolPolicy(toolName);
  if (!entry) return undefined;
  return { entityType: entry.entityType, action: entry.action };
}

export type CanonicalToolOperationResolution =
  | { readonly ok: true; readonly entityType: BusinessEntityType; readonly action: EntityAction }
  | { readonly ok: false; readonly reason: string };

/**
 * Resolve the canonical pair for `toolName`. If the caller asserted a pair,
 * it must match exactly — never rewrite, never continue under the assertion.
 */
export function resolveCanonicalToolOperationForRequest(
  toolName: string,
  asserted?: { readonly entityType: string; readonly action: string },
): CanonicalToolOperationResolution {
  const canonical = resolveCanonicalToolOperation(toolName);
  if (!canonical) {
    return {
      ok: false,
      reason: `No ToolPolicy for "${toolName}". Tools without an explicit policy are denied, not allowed by default.`,
    };
  }
  if (asserted === undefined) {
    return { ok: true, entityType: canonical.entityType, action: canonical.action };
  }
  if (
    asserted.entityType !== canonical.entityType ||
    asserted.action !== canonical.action
  ) {
    return {
      ok: false,
      reason: `Tool "${toolName}" canonical operation is ${canonical.entityType}.${canonical.action}; client asserted ${asserted.entityType}.${asserted.action}`,
    };
  }
  return { ok: true, entityType: canonical.entityType, action: canonical.action };
}

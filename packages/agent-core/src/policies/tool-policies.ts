import type { ToolPolicy } from "@atlas/shared";

/** Default least-privilege tool policies. Write tools always require approval. */
export const DEFAULT_TOOL_POLICIES: readonly ToolPolicy[] = [
  // ── Tool Runtime: read-only filesystem tools ────────────────────────
  // These are enforced at execution time by tools/runtime.ts. They are
  // READ_ONLY and need no approval, but `secretsAccess: "NONE"` is a real
  // control here, not a label: the runtime scans each tool's OUTPUT and
  // denies it if a credential is detected — a `.env` committed into a repo
  // is exactly the case a read tool would otherwise happily return.
  {
    toolName: "fs.read_file",
    risk: "READ_ONLY",
    requiresApproval: false,
    allowedProjects: [],
    allowedCommands: [],
    timeoutMs: 10_000,
    secretsAccess: "NONE",
  },
  {
    toolName: "fs.read_directory",
    risk: "READ_ONLY",
    requiresApproval: false,
    allowedProjects: [],
    allowedCommands: [],
    timeoutMs: 10_000,
    secretsAccess: "NONE",
  },
  {
    toolName: "fs.search_repo",
    risk: "READ_ONLY",
    requiresApproval: false,
    allowedProjects: [],
    allowedCommands: [],
    timeoutMs: 30_000,
    secretsAccess: "NONE",
  },
  // ── Tool Runtime: mutating / executing tools ────────────────────────
  // Deliberately `requiresApproval: true`. `executeTool()` returns
  // APPROVAL_REQUIRED for these and never runs them — the approval routing
  // itself lives once, in dispatchAgentAction(). No implementation is
  // registered for them yet, so they are doubly unreachable rather than
  // half-governed.
  {
    toolName: "fs.write_patch",
    risk: "HIGH_RISK_WRITE",
    requiresApproval: true,
    allowedProjects: [],
    allowedCommands: [],
    timeoutMs: 60_000,
    secretsAccess: "NONE",
  },
  {
    toolName: "ci.run_tests",
    risk: "HIGH_RISK_WRITE",
    requiresApproval: true,
    allowedProjects: [],
    allowedCommands: ["pnpm test", "pnpm exec vitest run"],
    timeoutMs: 600_000,
    secretsAccess: "NONE",
  },
  {
    toolName: "ci.run_typecheck",
    risk: "HIGH_RISK_WRITE",
    requiresApproval: true,
    allowedProjects: [],
    allowedCommands: ["pnpm exec tsc -p tsconfig.json --noEmit"],
    timeoutMs: 300_000,
    secretsAccess: "NONE",
  },
  {
    toolName: "ci.run_lint",
    risk: "HIGH_RISK_WRITE",
    requiresApproval: true,
    allowedProjects: [],
    allowedCommands: ["pnpm run lint"],
    timeoutMs: 300_000,
    secretsAccess: "NONE",
  },
  {
    toolName: "github.getRepository",
    risk: "READ_ONLY",
    requiresApproval: false,
    allowedProjects: [],
    allowedCommands: [],
    timeoutMs: 30_000,
    secretsAccess: "NONE",
  },
  {
    toolName: "github.searchCode",
    risk: "READ_ONLY",
    requiresApproval: false,
    allowedProjects: [],
    allowedCommands: [],
    timeoutMs: 30_000,
    secretsAccess: "NONE",
  },
  {
    toolName: "memory.search",
    risk: "READ_ONLY",
    requiresApproval: false,
    allowedProjects: [],
    allowedCommands: [],
    timeoutMs: 15_000,
    secretsAccess: "NONE",
  },
  // Fabric catalog names used by Gateway handoff. Policy exists so
  // executeTool can reach a registered implementation; without a policy the
  // runtime fail-closes before the registry. No new runtime — same table.
  {
    toolName: "analyze_repo",
    risk: "READ_ONLY",
    requiresApproval: false,
    allowedProjects: [],
    allowedCommands: [],
    timeoutMs: 30_000,
    secretsAccess: "NONE",
  },
  {
    toolName: "knowledge_search",
    risk: "READ_ONLY",
    requiresApproval: false,
    allowedProjects: [],
    allowedCommands: [],
    timeoutMs: 30_000,
    secretsAccess: "NONE",
  },
  {
    toolName: "research.verifiedSearch",
    risk: "READ_ONLY",
    requiresApproval: false,
    allowedProjects: [],
    allowedCommands: [],
    timeoutMs: 60_000,
    secretsAccess: "NONE",
  },
  {
    toolName: "vercel.deployments.read",
    risk: "READ_ONLY",
    requiresApproval: false,
    allowedProjects: [],
    allowedCommands: [],
    timeoutMs: 30_000,
    secretsAccess: "METADATA_ONLY",
  },
  {
    toolName: "vercel.env.read_metadata",
    risk: "READ_ONLY",
    requiresApproval: false,
    allowedProjects: [],
    allowedCommands: [],
    timeoutMs: 15_000,
    secretsAccess: "METADATA_ONLY",
  },
  {
    toolName: "github.create_pr",
    risk: "HIGH_RISK_WRITE",
    requiresApproval: true,
    allowedProjects: [],
    allowedCommands: [],
    timeoutMs: 60_000,
    secretsAccess: "NONE",
  },
  {
    toolName: "terminal.execute",
    risk: "DESTRUCTIVE",
    requiresApproval: true,
    allowedProjects: [],
    allowedCommands: [],
    timeoutMs: 60_000,
    secretsAccess: "DENY_VALUES",
  },
  {
    toolName: "google.gmail.send",
    risk: "HIGH_RISK_WRITE",
    requiresApproval: true,
    allowedProjects: [],
    allowedCommands: [],
    timeoutMs: 30_000,
    secretsAccess: "NONE",
  },
];

export function getToolPolicy(toolName: string): ToolPolicy | undefined {
  return DEFAULT_TOOL_POLICIES.find((policy) => policy.toolName === toolName);
}

import type { ToolPolicy } from "@atlas/shared";

/** Default least-privilege tool policies. Write tools always require approval. */
export const DEFAULT_TOOL_POLICIES: readonly ToolPolicy[] = [
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

/**
 * Agent Registry — canonical view of all registered agents, their
 * capabilities, permissions, and current operational status.
 *
 * The control plane reads agent definitions from the same catalog the
 * engineering surface uses (agent-core's fabric agent registry), but
 * projects an OVERSIGHT view: what can each agent do, what can't it do,
 * what is its risk profile, and what is its historical performance?
 *
 * This is the source of truth for:
 *   - Agent identity and capability enumeration
 *   - Tool permission matrices (allowedTools / forbiddenTools)
 *   - Entity/action permission grids
 *   - Runtime status (active, suspended, degraded)
 *
 * ── Separation from engineering surface ────────────────────────────────
 *
 * The engineering surface (apps/api) RUNS agents. The control plane
 * INSPECTS and GOVERNS them. An engineer asks "what did the code
 * engineer produce?" A manager asks "is the code engineer allowed to
 * write to production, and should it be?"
 */

// ── Types ───────────────────────────────────────────────────────────────

export interface AgentCapability {
  readonly entityType: string;
  readonly action: string;
  readonly riskTier: "AUTO_LOG" | "APPROVAL" | "BLOCK";
}

export type AgentStatus = "ACTIVE" | "SUSPENDED" | "DEGRADED" | "UNKNOWN";

export interface RegisteredAgent {
  readonly agentId: string;
  readonly displayName: string;
  readonly description: string;
  readonly capabilities: readonly AgentCapability[];
  readonly allowedTools: readonly string[];
  readonly forbiddenTools: readonly string[];
  readonly canWriteCode: boolean;
  readonly status: AgentStatus;
  readonly registeredAt: string;
}

// ── Registry ────────────────────────────────────────────────────────────

/**
 * Static registry of known agents and their capability profiles.
 *
 * In production this would read from the fabric catalog dynamically.
 * The static version provides the governance view without requiring
 * the agent-core catalog to be initialized in the control plane process.
 */
const AGENT_DEFINITIONS: readonly RegisteredAgent[] = [
  {
    agentId: "CODE_ENGINEER",
    displayName: "Code Engineer",
    description: "Produces code changes, refactors, and implementations via proposal-first fabric",
    capabilities: [
      { entityType: "RECORD", action: "CREATE", riskTier: "APPROVAL" },
    ],
    allowedTools: ["fs.read_file", "fs.write_file", "shell.run_command"],
    forbiddenTools: ["shell.run_command_as_root"],
    canWriteCode: true,
    status: "ACTIVE",
    registeredAt: "2025-01-01T00:00:00.000Z",
  },
  {
    agentId: "RESEARCHER",
    displayName: "Research Analyst",
    description: "Reads and analyzes documents, produces verified research findings",
    capabilities: [
      { entityType: "DOCUMENT", action: "READ", riskTier: "AUTO_LOG" },
    ],
    allowedTools: ["fs.read_file"],
    forbiddenTools: ["fs.write_file", "shell.run_command"],
    canWriteCode: false,
    status: "ACTIVE",
    registeredAt: "2025-01-01T00:00:00.000Z",
  },
  {
    agentId: "ARCHITECT",
    displayName: "Architect",
    description: "Produces design decision records and architectural proposals",
    capabilities: [
      { entityType: "RECORD", action: "CREATE", riskTier: "APPROVAL" },
    ],
    allowedTools: ["fs.read_file"],
    forbiddenTools: ["shell.run_command"],
    canWriteCode: false,
    status: "ACTIVE",
    registeredAt: "2025-01-01T00:00:00.000Z",
  },
  {
    agentId: "QA_ENGINEER",
    displayName: "QA Engineer",
    description: "Produces test findings and quality assessments as structured records",
    capabilities: [
      { entityType: "RECORD", action: "CREATE", riskTier: "APPROVAL" },
    ],
    allowedTools: ["fs.read_file", "shell.run_command"],
    forbiddenTools: [],
    canWriteCode: false,
    status: "ACTIVE",
    registeredAt: "2025-01-01T00:00:00.000Z",
  },
  {
    agentId: "DEVOPS",
    displayName: "DevOps",
    description: "Analyzes infrastructure configuration (READ-only, does not deploy)",
    capabilities: [
      { entityType: "CONFIGURATION", action: "READ", riskTier: "AUTO_LOG" },
    ],
    allowedTools: ["fs.read_file"],
    forbiddenTools: ["shell.run_command"],
    canWriteCode: false,
    status: "ACTIVE",
    registeredAt: "2025-01-01T00:00:00.000Z",
  },
  {
    agentId: "PRODUCT_MANAGER",
    displayName: "Product Manager",
    description: "Analyzes requirements and scope (READ-only)",
    capabilities: [
      { entityType: "DOCUMENT", action: "READ", riskTier: "AUTO_LOG" },
    ],
    allowedTools: ["fs.read_file"],
    forbiddenTools: ["fs.write_file", "shell.run_command"],
    canWriteCode: false,
    status: "ACTIVE",
    registeredAt: "2025-01-01T00:00:00.000Z",
  },
  {
    agentId: "DATA_ANALYST",
    displayName: "Data Analyst",
    description: "Analyzes data patterns and metrics (READ-only)",
    capabilities: [
      { entityType: "DOCUMENT", action: "READ", riskTier: "AUTO_LOG" },
    ],
    allowedTools: ["fs.read_file"],
    forbiddenTools: ["fs.write_file", "shell.run_command"],
    canWriteCode: false,
    status: "ACTIVE",
    registeredAt: "2025-01-01T00:00:00.000Z",
  },
  {
    agentId: "SECURITY",
    displayName: "Security Sentinel",
    description: "Static security scanner — does not use proposal-first fabric",
    capabilities: [],
    allowedTools: ["fs.read_file"],
    forbiddenTools: ["fs.write_file", "shell.run_command"],
    canWriteCode: false,
    status: "ACTIVE",
    registeredAt: "2025-01-01T00:00:00.000Z",
  },
  {
    agentId: "LEGAL_MEDIA_COMMS",
    displayName: "Legal / Media / Comms",
    description: "Review pipeline for legal and communications — separate from proposal fabric",
    capabilities: [],
    allowedTools: ["fs.read_file"],
    forbiddenTools: ["fs.write_file", "shell.run_command"],
    canWriteCode: false,
    status: "ACTIVE",
    registeredAt: "2025-01-01T00:00:00.000Z",
  },
];

// ── Public API ──────────────────────────────────────────────────────────

export function listRegisteredAgents(): readonly RegisteredAgent[] {
  return AGENT_DEFINITIONS;
}

export function getRegisteredAgent(agentId: string): RegisteredAgent | undefined {
  return AGENT_DEFINITIONS.find((a) => a.agentId === agentId);
}

export function getAgentCapabilities(agentId: string): readonly AgentCapability[] {
  return getRegisteredAgent(agentId)?.capabilities ?? [];
}

/** Summary stats for the registry dashboard. */
export function getRegistryStats(): {
  readonly totalAgents: number;
  readonly activeAgents: number;
  readonly suspendedAgents: number;
  readonly codeWritingAgents: number;
  readonly readOnlyAgents: number;
} {
  const agents = AGENT_DEFINITIONS;
  return {
    totalAgents: agents.length,
    activeAgents: agents.filter((a) => a.status === "ACTIVE").length,
    suspendedAgents: agents.filter((a) => a.status === "SUSPENDED").length,
    codeWritingAgents: agents.filter((a) => a.canWriteCode).length,
    readOnlyAgents: agents.filter((a) =>
      a.capabilities.every((c) => c.action === "READ"),
    ).length,
  };
}

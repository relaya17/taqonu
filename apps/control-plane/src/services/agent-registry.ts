/**
 * Agent Registry — OVERSIGHT snapshot of 9 legacy Control Plane labels.
 *
 * This is NOT the Atlas execution registry and MUST NOT become one.
 * Agents that actually execute inside Atlas are listed only in
 * FABRIC_AGENT_CATALOG. See fabric-projection.ts for the catalog projection.
 *
 * Backward compatible: GET /api/v1/agents still returns these 9 items.
 * Do not silently delete or merge this list into Fabric.
 */

// ── Types ───────────────────────────────────────────────────────────────

export interface AgentCapability {
  readonly entityType: string;
  readonly action: string;
  readonly riskTier: "AUTO_LOG" | "APPROVAL" | "BLOCK";
}

export type AgentStatus =
  | "ACTIVE"
  | "PAUSED"
  | "DISABLED"
  | "REVOKED"
  | "QUARANTINED"
  | "SUSPENDED"
  | "DEGRADED"
  | "UNKNOWN";

/** Capability strings are explicit — an agent is never "admin". */
export const DEFAULT_DENIED_CAPABILITIES = [
  "secrets.read",
  "database.admin",
  "user.delete",
  "deployment.modify",
  "audit.delete",
  "auth.weaken",
] as const;

export interface RegisteredAgent {
  readonly agentId: string;
  readonly displayName: string;
  readonly description: string;
  readonly capabilities: readonly AgentCapability[];
  readonly allowedTools: readonly string[];
  readonly forbiddenTools: readonly string[];
  readonly allowedCapabilities: readonly string[];
  readonly deniedCapabilities: readonly string[];
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
function withCaps(
  agent: Omit<RegisteredAgent, "deniedCapabilities"> & {
    allowedCapabilities: readonly string[];
  },
): RegisteredAgent {
  return {
    ...agent,
    deniedCapabilities: DEFAULT_DENIED_CAPABILITIES,
  };
}

const AGENT_DEFINITIONS: readonly RegisteredAgent[] = [
  withCaps({
    agentId: "CODE_ENGINEER",
    displayName: "Code Engineer",
    description: "Produces code changes, refactors, and implementations via proposal-first fabric",
    capabilities: [
      { entityType: "RECORD", action: "CREATE", riskTier: "APPROVAL" },
    ],
    allowedTools: ["fs.read_file", "fs.write_file", "shell.run_command"],
    forbiddenTools: ["shell.run_command_as_root"],
    allowedCapabilities: ["code.read", "code.propose", "project.read"],
    canWriteCode: true,
    status: "ACTIVE",
    registeredAt: "2025-01-01T00:00:00.000Z",
  }),
  withCaps({
    agentId: "RESEARCHER",
    displayName: "Research Analyst",
    description: "Reads and analyzes documents, produces verified research findings",
    capabilities: [
      { entityType: "DOCUMENT", action: "READ", riskTier: "AUTO_LOG" },
    ],
    allowedTools: ["fs.read_file"],
    forbiddenTools: ["fs.write_file", "shell.run_command"],
    allowedCapabilities: ["document.read", "evidence.read"],
    canWriteCode: false,
    status: "ACTIVE",
    registeredAt: "2025-01-01T00:00:00.000Z",
  }),
  withCaps({
    agentId: "ARCHITECT",
    displayName: "Architect",
    description: "Produces design decision records and architectural proposals",
    capabilities: [
      { entityType: "RECORD", action: "CREATE", riskTier: "APPROVAL" },
    ],
    allowedTools: ["fs.read_file"],
    forbiddenTools: ["shell.run_command"],
    allowedCapabilities: ["architecture.read", "decision.propose"],
    canWriteCode: false,
    status: "ACTIVE",
    registeredAt: "2025-01-01T00:00:00.000Z",
  }),
  withCaps({
    agentId: "QA_ENGINEER",
    displayName: "QA Engineer",
    description: "Produces test findings and quality assessments as structured records",
    capabilities: [
      { entityType: "RECORD", action: "CREATE", riskTier: "APPROVAL" },
    ],
    allowedTools: ["fs.read_file", "shell.run_command"],
    forbiddenTools: [],
    allowedCapabilities: ["test.read", "finding.create"],
    canWriteCode: false,
    status: "ACTIVE",
    registeredAt: "2025-01-01T00:00:00.000Z",
  }),
  withCaps({
    agentId: "DEVOPS",
    displayName: "DevOps",
    description: "Analyzes infrastructure configuration (READ-only, does not deploy)",
    capabilities: [
      { entityType: "CONFIGURATION", action: "READ", riskTier: "AUTO_LOG" },
    ],
    allowedTools: ["fs.read_file"],
    forbiddenTools: ["shell.run_command"],
    allowedCapabilities: ["configuration.read"],
    canWriteCode: false,
    status: "ACTIVE",
    registeredAt: "2025-01-01T00:00:00.000Z",
  }),
  withCaps({
    agentId: "PRODUCT_MANAGER",
    displayName: "Product Manager",
    description: "Analyzes requirements and scope (READ-only)",
    capabilities: [
      { entityType: "DOCUMENT", action: "READ", riskTier: "AUTO_LOG" },
    ],
    allowedTools: ["fs.read_file"],
    forbiddenTools: ["fs.write_file", "shell.run_command"],
    allowedCapabilities: ["document.read"],
    canWriteCode: false,
    status: "ACTIVE",
    registeredAt: "2025-01-01T00:00:00.000Z",
  }),
  withCaps({
    agentId: "DATA_ANALYST",
    displayName: "Data Analyst",
    description: "Analyzes data patterns and metrics (READ-only)",
    capabilities: [
      { entityType: "DOCUMENT", action: "READ", riskTier: "AUTO_LOG" },
    ],
    allowedTools: ["fs.read_file"],
    forbiddenTools: ["fs.write_file", "shell.run_command"],
    allowedCapabilities: ["metrics.read"],
    canWriteCode: false,
    status: "ACTIVE",
    registeredAt: "2025-01-01T00:00:00.000Z",
  }),
  withCaps({
    agentId: "SECURITY",
    displayName: "Security Sentinel",
    description: "Static security scanner — does not use proposal-first fabric",
    capabilities: [],
    allowedTools: ["fs.read_file"],
    forbiddenTools: ["fs.write_file", "shell.run_command"],
    allowedCapabilities: ["security.scan", "finding.create"],
    canWriteCode: false,
    status: "ACTIVE",
    registeredAt: "2025-01-01T00:00:00.000Z",
  }),
  withCaps({
    agentId: "LEGAL_MEDIA_COMMS",
    displayName: "Legal / Media / Comms",
    description: "Review pipeline for legal and communications — separate from proposal fabric",
    capabilities: [],
    allowedTools: ["fs.read_file"],
    forbiddenTools: ["fs.write_file", "shell.run_command"],
    allowedCapabilities: ["document.read"],
    canWriteCode: false,
    status: "ACTIVE",
    registeredAt: "2025-01-01T00:00:00.000Z",
  }),
];

// ── Public API ──────────────────────────────────────────────────────────

export function listRegisteredAgents(): readonly RegisteredAgent[] {
  return AGENT_DEFINITIONS.map(withRuntimeStatus);
}

export function getRegisteredAgent(agentId: string): RegisteredAgent | undefined {
  const agent = AGENT_DEFINITIONS.find((a) => a.agentId === agentId);
  return agent ? withRuntimeStatus(agent) : undefined;
}

const runtimeStatus = new Map<string, AgentStatus>();

function withRuntimeStatus(agent: RegisteredAgent): RegisteredAgent {
  const overlay = runtimeStatus.get(agent.agentId);
  return overlay ? { ...agent, status: overlay } : agent;
}

export function setAgentRuntimeStatus(
  agentId: string,
  status: AgentStatus,
): RegisteredAgent | undefined {
  const agent = AGENT_DEFINITIONS.find((a) => a.agentId === agentId);
  if (!agent) return undefined;
  runtimeStatus.set(agentId, status);
  return withRuntimeStatus(agent);
}

export function resetAgentRuntimeForTests(): void {
  runtimeStatus.clear();
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
  const agents = listRegisteredAgents();
  return {
    totalAgents: agents.length,
    activeAgents: agents.filter((a) => a.status === "ACTIVE").length,
    suspendedAgents: agents.filter(
      (a) => a.status === "SUSPENDED" || a.status === "PAUSED" || a.status === "QUARANTINED",
    ).length,
    codeWritingAgents: agents.filter((a) => a.canWriteCode).length,
    readOnlyAgents: agents.filter((a) =>
      a.capabilities.every((c) => c.action === "READ"),
    ).length,
  };
}

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
  | "RETIRED"
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

// ── Dynamic Control Registration ─────────────────────────────────────────

export type ControlRegistrationSource =
  | "STATIC_CATALOG"
  | "DYNAMIC_API"
  | "PSA_OWNER";

export type ControlRegistrationStatus =
  | "CONTROL_REGISTERED"
  | "CONTROL_REVOKED"
  | "CONTROL_SUSPENDED";

export interface ControlAgentRegistration {
  readonly agentId: string;
  readonly registrationSource: ControlRegistrationSource;
  readonly ownerId: string | null;
  readonly registeredAt: string;
  readonly registeredBy: string;
  readonly evidence: string;
  readonly status: ControlRegistrationStatus;
  readonly idempotencyKey: string;
}

export interface RegisterAgentInControlParams {
  readonly agentId: string;
  readonly registrationSource: ControlRegistrationSource;
  readonly ownerId?: string | null;
  readonly evidence: string;
  readonly registeredBy: string;
}

import {
  openRegistrationStore,
  persistRegistration,
  loadRegistrationByKey,
  loadAllRegistrations,
  clearRegistrationStoreForTests as storeClearForTests,
} from "./registration-store.js";

/**
 * In-process read-cache for dynamic registrations.
 *
 * IMPORTANT: This Map is a cache ONLY. SQLite (registration-store.ts) is the
 * persistent source of truth. On startup, call initDynamicRegistrationCache()
 * to hydrate this Map from the DB.
 *
 * Write invariant: SQLite is written BEFORE the Map is updated.
 * A SQLite failure throws — the Map is never updated on failure.
 *
 * Read invariant: getAgentRegistration and listAgentRegistrations read from
 * SQLite directly. The Map is used only as a fast-path for registerAgentInControl
 * (to skip a redundant INSERT on repeated calls in the same process lifetime).
 */
const dynamicRegistrations = new Map<string, ControlAgentRegistration>();

export function buildIdempotencyKey(agentId: string, ownerId: string | null | undefined): string {
  return ownerId ? `${agentId}::owner::${ownerId}` : agentId;
}

/**
 * Hydrate the in-process cache from the persistent store.
 *
 * Must be called at Control Plane startup, before serving requests.
 * Throws if the DB cannot be opened — do not swallow this error.
 * Safe to call on every restart (idempotent).
 */
export function initDynamicRegistrationCache(): void {
  const persisted = openRegistrationStore(); // throws if DB cannot open
  dynamicRegistrations.clear();
  for (const record of persisted) {
    dynamicRegistrations.set(record.idempotencyKey, record);
  }
}

/**
 * Register an agent in Control.
 *
 * Write order:
 *   1. Persist to SQLite — throws on any DB failure.
 *   2. Update in-process cache ONLY after successful persist.
 *
 * Idempotency: if idempotencyKey already exists in SQLite, the existing record
 * is returned unchanged. Duplicate calls within the same process hit the Map
 * fast path without a DB round-trip. Duplicate calls across restarts hit SQLite's
 * INSERT OR IGNORE and return the original record.
 */
export function registerAgentInControl(
  params: RegisterAgentInControlParams,
): ControlAgentRegistration {
  const ownerId = params.ownerId ?? null;
  const idempotencyKey = buildIdempotencyKey(params.agentId, ownerId);

  // In-process fast path: cache hit after this process already registered it.
  // The cache is populated only after a successful SQLite write, so a cache hit
  // guarantees the record is also in SQLite.
  const cached = dynamicRegistrations.get(idempotencyKey);
  if (cached) return cached;

  // Persist to SQLite first — throws on DB error. Map is not updated on failure.
  const record = persistRegistration({ ...params, idempotencyKey });

  // Only update cache after confirmed successful persist.
  dynamicRegistrations.set(idempotencyKey, record);
  return record;
}

/**
 * Get a single registration.
 *
 * Reads from SQLite — the persistent source of truth.
 * Returns undefined only when the key genuinely does not exist in SQLite.
 * Throws on any DB error — never returns undefined to mask a failure.
 */
export function getAgentRegistration(
  agentId: string,
  ownerId?: string | null,
): ControlAgentRegistration | undefined {
  const key = buildIdempotencyKey(agentId, ownerId ?? null);
  return loadRegistrationByKey(key); // throws on DB error
}

/**
 * List all registrations.
 *
 * Always reads from SQLite — the persistent source of truth.
 * Throws on SQLite failure.
 */
export function listAgentRegistrations(): readonly ControlAgentRegistration[] {
  return loadAllRegistrations(); // throws on DB error
}

/**
 * Clear registrations — for tests ONLY.
 * Clears both the SQLite table and the in-process cache.
 * Never call in production code.
 */
export function clearDynamicRegistrationsForTests(): void {
  storeClearForTests();
  dynamicRegistrations.clear();
}

/**
 * Clear only the in-process Map — for restart simulation tests ONLY.
 * Does NOT touch the SQLite DB file. Use this when simulating a process
 * restart where the DB data must survive (the singleton is already closed
 * by closeRegistrationStoreForTests before calling this).
 * Never call in production code.
 */
export function clearRegistrationCacheOnlyForTests(): void {
  dynamicRegistrations.clear();
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

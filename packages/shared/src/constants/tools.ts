export const TOOL_RISKS = [
  "READ_ONLY",
  "LOW_RISK_WRITE",
  "HIGH_RISK_WRITE",
  "DESTRUCTIVE",
] as const;

export type ToolRisk = (typeof TOOL_RISKS)[number];

/** Gated lifecycle: READ → ANALYZE → PLAN → APPROVE → WRITE → VERIFY */
export const AGENT_MODES = [
  "READ",
  "ANALYZE",
  "PLAN",
  "APPROVE",
  "WRITE",
  "VERIFY",
] as const;

export type AgentMode = (typeof AGENT_MODES)[number];

/** Modes permitted in MVP before evaluation gates unlock WRITE. */
export const MVP_AGENT_MODES = ["READ", "ANALYZE", "PLAN"] as const;

export type MvpAgentMode = (typeof MVP_AGENT_MODES)[number];

export const AUTHORITY_TIERS = ["TIER_1", "TIER_2", "TIER_3", "TIER_4"] as const;

/**
 * Tools the tenant API production startup path is required to register.
 * Catalog entries outside this set remain policy-only: executeTool fail-closes
 * until an implementation is registered. This is not an execution registry.
 */
export const PRODUCTION_IMPLEMENTED_TOOLS = [
  "knowledge_search",
  "fs.read_file",
  "fs.read_directory",
  "fs.search_repo",
  "analyze_repo",
] as const;

export type ProductionImplementedTool = (typeof PRODUCTION_IMPLEMENTED_TOOLS)[number];

export type AuthorityTier = (typeof AUTHORITY_TIERS)[number];

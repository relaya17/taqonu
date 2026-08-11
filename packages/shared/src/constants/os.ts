/** Engineering Intelligence OS subsystems. Agent is one subsystem, not the product. */
export const OS_SUBSYSTEMS = [
  "EVIDENCE",
  "CURRENT_STATE",
  "ENGINEERING_GRAPH",
  "HISTORICAL_MEMORY",
  "PORTFOLIO_INTELLIGENCE",
  "AGENT",
  "SECURITY",
  "CONNECTORS",
] as const;

export type OsSubsystem = (typeof OS_SUBSYSTEMS)[number];

/** MVP connectors only. Others are backlog feeds, not product center. */
export const MVP_CONNECTORS = ["github"] as const;

export const CONNECTOR_BACKLOG = [
  "vercel",
  "render",
  "netlify",
  "verified_knowledge",
  "google",
] as const;

export const GRAPH_NODE_TYPES = [
  "PORTFOLIO",
  "PROJECT",
  "REPOSITORY",
  "PACKAGE",
  "FILE",
  "FEATURE",
  "DECISION",
  "TASK",
  "DEPLOYMENT",
  "INCIDENT",
  "EVIDENCE",
  "MEMORY",
] as const;

export type GraphNodeType = (typeof GRAPH_NODE_TYPES)[number];

export const GRAPH_EDGE_TYPES = [
  "CONTAINS",
  "IMPLEMENTS",
  "DECIDED_BY",
  "TRACKED_BY",
  "DEPLOYED_AS",
  "CAUSED",
  "SUPPORTED_BY",
  "SUPERSEDES",
  "DEPENDS_ON",
  "SAME_PATTERN_AS",
  "DUPLICATES",
] as const;

export type GraphEdgeType = (typeof GRAPH_EDGE_TYPES)[number];

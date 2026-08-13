/**
 * P1.2 — Security Graph policy checks (defensive).
 * EXPOSES_DATA without AUTHENTICATED_BY → HIGH finding.
 */
import type { SoftwareKnowledgeGraph } from "../graph/build.js";

export interface SecurityGraphPolicyFinding {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly severity: "CRITICAL" | "HIGH" | "MEDIUM";
  readonly evidenceRefs: readonly string[];
  readonly claim: "INFERRED";
  readonly epistemicState: "INFERRED";
  readonly apiKey: string;
}

export function evaluateSecurityGraphPolicy(
  graph: SoftwareKnowledgeGraph,
): SecurityGraphPolicyFinding[] {
  const findings: SecurityGraphPolicyFinding[] = [];
  const authApiIds = new Set(
    graph.edges
      .filter((e) => e.type === "AUTHENTICATED_BY")
      .map((e) => e.fromNodeId),
  );

  for (const edge of graph.edges) {
    if (edge.type !== "EXPOSES_DATA") continue;
    const api = graph.nodes.find(
      (n) => n.id === edge.fromNodeId && n.type === "API",
    );
    if (!api) continue;
    if (authApiIds.has(api.id)) continue;
    findings.push({
      id: `security-policy-unauth-data:${api.key}`.slice(0, 180),
      title: `API exposes data without auth edge · ${api.label}`,
      detail:
        "Security Graph policy: API node has EXPOSES_DATA but no AUTHENTICATED_BY edge. Add AuthN/AuthZ middleware and re-observe.",
      severity: "HIGH",
      evidenceRefs: [
        `api:${api.key}`,
        `edge:EXPOSES_DATA:${edge.id}`,
        "policy:EXPOSES_DATA_requires_AUTHENTICATED_BY",
      ],
      claim: "INFERRED",
      epistemicState: "INFERRED",
      apiKey: api.key,
    });
  }

  return findings.slice(0, 25);
}

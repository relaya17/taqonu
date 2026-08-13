import { computeRiskScore, type RiskBand } from "@atlas/code-intelligence";
import type { BehaviorDifference } from "@atlas/shared";
import {
  computeGraphImpact,
  type SoftwareKnowledgeGraph,
} from "../graph/build.js";

export function impactBoostForFlow(
  graph: SoftwareKnowledgeGraph,
  flowId: string,
): { nodeCount: number; edgeCount: number; evidenceNotes: string[] } {
  const api = graph.nodes.find(
    (n) => n.type === "API" && (n.key === flowId || n.label === flowId),
  );
  if (!api) {
    return {
      nodeCount: 0,
      edgeCount: 0,
      evidenceNotes: [`No API node in graph for ${flowId} (INFERRED gap).`],
    };
  }
  const impact = computeGraphImpact({
    graph,
    rootNodeId: api.id,
    depth: 3,
    direction: "BOTH",
  });
  return {
    nodeCount: impact.nodes.length,
    edgeCount: impact.edges.length,
    evidenceNotes: [
      `API node ${api.key}`,
      `Transitive impact: ${impact.nodes.length} nodes / ${impact.edges.length} edges`,
      ...impact.nodes
        .filter(
          (n) => n.type === "FILE" || n.type === "FUNCTION" || n.type === "TEST",
        )
        .slice(0, 6)
        .map((n) => `${n.type}:${n.key}`),
    ],
  };
}

function rank(b: string): number {
  return b === "CRITICAL" ? 4 : b === "HIGH" ? 3 : b === "MEDIUM" ? 2 : 1;
}

export function scoreRiskWithGraph(input: {
  behaviorDiffs: readonly BehaviorDifference[];
  openHighBugs: number;
  graph: SoftwareKnowledgeGraph;
  hasPrevious: boolean;
  apiCount: number;
}): {
  score: number;
  band: RiskBand;
  bar: string;
  evidenceNotes: string[];
  impactNodeTotal: number;
} {
  let impactNodeTotal = 0;
  const evidenceNotes: string[] = [];
  let maxBand: RiskBand = "LOW";

  for (const d of input.behaviorDiffs) {
    const boost = impactBoostForFlow(input.graph, d.flowId);
    impactNodeTotal += boost.nodeCount;
    evidenceNotes.push(...boost.evidenceNotes.map((n) => `${d.flowId}: ${n}`));
    if (rank(d.riskBand) > rank(maxBand)) maxBand = d.riskBand;
    if (boost.nodeCount >= 8 && rank(maxBand) < rank("HIGH")) {
      maxBand = "HIGH";
      evidenceNotes.push(
        `${d.flowId}: elevated to HIGH — wide transitive blast radius (${boost.nodeCount} nodes).`,
      );
    }
  }

  if (input.openHighBugs > 0 && rank(maxBand) < rank("HIGH")) maxBand = "HIGH";

  const risk = computeRiskScore({
    impact:
      maxBand === "CRITICAL"
        ? 5
        : maxBand === "HIGH"
          ? 4
          : input.behaviorDiffs.length
            ? 3
            : 2,
    probability: input.behaviorDiffs.length ? 3 : 2,
    changeSurface: Math.min(
      5,
      1 + input.behaviorDiffs.length + Math.floor(impactNodeTotal / 6),
    ),
    uncertainty: input.hasPrevious ? 2 : 4,
    missingEvidence: input.apiCount === 0 ? 4 : evidenceNotes.length ? 1 : 3,
  });

  return {
    score: risk.score,
    band: risk.band,
    bar: risk.bar,
    evidenceNotes: evidenceNotes.slice(0, 24),
    impactNodeTotal,
  };
}

import { loadSoftwareKnowledgeGraph } from "../graph/build.js";
import { detectProductionSignals } from "../production/signals.js";
import { detectAdrConflicts } from "../memory/adr-conflict.js";
import type { BehaviorDifference } from "@atlas/shared";

export interface P1TruthSignals {
  authEdges: number;
  sensitiveEdges: number;
  decisionNodes: number;
  decidedByEdges: number;
  identityNodes: number;
  dataStoreNodes: number;
  adrConflicts: number;
  productionPresent: number;
  productionMissing: number;
  missingTitles: string[];
}

export function collectP1TruthSignals(
  workspaceRoot: string,
  behaviorDiffs: BehaviorDifference[] = [],
): P1TruthSignals {
  const graph = loadSoftwareKnowledgeGraph(workspaceRoot);
  const authEdges =
    graph?.edges.filter((e) => e.type === "AUTHENTICATED_BY").length ?? 0;
  const sensitiveEdges =
    graph?.edges.filter((e) => e.type === "EXPOSES_DATA").length ?? 0;
  const decisionNodes =
    graph?.nodes.filter((n) => n.type === "DECISION").length ?? 0;
  const decidedByEdges =
    graph?.edges.filter((e) => e.type === "DECIDED_BY").length ?? 0;
  const identityNodes =
    graph?.nodes.filter((n) => n.type === "IDENTITY").length ?? 0;
  const dataStoreNodes =
    graph?.nodes.filter((n) => n.type === "DATA_STORE").length ?? 0;
  const adrConflicts = detectAdrConflicts(workspaceRoot, behaviorDiffs).length;
  const prod = detectProductionSignals(workspaceRoot);
  const missing = prod.filter((s) => !s.present);
  return {
    authEdges,
    sensitiveEdges,
    decisionNodes,
    decidedByEdges,
    identityNodes,
    dataStoreNodes,
    adrConflicts,
    productionPresent: prod.filter((s) => s.present).length,
    productionMissing: missing.length,
    missingTitles: missing.map((s) => s.title),
  };
}

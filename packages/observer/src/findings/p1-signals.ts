import { loadSoftwareKnowledgeGraph } from "../graph/build.js";
import { detectProductionSignals } from "../production/signals.js";
import {
  loadDeployEvents,
  summarizeLastDeploy,
} from "../production/deploy-events.js";
import { detectAdrConflicts } from "../memory/adr-conflict.js";
import type { BehaviorDifference } from "@atlas/shared";

export interface P1TruthSignals {
  authEdges: number;
  sensitiveEdges: number;
  decisionNodes: number;
  decidedByEdges: number;
  identityNodes: number;
  dataStoreNodes: number;
  deploymentNodes: number;
  adrConflicts: number;
  productionPresent: number;
  productionMissing: number;
  missingTitles: string[];
  lastDeploy: {
    provider: string;
    environment: string;
    status: string;
    observedAt: string;
  } | null;
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
  const deploymentNodes =
    graph?.nodes.filter((n) => n.type === "DEPLOYMENT").length ?? 0;
  const adrConflicts = detectAdrConflicts(workspaceRoot, behaviorDiffs).length;
  const prod = detectProductionSignals(workspaceRoot);
  const missing = prod.filter((s) => !s.present);
  const deploy = summarizeLastDeploy(loadDeployEvents(workspaceRoot));
  return {
    authEdges,
    sensitiveEdges,
    decisionNodes,
    decidedByEdges,
    identityNodes,
    dataStoreNodes,
    deploymentNodes,
    adrConflicts,
    productionPresent: prod.filter((s) => s.present).length,
    productionMissing: missing.length,
    missingTitles: missing.map((s) => s.title),
    lastDeploy: deploy.last
      ? {
          provider: deploy.last.provider,
          environment: deploy.last.environment,
          status: deploy.last.status,
          observedAt: deploy.last.observedAt,
        }
      : null,
  };
}

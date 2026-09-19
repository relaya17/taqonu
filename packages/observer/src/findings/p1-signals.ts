import { loadSoftwareKnowledgeGraph } from "../graph/build.js";
import { detectProductionSignals } from "../production/signals.js";
import {
  loadDeployEvents,
  summarizeLastDeploy,
} from "../production/deploy-events.js";
import { detectAdrConflicts } from "../memory/adr-conflict.js";
import type { BehaviorDifference } from "@atlas/shared";
import { loadSentinelLastScan } from "../security/persist.js";

export interface P1TruthSignals {
  authEdges: number;
  sensitiveEdges: number;
  decisionNodes: number;
  decidedByEdges: number;
  identityNodes: number;
  dataStoreNodes: number;
  deploymentNodes: number;
  packageNodes: number;
  advisoryIncidents: number;
  adrConflicts: number;
  productionPresent: number;
  productionMissing: number;
  missingTitles: string[];
  sentinelPosture: string;
  sentinelCritical: number;
  sentinelHigh: number;
  sentinelSecrets: number;
  sentinelAuthz: number;
  sentinelDeps: number;
  sentinelConfig: number;
  isolationDenied: number;
  isolationBound: number;
  isolationAuditTotal: number;
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
  isolation?: {
    readonly denied: number;
    readonly bound: number;
    readonly total: number;
  },
  options?: { readonly deadlineMs?: number },
): P1TruthSignals {
  const deadline = options?.deadlineMs ?? Date.now() + 4_000;
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
  const packageNodes =
    graph?.nodes.filter((n) => n.type === "PACKAGE").length ?? 0;
  const advisoryIncidents =
    graph?.nodes.filter(
      (n) =>
        n.type === "INCIDENT" &&
        n.properties?.kind === "dependency_advisory",
    ).length ?? 0;
  const adrConflicts =
    Date.now() > deadline
      ? 0
      : detectAdrConflicts(workspaceRoot, behaviorDiffs).length;
  const prod =
    Date.now() > deadline ? [] : detectProductionSignals(workspaceRoot);
  const missing = prod.filter((s) => !s.present);
  const deploy = summarizeLastDeploy(loadDeployEvents(workspaceRoot));
  // GET Observer must not run a live Sentinel walk. A missing last-scan is
  // NOT_RUN — never a silent full-repo scan that can stall the API event loop.
  const last = loadSentinelLastScan(workspaceRoot);
  return {
    authEdges,
    sensitiveEdges,
    decisionNodes,
    decidedByEdges,
    identityNodes,
    dataStoreNodes,
    deploymentNodes,
    packageNodes,
    advisoryIncidents,
    adrConflicts,
    productionPresent: prod.filter((s) => s.present).length,
    productionMissing: missing.length,
    missingTitles: missing.map((s) => s.title),
    sentinelPosture: last?.posture ?? "NOT_RUN",
    sentinelCritical: last?.counts.critical ?? 0,
    sentinelHigh: last?.counts.high ?? 0,
    sentinelSecrets: last?.counts.secrets ?? 0,
    sentinelAuthz: last?.counts.authz ?? 0,
    sentinelDeps: last?.counts.dependencies ?? 0,
    sentinelConfig: last?.counts.config ?? 0,
    isolationDenied: isolation?.denied ?? 0,
    isolationBound: isolation?.bound ?? 0,
    isolationAuditTotal: isolation?.total ?? 0,
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

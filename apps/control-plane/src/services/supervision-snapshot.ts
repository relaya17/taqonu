/**
 * Platform-level Control snapshot for Atlas Admin.
 *
 * This is a supervision contract, not Control's operational dashboard.
 * Admin must consume this — not /applications + /agents + /portfolio-governance.
 */

import {
  ATLAS_PLATFORM_HIERARCHY,
  ATLAS_SURFACE_ROLES,
  type PlatformSupervisionSnapshot,
} from "@atlas/shared";
import { getRegistryStats } from "./agent-registry.js";
import { listRegisteredApplications } from "./application-registry.js";
import { getFabricProjection } from "./fabric-projection.js";
import {
  computeHealthMetrics,
  getAuditEntryCount,
  listApprovalRecords,
} from "./governance-state.js";
import {
  civioAcceptedEventCount,
  listObservedCivioProcesses,
} from "./civio-connector.js";
import { listSupervisedProcesses } from "./process-registry.js";
import { listSupervisedGovernanceDecisions } from "./supervised-governance.js";

export function buildControlSupervisionSnapshot(
  origin = ATLAS_PLATFORM_HIERARCHY.CONTROL.defaultOrigin,
): PlatformSupervisionSnapshot {
  const stats = getRegistryStats();
  const health = computeHealthMetrics();
  const applications = listRegisteredApplications();
  const processHealth: PlatformSupervisionSnapshot["health"] =
    health.failedExecutions > 0 ? "degraded" : "healthy";

  return {
    surface: "CONTROL",
    parentSurface: "ADMIN",
    role: ATLAS_SURFACE_ROLES.CONTROL,
    runtime: ATLAS_PLATFORM_HIERARCHY.CONTROL.runtime,
    origin,
    reachability: "REACHABLE",
    health: processHealth,
    generatedAt: new Date().toISOString(),
    metrics: {
      registeredApplications: applications.length,
      oversightAgents: stats.totalAgents,
      activeOversightAgents: stats.activeAgents,
      fabricProjectionAgents: getFabricProjection().items.length,
      pendingApprovals: listApprovalRecords({ status: "PENDING" }).length,
      auditEntries: getAuditEntryCount(),
      civioEventsAccepted: civioAcceptedEventCount(),
      civioProcessesObserved: listObservedCivioProcesses().length,
      supervisedProcesses: listSupervisedProcesses().length,
      supervisedGovernanceDecisions: listSupervisedGovernanceDecisions().length,
    },
    notes: [
      "Operational supervision layer. Not Atlas Admin. Not Studio.",
      "registeredApplications is the Control registry, not a live sibling connector.",
      "oversightAgents is the legacy 9-label list. fabricProjectionAgents is FABRIC_AGENT_CATALOG (not executable from this snapshot).",
      "Civio HMAC ingress: POST /api/v1/connectors/civio/events. Processes: GET /api/v1/processes.",
      "A Civio process is registered by civio.process.started. Later events attach only to that application-scoped process.",
    ],
  };
}

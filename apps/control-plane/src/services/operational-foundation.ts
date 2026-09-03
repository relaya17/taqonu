/**
 * Control operational foundation — contracts assembled from existing services.
 * Does not invent live sibling connections.
 */

import {
  CONTROL_OPERATIONAL_LIFECYCLE,
  CONTROL_SUPERVISION_MODES,
  civioConnectorFoundationStatus,
  controlOperationalDomainContracts,
  type ControlOperationalFoundation,
  type SupervisedProcess,
} from "@atlas/shared";
import { listRegisteredApplications } from "./application-registry.js";
import { civioAcceptedEventCount } from "./civio-connector.js";
import { listSupervisedProcesses as listProcessRecords } from "./process-registry.js";

export interface ControlProcessList {
  readonly items: readonly SupervisedProcess[];
  readonly live: boolean;
  readonly note: string;
}

export function listSupervisedProcesses(): ControlProcessList {
  const items = listProcessRecords();
  return {
    items,
    live: items.length > 0,
    note:
      items.length > 0
        ? "Process records observed from accepted connector events. Application-scoped. /process-audit remains a local QA file scan."
        : "No observed processes. Atlas /process-audit is a local QA file scan, not Control process supervision. Register a process with civio.process.started before attaching events.",
  };
}

export function buildControlOperationalFoundation(): ControlOperationalFoundation & {
  readonly registeredApplicationIds: readonly string[];
} {
  const applications = listRegisteredApplications();
  const observed = listProcessRecords();
  const accepted = civioAcceptedEventCount();
  const domains = controlOperationalDomainContracts().map((domain) => {
    if (domain.domain === "processes" && observed.length > 0) {
      return {
        ...domain,
        status: "PARTIAL" as const,
        live: true,
        notes: [
          "Process records observed from accepted connector events.",
          "Identity is application + tenant + project + process. /process-audit is still a local QA file scan.",
        ],
      };
    }
    if (domain.domain === "events" && accepted > 0) {
      return {
        ...domain,
        live: true,
        notes: [
          "At least one authenticated Civio event was accepted on this Control process.",
          "Generic POST /api/v1/gateway/events is not Civio identity.",
        ],
      };
    }
    if (domain.domain === "applications" && applications.some((app) => app.applicationId === "civio")) {
      return {
        ...domain,
        notes: [
          "Control application registry includes Atlas-self (def-000) and Civio after an accepted HMAC event.",
          "Portfolio inventory is not a live connector.",
        ],
      };
    }
    return domain;
  });
  return {
    kind: "ATLAS_CONTROL_OPERATIONAL_FOUNDATION",
    parentSurface: "ADMIN",
    surface: "CONTROL",
    notStudio: true,
    notAdminDashboard: true,
    lifecycle: CONTROL_OPERATIONAL_LIFECYCLE,
    supervisionModes: CONTROL_SUPERVISION_MODES,
    domains,
    liveSiblingConnectors: false,
    civioConnector: civioConnectorFoundationStatus(),
    generatedAt: new Date().toISOString(),
    registeredApplicationIds: applications.map((app) => app.applicationId),
  };
}

/**
 * Control operational foundation — contracts assembled from existing services.
 * Does not invent live sibling connections or process records.
 */

import {
  CONTROL_OPERATIONAL_LIFECYCLE,
  CONTROL_SUPERVISION_MODES,
  controlOperationalDomainContracts,
  type ControlOperationalFoundation,
} from "@atlas/shared";
import { listRegisteredApplications } from "./application-registry.js";

export interface ControlProcessList {
  readonly items: readonly [];
  readonly live: false;
  readonly note: string;
}

export function listSupervisedProcesses(): ControlProcessList {
  return {
    items: [],
    live: false,
    note: "No live process store. Atlas /process-audit is a local QA file scan, not Control process supervision.",
  };
}

export function buildControlOperationalFoundation(): ControlOperationalFoundation & {
  readonly registeredApplicationIds: readonly string[];
} {
  const applications = listRegisteredApplications();
  return {
    kind: "ATLAS_CONTROL_OPERATIONAL_FOUNDATION",
    parentSurface: "ADMIN",
    surface: "CONTROL",
    notStudio: true,
    notAdminDashboard: true,
    lifecycle: CONTROL_OPERATIONAL_LIFECYCLE,
    supervisionModes: CONTROL_SUPERVISION_MODES,
    domains: controlOperationalDomainContracts(),
    liveSiblingConnectors: false,
    generatedAt: new Date().toISOString(),
    registeredApplicationIds: applications.map((app) => app.applicationId),
  };
}

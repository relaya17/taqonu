/**
 * Atlas Control operational supervision contracts.
 *
 * Control is the operational layer under Admin. It is not Studio and not Admin.
 * These contracts describe capability and lifecycle. They are not live
 * sibling-application connections.
 */

export const CONTROL_OPERATIONAL_LIFECYCLE = [
  "APPLICATION",
  "PROCESS",
  "EVENT",
  "CONTROL",
  "POLICY",
  "RISK",
  "DECISION",
  "APPROVAL",
  "EXECUTION",
  "VERIFICATION",
  "EVIDENCE",
  "AUDIT",
] as const;
export type ControlOperationalLifecycleStage =
  (typeof CONTROL_OPERATIONAL_LIFECYCLE)[number];

/**
 * Per-request authority graph (existing). Control operational lifecycle is the
 * supervision loop. Both apply; neither replaces the other.
 */
export const OPERATING_CYCLE_TO_CONTROL_LIFECYCLE = {
  IDENTITY: "CONTROL",
  AUTHORIZATION: "CONTROL",
  POLICY: "POLICY",
  RISK: "RISK",
  DECISION: "DECISION",
  APPROVAL: "APPROVAL",
  PLAN: "EXECUTION",
  EXECUTE: "EXECUTION",
  EVIDENCE: "EVIDENCE",
  VERIFY: "VERIFICATION",
  REGRESSION: "VERIFICATION",
  AUDIT: "AUDIT",
  MEMORY: "AUDIT",
} as const;

export const CONTROL_SUPERVISION_MODES = [
  "OBSERVE",
  "MONITOR",
  "GOVERN",
  "ALLOW",
  "BLOCK",
  "EXECUTE",
  "VERIFY",
  "AUDIT",
] as const;
export type ControlSupervisionMode = (typeof CONTROL_SUPERVISION_MODES)[number];

export const CONTROL_OPERATIONAL_DOMAINS = [
  "applications",
  "agents",
  "processes",
  "events",
  "policies",
  "risk",
  "approvals",
  "execution",
  "verification",
  "evidenceAudit",
] as const;
export type ControlOperationalDomain = (typeof CONTROL_OPERATIONAL_DOMAINS)[number];

export const CONTROL_DOMAIN_STATUS = [
  "IMPLEMENTED",
  "PARTIAL",
  "MISSING",
] as const;
export type ControlDomainStatus = (typeof CONTROL_DOMAIN_STATUS)[number];

export const CONTROL_APPLICATION_EVENT_TYPES = [
  "application.registered",
  "application.health",
  "agent.started",
  "agent.completed",
  "agent.failed",
  "tool.executed",
  "finding.created",
  "security.alert",
  "test.failed",
  "deployment.changed",
  "proposal.created",
  "verification.completed",
] as const;
export type ControlApplicationEventType =
  (typeof CONTROL_APPLICATION_EVENT_TYPES)[number];

export interface ControlDomainContract {
  readonly domain: ControlOperationalDomain;
  readonly status: ControlDomainStatus;
  readonly live: false | true;
  readonly route: string;
  readonly notes: readonly string[];
}

export interface ControlOperationalFoundation {
  readonly kind: "ATLAS_CONTROL_OPERATIONAL_FOUNDATION";
  readonly parentSurface: "ADMIN";
  readonly surface: "CONTROL";
  readonly notStudio: true;
  readonly notAdminDashboard: true;
  readonly lifecycle: typeof CONTROL_OPERATIONAL_LIFECYCLE;
  readonly supervisionModes: typeof CONTROL_SUPERVISION_MODES;
  readonly domains: readonly ControlDomainContract[];
  readonly liveSiblingConnectors: false;
  readonly generatedAt: string;
}

export function controlOperationalDomainContracts(): readonly ControlDomainContract[] {
  return [
    {
      domain: "applications",
      status: "PARTIAL",
      live: false,
      route: "GET /api/v1/applications",
      notes: [
        "Control application registry. Seeded Atlas-self (def-000) only.",
        "Portfolio inventory is not a live connector.",
      ],
    },
    {
      domain: "agents",
      status: "PARTIAL",
      live: false,
      route: "GET /api/v1/agents",
      notes: [
        "Legacy 9-label oversight list plus FABRIC_AGENT_CATALOG projection.",
        "Not a Personal Supervising Agent. Not Studio developer agents.",
      ],
    },
    {
      domain: "processes",
      status: "MISSING",
      live: false,
      route: "GET /api/v1/processes",
      notes: [
        "No live process store. /process-audit is a local QA file scan, not process supervision.",
      ],
    },
    {
      domain: "events",
      status: "PARTIAL",
      live: false,
      route: "POST /api/v1/gateway/events",
      notes: [
        "Gateway ingest exists. There is no sibling event feed.",
        "An audit log is not process monitoring.",
      ],
    },
    {
      domain: "policies",
      status: "PARTIAL",
      live: false,
      route: "GET /api/v1/policies",
      notes: ["In-memory Control policy catalog for entity/action pairs."],
    },
    {
      domain: "risk",
      status: "PARTIAL",
      live: false,
      route: "POST /api/v1/gateway/ops",
      notes: ["Risk is evaluated inside evaluateOperatingCycle / gateway, not a standalone product."],
    },
    {
      domain: "approvals",
      status: "PARTIAL",
      live: false,
      route: "GET /api/v1/approvals",
      notes: ["Control approval records are in-process. Not the tenant API approval Map."],
    },
    {
      domain: "execution",
      status: "PARTIAL",
      live: false,
      route: "POST /api/v1/gateway/ops",
      notes: [
        "ALLOW writes hand off as HANDED_OFF_GOVERNED. Control does not run tools.",
        "The CP → /api/v1/gateway/fulfill hop is not a live production path yet.",
      ],
    },
    {
      domain: "verification",
      status: "PARTIAL",
      live: false,
      route: "GET /api/v1/supervision",
      notes: ["Observe-path receipts exist. Mutation verification is incomplete without fulfill."],
    },
    {
      domain: "evidenceAudit",
      status: "PARTIAL",
      live: false,
      route: "GET /api/v1/audit",
      notes: [
        "Control in-memory hash chain. Canonical tenant audit is API NDJSON.",
        "Periodic CP→API audit sync is not started from the Control server.",
      ],
    },
  ];
}

/**
 * Generic managed-application registry for the Control Plane.
 * Not a HotelOS-specific dashboard — any Atlas-managed app uses this shape.
 */

export type ApplicationHealth = "healthy" | "degraded" | "down" | "unknown";

export type ApplicationTrustStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface RegisteredApplication {
  readonly applicationId: string;
  readonly name: string;
  readonly environment: string;
  readonly version: string;
  readonly health: ApplicationHealth;
  readonly agentIds: readonly string[];
  readonly capabilities: readonly string[];
  readonly findingCount: number;
  readonly lastAuditAt: string | null;
  readonly lastEventAt: string | null;
  readonly lastEventType: string | null;
  readonly tenantId: string | null;
  readonly projectId: string | null;
  readonly trustStatus: ApplicationTrustStatus;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly decisionReason: string | null;
}

const ATLAS_SELF: RegisteredApplication = {
  applicationId: "def-000",
  name: "Atlas (DEF-000)",
  environment: "control",
  version: "0.1.0",
  health: "unknown",
  agentIds: [],
  capabilities: ["self-audit", "governance", "egress-policy"],
  findingCount: 0,
  lastAuditAt: null,
  lastEventAt: null,
  lastEventType: null,
  tenantId: "atlas",
  projectId: null,
  trustStatus: "APPROVED",
  decidedBy: "system",
  decidedAt: null,
  decisionReason: "Seeded Atlas-self (DEF-000) is the Control Plane identity.",
};

const CASEFLOW_SIBLING: RegisteredApplication = {
  applicationId: "caseflow",
  name: "CaseFlow",
  environment: "sibling-runtime",
  version: "unknown",
  health: "unknown",
  agentIds: [],
  capabilities: [
    "portfolio-observability",
    "application-preflight",
    "hmac-connector",
    "governance-evidence",
  ],
  findingCount: 0,
  lastAuditAt: null,
  lastEventAt: null,
  lastEventType: null,
  tenantId: null,
  projectId: null,
  trustStatus: "APPROVED",
  decidedBy: "system",
  decidedAt: null,
  decisionReason:
    "Known managed sibling application; Atlas governs via the application preflight / governance boundary without fabricating a native agent identity.",
};

/**
 * HotelOS and BrokerOS share CaseFlow's exact Control-registration shape
 * (connected-applications.ts): local sibling runtime, HMAC application
 * preflight as the sole governed boundary, execute NONE, no native agent.
 * LexStudy and Vantera are deliberately NOT seeded — their runtimes are
 * not accessible and no preflight implementation is claimed, so a seeded
 * APPROVED trust status would fabricate a relationship that does not exist.
 * Civio is not seeded either: it registers dynamically via its connector.
 */
const HOTELOS_SIBLING: RegisteredApplication = {
  applicationId: "hotelos",
  name: "HotelOS",
  environment: "sibling-runtime",
  version: "unknown",
  health: "unknown",
  agentIds: [],
  capabilities: [
    "portfolio-observability",
    "application-preflight",
    "hmac-connector",
    "governance-evidence",
  ],
  findingCount: 0,
  lastAuditAt: null,
  lastEventAt: null,
  lastEventType: null,
  tenantId: null,
  projectId: null,
  trustStatus: "APPROVED",
  decidedBy: "system",
  decidedAt: null,
  decisionReason:
    "Known managed sibling application; Atlas governs via the application preflight / governance boundary without fabricating a native agent identity.",
};

const BROKEROS_SIBLING: RegisteredApplication = {
  applicationId: "brokeros",
  name: "BrokerOS",
  environment: "sibling-runtime",
  version: "unknown",
  health: "unknown",
  agentIds: [],
  capabilities: [
    "portfolio-observability",
    "application-preflight",
    "hmac-connector",
    "governance-evidence",
  ],
  findingCount: 0,
  lastAuditAt: null,
  lastEventAt: null,
  lastEventType: null,
  tenantId: null,
  projectId: null,
  trustStatus: "APPROVED",
  decidedBy: "system",
  decidedAt: null,
  decisionReason:
    "Known managed sibling application; Atlas governs via the application preflight / governance boundary without fabricating a native agent identity.",
};

const applications = new Map<string, RegisteredApplication>();

function ensureSeed(): void {
  if (!applications.has(ATLAS_SELF.applicationId)) {
    applications.set(ATLAS_SELF.applicationId, ATLAS_SELF);
  }
  if (!applications.has(CASEFLOW_SIBLING.applicationId)) {
    applications.set(CASEFLOW_SIBLING.applicationId, CASEFLOW_SIBLING);
  }
  if (!applications.has(HOTELOS_SIBLING.applicationId)) {
    applications.set(HOTELOS_SIBLING.applicationId, HOTELOS_SIBLING);
  }
  if (!applications.has(BROKEROS_SIBLING.applicationId)) {
    applications.set(BROKEROS_SIBLING.applicationId, BROKEROS_SIBLING);
  }
}

export function listRegisteredApplications(): readonly RegisteredApplication[] {
  ensureSeed();
  return [...applications.values()];
}

export function getRegisteredApplication(
  applicationId: string,
): RegisteredApplication | undefined {
  ensureSeed();
  return applications.get(applicationId);
}

export function upsertRegisteredApplication(
  patch: Partial<RegisteredApplication> & Pick<RegisteredApplication, "applicationId" | "name">,
): RegisteredApplication {
  ensureSeed();
  const existing = applications.get(patch.applicationId);
  const seededApproved = patch.applicationId === ATLAS_SELF.applicationId;
  const next: RegisteredApplication = {
    applicationId: patch.applicationId,
    name: patch.name,
    environment: patch.environment ?? existing?.environment ?? "unknown",
    version: patch.version ?? existing?.version ?? "unknown",
    health: patch.health ?? existing?.health ?? "unknown",
    agentIds: patch.agentIds ?? existing?.agentIds ?? [],
    capabilities: patch.capabilities ?? existing?.capabilities ?? [],
    findingCount: patch.findingCount ?? existing?.findingCount ?? 0,
    lastAuditAt: patch.lastAuditAt ?? existing?.lastAuditAt ?? null,
    lastEventAt: patch.lastEventAt ?? existing?.lastEventAt ?? null,
    lastEventType: patch.lastEventType ?? existing?.lastEventType ?? null,
    tenantId: patch.tenantId ?? existing?.tenantId ?? null,
    projectId: patch.projectId ?? existing?.projectId ?? null,
    trustStatus: seededApproved
      ? "APPROVED"
      : (patch.trustStatus ?? existing?.trustStatus ?? "PENDING"),
    decidedBy: patch.decidedBy ?? existing?.decidedBy ?? (seededApproved ? "system" : null),
    decidedAt: patch.decidedAt ?? existing?.decidedAt ?? null,
    decisionReason:
      patch.decisionReason ??
      existing?.decisionReason ??
      (seededApproved ? ATLAS_SELF.decisionReason : null),
  };
  applications.set(next.applicationId, next);
  return next;
}

export function applicationIsUsable(app: RegisteredApplication): boolean {
  return app.trustStatus === "APPROVED";
}

export function decideApplicationTrust(input: {
  readonly applicationId: string;
  readonly approve: boolean;
  readonly decidedBy: string;
  readonly reason: string;
}):
  | { readonly ok: true; readonly application: RegisteredApplication }
  | { readonly ok: false; readonly reason: string; readonly status: 400 | 404 } {
  ensureSeed();
  if (input.applicationId === ATLAS_SELF.applicationId) {
    return {
      ok: false,
      reason: "Atlas-self (def-000) trust cannot be changed",
      status: 400,
    };
  }
  const existing = applications.get(input.applicationId);
  if (!existing) {
    return { ok: false, reason: `Application "${input.applicationId}" not found`, status: 404 };
  }
  const next = upsertRegisteredApplication({
    applicationId: existing.applicationId,
    name: existing.name,
    trustStatus: input.approve ? "APPROVED" : "REJECTED",
    decidedBy: input.decidedBy,
    decidedAt: new Date().toISOString(),
    decisionReason: input.reason,
  });
  return { ok: true, application: next };
}

export function recordApplicationEvent(
  applicationId: string,
  eventType: string,
  extras?: { readonly findingDelta?: number; readonly health?: ApplicationHealth },
): RegisteredApplication | undefined {
  ensureSeed();
  const existing = applications.get(applicationId);
  if (!existing) return undefined;
  const next: RegisteredApplication = {
    ...existing,
    lastEventAt: new Date().toISOString(),
    lastEventType: eventType,
    findingCount: Math.max(0, existing.findingCount + (extras?.findingDelta ?? 0)),
    health: extras?.health ?? existing.health,
    lastAuditAt:
      eventType === "verification.completed"
        ? new Date().toISOString()
        : existing.lastAuditAt,
  };
  applications.set(applicationId, next);
  return next;
}

export function applicationIntegrationContract(app: RegisteredApplication): {
    readonly identity: {
      readonly applicationId: string;
      readonly name: string;
      readonly environment: string;
      readonly version: string;
      readonly kind: "APPLICATION";
      readonly tenantId: string | null;
    };
  readonly health: ApplicationHealth;
  readonly capabilities: readonly string[];
  readonly agents: readonly string[];
  readonly tools: readonly string[];
  readonly events: { readonly lastEventType: string | null; readonly lastEventAt: string | null };
  readonly diagnostics: { readonly findingCount: number };
  readonly verification: { readonly lastAuditAt: string | null };
  readonly controlledActions: readonly string[];
} {
  return {
    identity: {
      applicationId: app.applicationId,
      name: app.name,
      environment: app.environment,
      version: app.version,
      kind: "APPLICATION" as const,
      tenantId: app.tenantId ?? (app.applicationId === "def-000" ? "atlas" : null),
    },
    health: app.health,
    capabilities: app.capabilities,
    agents: app.agentIds,
    tools: [],
    events: { lastEventType: app.lastEventType, lastEventAt: app.lastEventAt },
    diagnostics: { findingCount: app.findingCount },
    verification: { lastAuditAt: app.lastAuditAt },
    controlledActions: [
      "inspect",
      "diagnose",
      "request_agent_run",
      "request_test",
      "request_verify",
      "retrieve_health",
      "retrieve_findings",
      "request_remediation",
    ],
  };
}

export function resetApplicationRegistryForTests(): void {
  applications.clear();
  applications.set(ATLAS_SELF.applicationId, ATLAS_SELF);
}

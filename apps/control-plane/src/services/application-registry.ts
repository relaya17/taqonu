/**
 * Generic managed-application registry for the Control Plane.
 * Not a HotelOS-specific dashboard — any Atlas-managed app uses this shape.
 */

export type ApplicationHealth = "healthy" | "degraded" | "down" | "unknown";

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
};

const applications = new Map<string, RegisteredApplication>();

function ensureSeed(): void {
  if (!applications.has(ATLAS_SELF.applicationId)) {
    applications.set(ATLAS_SELF.applicationId, ATLAS_SELF);
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
  };
  applications.set(next.applicationId, next);
  return next;
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

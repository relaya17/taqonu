import type { ManagedSystemFacetState } from "@atlas/shared";

/** Counts observed from connectors / evidence — never invented. */
export type FacetSignals = {
  hasIdentity: boolean;
  repoCount: number;
  environmentCount: number;
  serviceCount: number;
  databaseCount: number;
  integrationCount: number;
  deploymentCount: number;
  workerCount: number;
  jobCount: number;
  apiCount: number;
  secretsMetadataCount: number;
  policyCount: number;
  evidenceCount: number;
  riskCount: number;
  decisionCount: number;
  incidentCount: number;
  healthObserved: boolean;
  notes?: Partial<Record<ManagedSystemFacetState["facet"], string>>;
};

export function facetsFromSignals(
  signals: FacetSignals,
): Partial<Record<ManagedSystemFacetState["facet"], number>> {
  return {
    identity: signals.hasIdentity ? 1 : 0,
    repositories: signals.repoCount,
    environments: signals.environmentCount,
    services: signals.serviceCount,
    databases: signals.databaseCount,
    integrations: signals.integrationCount,
    deployments: signals.deploymentCount,
    workers: signals.workerCount,
    jobs: signals.jobCount,
    apis: signals.apiCount,
    secretsMetadata: signals.secretsMetadataCount,
    policies: signals.policyCount,
    evidence: signals.evidenceCount,
    risks: signals.riskCount,
    decisions: signals.decisionCount,
    incidents: signals.incidentCount,
    health: signals.healthObserved ? 1 : 0,
  };
}

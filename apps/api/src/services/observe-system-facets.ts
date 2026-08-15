import type { FacetSignals } from "@atlas/system-model";
import { osStore } from "../store/os-store.js";

const ATLAS_SELF_SLUGS = new Set(["atlas", "arletos", "atlas-core"]);

export function findAtlasSelfProjectId(): string | null {
  osStore.ensureLoaded();
  const match = osStore
    .listProjects()
    .find((project) => ATLAS_SELF_SLUGS.has(project.slug.toLowerCase()));
  return match?.id ?? null;
}

export function collectEvidenceTokens(projectId: string): string[] {
  const tokens: string[] = [];
  for (const record of osStore.getEvidence(projectId)) {
    tokens.push(record.source, record.sourceType, record.category);
    if (record.sourceId) tokens.push(record.sourceId);
    const provider = record.metadata.provider;
    if (typeof provider === "string") tokens.push(provider);
    if (record.excerpt) tokens.push(record.excerpt);
  }
  for (const feed of osStore.getDbFeeds(projectId)) {
    tokens.push(feed.provider, "database");
  }
  for (const feed of osStore.getDeployFeeds(projectId)) {
    tokens.push(feed.provider, "deployment", feed.environment);
  }
  return tokens;
}

export function collectFacetSignals(
  projectId: string,
  healthObserved: boolean,
): FacetSignals {
  const evidence = osStore.getEvidence(projectId);
  const observations = osStore.getObservations(projectId);
  const dbFeeds = osStore.getDbFeeds(projectId);
  const deployFeeds = osStore.getDeployFeeds(projectId);
  const decisions = osStore.getDecisions(projectId);
  const gates = osStore.getGateGraph(projectId);
  const workspace = osStore.getWorkspaceRoot(projectId);

  const byCategory = (category: string) =>
    evidence.filter((row) => row.category === category).length;

  const environments = new Set<string>();
  for (const feed of deployFeeds) environments.add(feed.environment);
  for (const row of evidence) {
    if (
      row.sourceType === "PRODUCTION" ||
      row.sourceType === "STAGING" ||
      row.sourceType === "CI"
    ) {
      environments.add(row.sourceType);
    }
    if (row.category === "ENVIRONMENT") environments.add("environment");
  }

  const connectors = new Set(observations.map((row) => row.connector));
  const haystack = (row: (typeof evidence)[number]) =>
    `${row.source} ${row.excerpt ?? ""} ${JSON.stringify(row.metadata)}`;

  const incidents = evidence.filter((row) => {
    const text = haystack(row);
    const deployFailed =
      row.category === "DEPLOYMENT" &&
      (row.metadata.readyState === "ERROR" ||
        row.metadata.status === "build_failed");
    return (
      deployFailed ||
      (row.category === "SECURITY" && /error|incident|breach/i.test(text))
    );
  }).length;

  const githubObserved = observations.some((row) => row.connector === "github");
  const repoCount =
    (workspace ? 1 : 0) + (githubObserved ? 1 : 0) + (byCategory("GIT") > 0 ? 1 : 0);

  return {
    hasIdentity: true,
    repoCount,
    environmentCount: environments.size,
    serviceCount: deployFeeds.length,
    databaseCount: dbFeeds.length + byCategory("DATABASE"),
    integrationCount: connectors.size,
    deploymentCount: byCategory("DEPLOYMENT") + deployFeeds.length,
    workerCount: evidence.filter((row) => /worker/i.test(haystack(row))).length,
    jobCount: evidence.filter(
      (row) => row.category === "TASKS" || /job|cron/i.test(haystack(row)),
    ).length,
    apiCount: evidence.filter(
      (row) =>
        row.category === "ARCHITECTURE" || /api/i.test(haystack(row)),
    ).length,
    secretsMetadataCount: byCategory("SECURITY"),
    policyCount: gates?.nodes.length ?? 0,
    evidenceCount: evidence.length,
    riskCount: byCategory("RISKS"),
    decisionCount: decisions.length + byCategory("DECISIONS"),
    incidentCount: incidents,
    healthObserved,
  };
}

export function projectHasProductionTarget(projectId: string): boolean {
  if (osStore.getDeployFeeds(projectId).some((feed) => feed.environment === "production")) {
    return true;
  }
  return osStore
    .getEvidence(projectId)
    .some((row) => row.sourceType === "PRODUCTION");
}

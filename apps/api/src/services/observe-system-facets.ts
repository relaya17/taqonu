import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadSoftwareKnowledgeGraph } from "@atlas/observer";
import { projectSchema, type ManagedSystemFacetState } from "@atlas/shared";
import type { FacetSignals } from "@atlas/system-model";
import { osStore } from "../store/os-store.js";
import { findRepoRoot } from "./repo-root.js";

export const ATLAS_SELF_SLUGS = new Set(["atlas", "arletos", "atlas-core"]);
export const ATLAS_SELF_PROJECT_ID = "00000000-0000-4000-8000-def000000001";

export type FacetObservation = {
  signals: FacetSignals;
  notes: Partial<Record<ManagedSystemFacetState["facet"], string>>;
};

export function findAtlasSelfProjectId(): string | null {
  osStore.ensureLoaded();
  const match = osStore
    .listProjects()
    .find((project) => ATLAS_SELF_SLUGS.has(project.slug.toLowerCase()));
  return match?.id ?? null;
}

function looksLikeAtlasRepo(root: string): boolean {
  return (
    existsSync(join(root, "package.json")) &&
    existsSync(join(root, "pnpm-workspace.yaml"))
  );
}

/** Bind this monorepo as the DEF-000 backing project when the API can see it. */
export function ensureAtlasSelfBound(): {
  projectId: string | null;
  workspaceRoot: string | null;
} {
  osStore.ensureLoaded();
  const root = findRepoRoot();
  const usable = looksLikeAtlasRepo(root) ? root : null;
  let projectId = findAtlasSelfProjectId();
  if (!projectId && usable) {
    const now = new Date().toISOString();
    osStore.upsertProject(
      projectSchema.parse({
        id: ATLAS_SELF_PROJECT_ID,
        slug: "atlas-core",
        name: "Atlas Core",
        description: "DEF-000 self-audit backing project — Atlas observes itself.",
        status: "ACTIVE",
        techStack: ["typescript", "next", "fastify"],
        createdAt: now,
        updatedAt: now,
      }),
    );
    projectId = ATLAS_SELF_PROJECT_ID;
  }
  if (projectId && usable && !osStore.getWorkspaceRoot(projectId)) {
    osStore.setWorkspaceRoot(projectId, usable);
  }
  return {
    projectId,
    workspaceRoot: projectId
      ? osStore.getWorkspaceRoot(projectId) ?? usable
      : usable,
  };
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
): FacetObservation {
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

  const githubName = observations.find((row) => row.connector === "github")
    ?.repository?.fullName;
  const notes: Partial<Record<ManagedSystemFacetState["facet"], string>> = {};
  if (workspace || githubName) {
    notes.repositories = [workspace ? "linked workspace" : null, githubName]
      .filter(Boolean)
      .join(" · ");
  }
  if (deployFeeds.length > 0) {
    notes.deployments = deployFeeds
      .map((feed) => `${feed.provider}:${feed.environment}`)
      .join(", ");
    notes.environments = [...environments].join(", ");
    notes.services = `${deployFeeds.length} deploy feed(s)`;
  }
  if (dbFeeds.length > 0) {
    notes.databases = dbFeeds.map((feed) => feed.provider).join(", ");
  }
  if (connectors.size > 0) {
    notes.integrations = [...connectors].join(", ");
  }
  if (evidence.length > 0) {
    notes.evidence = `${evidence.length} evidence record(s)`;
  }
  if (gates?.nodes.length) {
    notes.policies = `${gates.nodes.length} gate node(s)`;
  }
  if (decisions.length > 0) {
    notes.decisions = `${decisions.length} decision(s)`;
  }
  if (healthObserved) {
    notes.health = "portfolio health snapshot";
  }
  if (byCategory("SECURITY") > 0) {
    notes.secretsMetadata = `${byCategory("SECURITY")} security evidence row(s) — values never stored`;
  }

  let serviceCount = deployFeeds.length;
  let databaseCount = dbFeeds.length + byCategory("DATABASE");
  let deploymentCount = byCategory("DEPLOYMENT") + deployFeeds.length;
  let apiCount = evidence.filter(
    (row) => row.category === "ARCHITECTURE" || /api/i.test(haystack(row)),
  ).length;
  let jobCount = evidence.filter(
    (row) => row.category === "TASKS" || /job|cron/i.test(haystack(row)),
  ).length;
  let decisionCount = decisions.length + byCategory("DECISIONS");
  let incidentCount = incidents;
  let nextRepoCount = repoCount;

  if (workspace) {
    const graph = loadSoftwareKnowledgeGraph(workspace);
    if (graph) {
      const byType = (type: string) =>
        graph.nodes.filter((node) => node.type === type).length;
      const graphApis = byType("API");
      const graphStores = byType("DATA_STORE");
      const graphDeploys = byType("DEPLOYMENT");
      const graphRepos = byType("REPOSITORY");
      const graphTasks = byType("TASK");
      const graphDecisions = byType("DECISION");
      const graphIncidents = byType("INCIDENT");
      const graphPackages = byType("PACKAGE");
      nextRepoCount += graphRepos;
      apiCount += graphApis;
      databaseCount += graphStores;
      deploymentCount += graphDeploys;
      jobCount += graphTasks;
      decisionCount += graphDecisions;
      incidentCount += graphIncidents;
      serviceCount += graphPackages;
      notes.apis = notes.apis
        ? `${notes.apis} · graph ${graphApis} API`
        : `graph ${graphApis} API node(s)`;
      if (graphPackages > 0) {
        notes.services = `${serviceCount} service/package node(s)`;
      }
      notes.evidence = notes.evidence
        ? `${notes.evidence} · graph ${graph.nodes.length} nodes`
        : `graph ${graph.nodes.length} nodes`;
    }
  }

  return {
    signals: {
      hasIdentity: true,
      repoCount: nextRepoCount,
      environmentCount: environments.size,
      serviceCount,
      databaseCount,
      integrationCount: connectors.size,
      deploymentCount,
      workerCount: evidence.filter((row) => /worker/i.test(haystack(row))).length,
      jobCount,
      apiCount,
      secretsMetadataCount: byCategory("SECURITY"),
      policyCount: gates?.nodes.length ?? 0,
      evidenceCount: evidence.length,
      riskCount: byCategory("RISKS"),
      decisionCount,
      incidentCount,
      healthObserved,
    },
    notes,
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

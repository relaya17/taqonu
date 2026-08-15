import {
  ATLAS_SELF_SYSTEM_ID,
  managedSystemDetailSchema,
  managedSystemListSchema,
  portfolioHealthReportSchema,
  systemContractSchema,
  type ManagedSystem,
  type ManagedSystemDetail,
  type ManagedSystemList,
  type PortfolioVerdictHint,
  type SystemContract,
  type SystemContractWrite,
} from "@atlas/shared";
import {
  atlasSelfManagedSystem,
  defaultSystemContract,
  deriveControlLoopPhase,
  facetsFromSignals,
  mergeSystemContract,
  projectToManagedSystem,
  verifySystemInvariants,
} from "@atlas/system-model";
import { osStore } from "../store/os-store.js";
import { PORTFOLIO_HEALTH_META_KEY } from "./portfolio-health.js";
import {
  collectEvidenceTokens,
  collectFacetSignals,
  findAtlasSelfProjectId,
} from "./observe-system-facets.js";

const CONTRACT_META = (systemId: string) => `system.contract.v1.${systemId}`;

function loadPersistedPortfolioHealth() {
  osStore.ensureLoaded();
  const raw = osStore.getMeta(PORTFOLIO_HEALTH_META_KEY);
  if (!raw) return null;
  try {
    return portfolioHealthReportSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

function coverageFromScore(score: number | null | undefined): number | null {
  if (score == null) return null;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function loadSystemContract(system: ManagedSystem): SystemContract {
  osStore.ensureLoaded();
  const raw = osStore.getMeta(CONTRACT_META(system.id));
  if (raw) {
    try {
      return systemContractSchema.parse(JSON.parse(raw));
    } catch {
      // fall through to proposed default
    }
  }
  return defaultSystemContract(system);
}

export function saveSystemContract(
  system: ManagedSystem,
  patch: SystemContractWrite,
): SystemContract {
  const current = loadSystemContract(system);
  const next = systemContractSchema.parse(
    mergeSystemContract(current, patch),
  );
  osStore.setMeta(CONTRACT_META(system.id), JSON.stringify(next));
  return next;
}

function tokensForSystem(system: ManagedSystem): string[] {
  if (system.projectId) return collectEvidenceTokens(system.projectId);
  const selfProject = findAtlasSelfProjectId();
  return selfProject ? collectEvidenceTokens(selfProject) : [];
}

function withLoop(system: ManagedSystem): ManagedSystem {
  const contract = loadSystemContract(system);
  const verification = verifySystemInvariants({
    contract,
    evidenceTokens: tokensForSystem(system),
  });
  const repoFacet = system.facets.find((facet) => facet.facet === "repositories");
  const healthFacet = system.facets.find((facet) => facet.facet === "health");
  const evidenceFacet = system.facets.find((facet) => facet.facet === "evidence");
  const loop = deriveControlLoopPhase({
    hasRepos: Boolean(repoFacet?.observed || system.workspaceRoot),
    evidenceCount: evidenceFacet?.count ?? 0,
    healthObserved: Boolean(healthFacet?.observed),
    contractState: contract.epistemicState,
    invariantOverall: verification.overall,
    posture: system.posture,
  });
  return {
    ...system,
    loopPhase: loop.phase,
    actEligible: loop.actEligible,
  };
}

function projectSystem(
  project: ReturnType<typeof osStore.listProjects>[number],
  now: string,
): ManagedSystem {
  const health = loadPersistedPortfolioHealth();
  const row = (health?.items ?? []).find((item) => item.projectId === project.id);
  const verdict: PortfolioVerdictHint = row?.verdictHint ?? "UNKNOWN";
  const observed = collectFacetSignals(project.id, Boolean(row));
  const system = projectToManagedSystem({
    project,
    workspaceRoot: osStore.getWorkspaceRoot(project.id) ?? null,
    verdictHint: verdict,
    evidenceCoverage: coverageFromScore(row?.overallScore),
    criticalGaps: row?.criticalIssues ?? 0,
    mediumRisks: row?.highRisk ?? 0,
    ...(row?.notes ? { summary: row.notes } : {}),
    observedFacets: facetsFromSignals(observed.signals),
    facetNotes: observed.notes,
    asOf: now,
  });
  return withLoop(system);
}

function selfSystem(now: string): ManagedSystem {
  const health = loadPersistedPortfolioHealth();
  const selfProjectId = findAtlasSelfProjectId();
  const observed = selfProjectId
    ? collectFacetSignals(selfProjectId, Boolean(health))
    : {
        signals: {
          hasIdentity: true,
          repoCount: 0,
          environmentCount: 0,
          serviceCount: 0,
          databaseCount: 0,
          integrationCount: 0,
          deploymentCount: 0,
          workerCount: 0,
          jobCount: 0,
          apiCount: 0,
          secretsMetadataCount: 0,
          policyCount: 1,
          evidenceCount: health ? 1 : 0,
          riskCount: 0,
          decisionCount: osStore.listDecisions().length,
          incidentCount: 0,
          healthObserved: Boolean(health),
        },
        notes: {
          identity: "DEF-000 Atlas-self",
          policies: "WRITE is approval-gated",
        },
      };
  const selfRoot = selfProjectId
    ? osStore.getWorkspaceRoot(selfProjectId) ?? null
    : null;
  const system = atlasSelfManagedSystem({
    asOf: now,
    posture: "WATCH",
    observedFacets: facetsFromSignals(observed.signals),
    facetNotes: observed.notes,
    ...(selfRoot ? { workspaceRoot: selfRoot } : {}),
    ...(selfProjectId
      ? {
          summary:
            "Self-audit (DEF-000): observing the Atlas / ArletOS project through the same connectors as any Managed System.",
        }
      : {}),
  });
  return withLoop(system);
}

export function listManagedSystems(now = new Date().toISOString()): ManagedSystemList {
  osStore.ensureLoaded();
  const health = loadPersistedPortfolioHealth();
  const items = osStore.listProjects().map((project) => projectSystem(project, now));
  items.push(selfSystem(now));

  return managedSystemListSchema.parse({
    items,
    atlasSelfIncluded: true,
    asOf: now,
    epistemicState: health ? "INFERRED" : "UNKNOWN",
    note: health
      ? "Facets counted from evidence, connector feeds, gates, and last portfolio health. Connectors observe from outside."
      : "Facets counted from registered evidence and feeds. Run portfolio health to deepen VERIFY.",
  });
}

export function getManagedSystem(id: string): ManagedSystem | null {
  return listManagedSystems().items.find((item) => item.id === id) ?? null;
}

export function getManagedSystemDetail(id: string): ManagedSystemDetail {
  const system = getManagedSystem(id);
  if (!system) {
    throw new Error("NOT_FOUND");
  }
  const contract = loadSystemContract(system);
  const verification = verifySystemInvariants({
    contract,
    evidenceTokens: tokensForSystem(system),
  });
  return managedSystemDetailSchema.parse({
    system,
    contract,
    verification,
  });
}

export function getSystemContract(id: string): {
  contract: SystemContract;
  verification: ReturnType<typeof verifySystemInvariants>;
} {
  const system = getManagedSystem(id);
  if (!system) {
    throw new Error("NOT_FOUND");
  }
  const contract = loadSystemContract(system);
  return {
    contract,
    verification: verifySystemInvariants({
      contract,
      evidenceTokens: tokensForSystem(system),
    }),
  };
}

export function putSystemContract(
  id: string,
  patch: SystemContractWrite,
): {
  contract: SystemContract;
  verification: ReturnType<typeof verifySystemInvariants>;
} {
  const system = getManagedSystem(id);
  if (!system) {
    throw new Error("NOT_FOUND");
  }
  const contract = saveSystemContract(system, patch);
  return {
    contract,
    verification: verifySystemInvariants({
      contract,
      evidenceTokens: tokensForSystem(system),
    }),
  };
}

export function isAtlasSelfSystemId(id: string): boolean {
  return id === ATLAS_SELF_SYSTEM_ID;
}

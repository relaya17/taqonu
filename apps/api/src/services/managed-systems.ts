import {
  managedSystemListSchema,
  portfolioHealthReportSchema,
  type ManagedSystem,
  type ManagedSystemList,
  type PortfolioVerdictHint,
} from "@atlas/shared";
import {
  atlasSelfManagedSystem,
  projectToManagedSystem,
} from "@atlas/system-model";
import { osStore } from "../store/os-store.js";
import { PORTFOLIO_HEALTH_META_KEY } from "./portfolio-health.js";

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

export function listManagedSystems(now = new Date().toISOString()): ManagedSystemList {
  osStore.ensureLoaded();
  const health = loadPersistedPortfolioHealth();
  const byProject = new Map(
    (health?.items ?? []).map((item) => [item.projectId, item]),
  );

  const items: ManagedSystem[] = osStore.listProjects().map((project) => {
    const row = byProject.get(project.id);
    const verdict: PortfolioVerdictHint = row?.verdictHint ?? "UNKNOWN";
    return projectToManagedSystem({
      project,
      workspaceRoot: osStore.getWorkspaceRoot(project.id) ?? null,
      verdictHint: verdict,
      evidenceCoverage: coverageFromScore(row?.overallScore),
      criticalGaps: row?.criticalIssues ?? 0,
      mediumRisks: row?.highRisk ?? 0,
      ...(row?.notes ? { summary: row.notes } : {}),
      observedFacets: {
        identity: 1,
        repositories: 1,
        health: row ? 1 : 0,
        evidence: row ? 1 : 0,
        deployments: row?.verdictHint ? 1 : 0,
      },
      asOf: now,
    });
  });

  items.push(
    atlasSelfManagedSystem({
      asOf: now,
      posture: "WATCH",
    }),
  );

  return managedSystemListSchema.parse({
    items,
    atlasSelfIncluded: true,
    asOf: now,
    epistemicState: health ? "INFERRED" : "UNKNOWN",
    note: health
      ? "Projected from registered projects + last portfolio health. Connectors observe from outside."
      : "Projected from registered projects. Run portfolio health to deepen VERIFY.",
  });
}

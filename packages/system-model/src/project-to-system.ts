import {
  ATLAS_SELF_SYSTEM_ID,
  MANAGED_SYSTEM_FACETS,
  type ControlLoopPhase,
  type ManagedSystem,
  type ManagedSystemFacetState,
  type PortfolioVerdictHint,
  type Project,
  type SystemPosture,
} from "@atlas/shared";

const LAB_SLUGS = new Set(["brokeros", "golden-brokeros", "atlas", "arletos"]);

export function postureFromVerdict(hint: PortfolioVerdictHint): SystemPosture {
  switch (hint) {
    case "READY":
      return "CLEAR";
    case "CONDITIONAL":
      return "WATCH";
    case "BLOCKED":
      return "BLOCKED";
    default:
      return "UNKNOWN";
  }
}

export function kindForProject(project: Pick<Project, "slug">): ManagedSystem["kind"] {
  return LAB_SLUGS.has(project.slug.toLowerCase()) ? "LAB" : "CUSTOMER";
}

function facet(
  name: ManagedSystemFacetState["facet"],
  observed: boolean,
  count = 0,
  note?: string,
): ManagedSystemFacetState {
  return {
    facet: name,
    observed,
    count,
    epistemicState: observed ? "OBSERVED" : "UNKNOWN",
    ...(note ? { note } : {}),
  };
}

export function projectToManagedSystem(input: {
  project: Project;
  workspaceRoot?: string | null;
  verdictHint?: PortfolioVerdictHint;
  evidenceCoverage?: number | null;
  criticalGaps?: number;
  mediumRisks?: number;
  summary?: string;
  observedFacets?: Partial<Record<ManagedSystemFacetState["facet"], number>>;
  facetNotes?: Partial<Record<ManagedSystemFacetState["facet"], string>>;
  loopPhase?: ControlLoopPhase;
  actEligible?: boolean;
  asOf?: string;
}): ManagedSystem {
  const verdict = input.verdictHint ?? "UNKNOWN";
  const observed = input.observedFacets ?? {};
  const notes = input.facetNotes ?? {};
  const facets = MANAGED_SYSTEM_FACETS.map((name) => {
    const count = observed[name];
    const note = notes[name];
    return facet(
      name,
      count != null && count > 0,
      count ?? 0,
      note,
    );
  });

  return {
    id: input.project.id,
    projectId: input.project.id,
    slug: input.project.slug,
    name: input.project.name,
    kind: kindForProject(input.project),
    posture: postureFromVerdict(verdict),
    verdictHint: verdict,
    summary:
      input.summary ??
      (verdict === "UNKNOWN"
        ? "No verified system model yet — connect Git / deploy / evidence."
        : `Verdict ${verdict}`),
    evidenceCoverage: input.evidenceCoverage ?? null,
    criticalGaps: input.criticalGaps ?? 0,
    mediumRisks: input.mediumRisks ?? 0,
    workspaceRoot: input.workspaceRoot ?? null,
    facets,
    selfManaged: false,
    loopPhase: input.loopPhase ?? "DISCOVER",
    actEligible: input.actEligible ?? false,
    asOf: input.asOf ?? new Date().toISOString(),
    epistemicState: verdict === "UNKNOWN" ? "UNKNOWN" : "INFERRED",
  };
}

/** Atlas is a Managed System of itself (DEF-000). */
export function atlasSelfManagedSystem(input?: {
  asOf?: string;
  posture?: SystemPosture;
  summary?: string;
  observedFacets?: Partial<Record<ManagedSystemFacetState["facet"], number>>;
  facetNotes?: Partial<Record<ManagedSystemFacetState["facet"], string>>;
  workspaceRoot?: string | null;
  loopPhase?: ControlLoopPhase;
  actEligible?: boolean;
}): ManagedSystem {
  const asOf = input?.asOf ?? new Date().toISOString();
  return {
    id: ATLAS_SELF_SYSTEM_ID,
    projectId: null,
    slug: "atlas-core",
    name: "Atlas Core",
    kind: "ATLAS_SELF",
    posture: input?.posture ?? "WATCH",
    verdictHint: input?.posture === "CLEAR" ? "READY" : "CONDITIONAL",
    summary:
      input?.summary ??
      "Self-audit (DEF-000): Atlas must observe its own evidence, gates, and writes.",
    evidenceCoverage: null,
    criticalGaps: 0,
    mediumRisks: 0,
    workspaceRoot: input?.workspaceRoot ?? null,
    facets: MANAGED_SYSTEM_FACETS.map((name) => {
      const count = input?.observedFacets?.[name];
      const note = input?.facetNotes?.[name];
      if (count != null) {
        return facet(name, count > 0, count, note);
      }
      return facet(
        name,
        name === "identity" ||
          name === "policies" ||
          name === "evidence" ||
          name === "health",
        name === "identity" ? 1 : 0,
        note,
      );
    }),
    selfManaged: true,
    loopPhase: input?.loopPhase ?? "VERIFY",
    actEligible: input?.actEligible ?? false,
    asOf,
    epistemicState: "INFERRED",
  };
}

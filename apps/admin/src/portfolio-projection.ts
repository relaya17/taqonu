import type {
  buildPortfolioSummary,
  PortfolioGovernanceSnapshot,
} from "@atlas/shared";

export type PortfolioSummary = ReturnType<typeof buildPortfolioSummary>;

export interface PortfolioProjection {
  readonly reachability: "REACHABLE" | "UNREACHABLE";
  readonly snapshot: PortfolioGovernanceSnapshot | null;
  readonly summary: PortfolioSummary | null;
  readonly detail: string | null;
}

export interface PortfolioProjectionSources {
  readonly controlOrigin: string;
  readonly fetchJson?: (url: string) => Promise<unknown>;
}

function isPortfolioGovernancePayload(
  value: unknown,
): value is { snapshot: PortfolioGovernanceSnapshot; summary: PortfolioSummary } {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record["snapshot"] !== null &&
    typeof record["snapshot"] === "object" &&
    record["summary"] !== null &&
    typeof record["summary"] === "object"
  );
}

function unreachable(detail: string): PortfolioProjection {
  return { reachability: "UNREACHABLE", snapshot: null, summary: null, detail };
}

/**
 * Phase 11.9 - Portfolio Governance Admin projection.
 *
 * Reads Control Plane's existing read-only projection
 * (GET /api/v1/portfolio-governance, apps/control-plane/src/services/portfolio-governance-view.ts),
 * the same endpoint the pre-deletion Admin UI (82e883e) used and the one
 * apps/control-plane/src/routes/dashboard.ts already fetches from today.
 * Does not call the tenant API directly and does not introduce a new
 * authentication mechanism: Admin -> Control Plane reuses the existing
 * ATLAS_CONTROL_PLANE_TOKEN trust relationship (see fetchSupervisedJson in
 * server.ts). Writes and canonical audit stay on the Atlas API, unchanged.
 */
export async function loadPortfolioProjection(
  sources: PortfolioProjectionSources,
): Promise<PortfolioProjection> {
  const fetchJson = sources.fetchJson;
  if (!fetchJson) {
    return unreachable("Portfolio projection was not fetched.");
  }
  try {
    const raw = await fetchJson(
      `${sources.controlOrigin.replace(/\/$/, "")}/api/v1/portfolio-governance`,
    );
    if (!isPortfolioGovernancePayload(raw)) {
      return unreachable(
        "Control Plane /api/v1/portfolio-governance returned an unexpected payload.",
      );
    }
    return {
      reachability: "REACHABLE",
      snapshot: raw.snapshot,
      summary: raw.summary,
      detail: null,
    };
  } catch (error) {
    return unreachable(
      error instanceof Error ? error.message : "Portfolio projection fetch failed",
    );
  }
}

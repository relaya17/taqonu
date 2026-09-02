import {
  ATLAS_PLATFORM_HIERARCHY,
  ATLAS_SURFACE_ROLES,
  platformHierarchyDocument,
  type AtlasProductSurface,
  type PlatformHierarchyDocument,
  type PlatformSupervisionSnapshot,
  type SurfaceHealth,
} from "@atlas/shared";

export type { PlatformSupervisionSnapshot };

export interface PlatformOverview {
  readonly hierarchy: PlatformHierarchyDocument;
  readonly admin: PlatformSupervisionSnapshot;
  readonly control: PlatformSupervisionSnapshot;
  readonly studio: PlatformSupervisionSnapshot;
}

export interface PlatformOverviewSources {
  readonly adminOrigin: string;
  readonly controlOrigin: string;
  readonly studioOrigin: string;
  /** Tenant API origin for Studio live counts. Not the Studio UI origin. */
  readonly apiOrigin?: string;
  readonly fetchJson?: (url: string) => Promise<unknown>;
}

function snapshot(
  surface: AtlasProductSurface,
  origin: string,
  reachability: PlatformSupervisionSnapshot["reachability"],
  health: SurfaceHealth,
  metrics: Readonly<Record<string, number>>,
  notes: readonly string[],
): PlatformSupervisionSnapshot {
  return {
    surface,
    parentSurface: surface === "ADMIN" ? null : "ADMIN",
    role: ATLAS_SURFACE_ROLES[surface],
    runtime: ATLAS_PLATFORM_HIERARCHY[surface].runtime,
    origin,
    reachability,
    health,
    generatedAt: new Date().toISOString(),
    metrics,
    notes,
  };
}

function isSupervisionSnapshot(
  value: unknown,
  expected: AtlasProductSurface,
): value is PlatformSupervisionSnapshot {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record["surface"] === expected &&
    typeof record["role"] === "string" &&
    typeof record["origin"] === "string" &&
    typeof record["reachability"] === "string" &&
    record["metrics"] !== null &&
    typeof record["metrics"] === "object"
  );
}

export function adminSelfSnapshot(origin: string): PlatformSupervisionSnapshot {
  return snapshot("ADMIN", origin, "REACHABLE", "healthy", {}, [
    "Highest-level platform supervisor. Not Control. Not Studio.",
    "Tenant /admin on the user plane is customer administration, not this surface.",
  ]);
}

export function configuredStudioSnapshot(origin: string): PlatformSupervisionSnapshot {
  return snapshot("STUDIO", origin, "CONFIGURED", "unknown", {}, [
    "Developer workspace remains at apps/web /[locale]/studio.",
    "This card is not a live connector and does not invent project counts.",
    "Live counts: owner/operator GET /api/v1/platform/studio-supervision on the tenant API.",
  ]);
}

export function unreachableControlSnapshot(origin: string, detail: string): PlatformSupervisionSnapshot {
  return snapshot("CONTROL", origin, "UNREACHABLE", "down", {}, [
    "Operational layer is unreachable. Admin does not invent Control state.",
    detail,
  ]);
}

export async function composePlatformOverview(
  sources: PlatformOverviewSources,
): Promise<PlatformOverview> {
  const fetchJson = sources.fetchJson;
  let control = unreachableControlSnapshot(
    sources.controlOrigin,
    "Control supervision contract was not fetched.",
  );
  if (fetchJson) {
    try {
      const raw = await fetchJson(
        `${sources.controlOrigin.replace(/\/$/, "")}/api/v1/supervision`,
      );
      if (isSupervisionSnapshot(raw, "CONTROL")) {
        control = raw;
      } else {
        control = unreachableControlSnapshot(
          sources.controlOrigin,
          "Control /api/v1/supervision returned an unexpected payload.",
        );
      }
    } catch (error) {
      control = unreachableControlSnapshot(
        sources.controlOrigin,
        error instanceof Error ? error.message : "Control fetch failed",
      );
    }
  }

  let studio = configuredStudioSnapshot(sources.studioOrigin);
  if (fetchJson && sources.apiOrigin) {
    try {
      const raw = await fetchJson(
        `${sources.apiOrigin.replace(/\/$/, "")}/api/v1/platform/studio-supervision`,
      );
      if (isSupervisionSnapshot(raw, "STUDIO")) {
        studio = raw;
      }
    } catch {
      // Studio live metrics are optional. Configured location is not a fake connection.
    }
  }

  return {
    hierarchy: platformHierarchyDocument(),
    admin: adminSelfSnapshot(sources.adminOrigin),
    control,
    studio,
  };
}

/**
 * Atlas product hierarchy — Admin supervises Control and Studio.
 *
 * These are product surfaces, not three copies of one dashboard.
 * Connected applications are supervised by Control, not by Admin directly.
 */

export const ATLAS_PRODUCT_SURFACES = ["ADMIN", "CONTROL", "STUDIO"] as const;
export type AtlasProductSurface = (typeof ATLAS_PRODUCT_SURFACES)[number];

export const ATLAS_SURFACE_ROLES = {
  ADMIN: "platform_supervisor",
  CONTROL: "operational_supervision",
  STUDIO: "developer_workspace",
} as const;

export const ATLAS_PLATFORM_HIERARCHY = {
  ADMIN: {
    surface: "ADMIN",
    role: ATLAS_SURFACE_ROLES.ADMIN,
    parent: null,
    supervises: ["CONTROL", "STUDIO"],
    runtime: "apps/admin",
    defaultOrigin: "http://127.0.0.1:3200",
  },
  CONTROL: {
    surface: "CONTROL",
    role: ATLAS_SURFACE_ROLES.CONTROL,
    parent: "ADMIN",
    supervises: ["CONNECTED_APPLICATIONS", "PROCESSES", "OPERATIONAL_AGENTS"],
    runtime: "apps/control-plane",
    defaultOrigin: "http://127.0.0.1:3100",
  },
  STUDIO: {
    surface: "STUDIO",
    role: ATLAS_SURFACE_ROLES.STUDIO,
    parent: "ADMIN",
    supervises: [],
    runtime: "apps/web",
    route: "/[locale]/studio",
    defaultOrigin: "http://localhost:3000",
  },
} as const;

/** Tenant Oracle at apps/web/app/admin is not Atlas Admin. */
export const TENANT_ADMIN_SURFACE = {
  kind: "TENANT_ADMIN",
  runtime: "apps/web/app/admin",
  note: "Customer / tenant administration. Not Atlas platform Admin (apps/admin :3200).",
} as const;

export const SURFACE_REACHABILITY = [
  "REACHABLE",
  "UNREACHABLE",
  "CONFIGURED",
  "NOT_CONFIGURED",
] as const;
export type SurfaceReachability = (typeof SURFACE_REACHABILITY)[number];

export const SURFACE_HEALTH = ["healthy", "degraded", "down", "unknown"] as const;
export type SurfaceHealth = (typeof SURFACE_HEALTH)[number];

export interface PlatformSupervisionSnapshot {
  readonly surface: AtlasProductSurface;
  readonly parentSurface: AtlasProductSurface | null;
  readonly role: string;
  readonly runtime: string;
  readonly origin: string;
  readonly reachability: SurfaceReachability;
  readonly health: SurfaceHealth;
  readonly generatedAt: string;
  readonly metrics: Readonly<Record<string, number>>;
  readonly notes: readonly string[];
}

export interface PlatformHierarchyDocument {
  readonly kind: "ATLAS_PLATFORM_HIERARCHY";
  readonly adminSupervises: readonly ["CONTROL", "STUDIO"];
  readonly controlSupervises: readonly [
    "CONNECTED_APPLICATIONS",
    "PROCESSES",
    "OPERATIONAL_AGENTS",
  ];
  readonly studioLocation: "apps/web/[locale]/studio";
  readonly tenantAdminIsNotAtlasAdmin: true;
  readonly surfaces: typeof ATLAS_PLATFORM_HIERARCHY;
}

export function platformHierarchyDocument(): PlatformHierarchyDocument {
  return {
    kind: "ATLAS_PLATFORM_HIERARCHY",
    adminSupervises: ["CONTROL", "STUDIO"],
    controlSupervises: [
      "CONNECTED_APPLICATIONS",
      "PROCESSES",
      "OPERATIONAL_AGENTS",
    ],
    studioLocation: "apps/web/[locale]/studio",
    tenantAdminIsNotAtlasAdmin: true,
    surfaces: ATLAS_PLATFORM_HIERARCHY,
  };
}

export function isAtlasProductSurface(
  value: string,
): value is AtlasProductSurface {
  return (ATLAS_PRODUCT_SURFACES as readonly string[]).includes(value);
}

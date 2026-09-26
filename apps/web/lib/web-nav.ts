import { WEB_NAV_PATHS, type StudioCheckId } from "./studio-surfaces";

/**
 * D9 primary destinations. Studio is first because it is the engineering
 * workspace and the signed-in entry. Account is the /settings route.
 * Checks are not listed: they live on the Studio Checks tab.
 */
export const PRIMARY_NAV_KEYS = [
  "studio",
  "projects",
  "dashboard",
  "agents",
  "settings",
] as const;

/** Discoverable, not primary. Collapsed until the current route is inside the group. */
export const ADVANCED_NAV_KEYS = [
  "systems",
  "plan",
  "experts",
  "models",
  "integrations",
  "partners",
  "legalMedia",
] as const;

export type WebNavKey = keyof typeof WEB_NAV_PATHS;

export const NAV_GROUPS: readonly {
  readonly id: string;
  readonly labelKey?: "advancedGroup";
  readonly collapsedByDefault?: boolean;
  readonly items: readonly WebNavKey[];
}[] = [
  { id: "main", items: PRIMARY_NAV_KEYS },
  {
    id: "advanced",
    labelKey: "advancedGroup",
    collapsedByDefault: true,
    items: ADVANCED_NAV_KEYS,
  },
];

/**
 * Legacy check URLs still redirect into Studio. If a check key is ever
 * rendered, it must open the Studio check, not a second product surface.
 * These keys are intentionally absent from NAV_GROUPS.
 */
export const NAV_TO_STUDIO_CHECK: Partial<Record<WebNavKey, StudioCheckId>> = {
  observer: "observer",
  sentinel: "sentinel",
  qa: "qa",
  processAudit: "processAudit",
  health: "health",
  readiness: "readiness",
  truth: "truth",
};

const CHECK_NAV_KEYS = new Set<string>(Object.keys(NAV_TO_STUDIO_CHECK));

/**
 * Studio keeps its current tab when the URL has no `tab`, so the Studio item
 * names `files` explicitly to keep the URL and the shown tab in agreement.
 */
export function navItemHref(
  key: WebNavKey,
  projectId: string | null,
): string | { pathname: "/studio"; query: object } {
  const id = projectId?.trim() ?? "";
  const check = NAV_TO_STUDIO_CHECK[key];
  if (check) {
    if (!id) return { pathname: "/studio", query: { tab: "checks", check } };
    return { pathname: "/studio", query: { tab: "checks", check, project: id } };
  }
  if (key === "studio") {
    if (!id) return { pathname: "/studio", query: { tab: "files" } };
    return { pathname: "/studio", query: { tab: "files", project: id } };
  }
  return WEB_NAV_PATHS[key];
}

export function isWebNavSelected(
  key: WebNavKey,
  pathname: string,
  searchParams: { get: (name: string) => string | null },
): boolean {
  const studioPath = WEB_NAV_PATHS.studio;
  if (pathname === studioPath || pathname.startsWith(`${studioPath}/`)) {
    const tab = searchParams.get("tab");
    const check = searchParams.get("check");
    const mapped = NAV_TO_STUDIO_CHECK[key];
    if (tab === "checks" && mapped) {
      return check === mapped;
    }
    return key === "studio";
  }
  if (key === "projects" && /\/projects\/[^/]+\/state$/.test(pathname)) {
    return false;
  }
  const href = WEB_NAV_PATHS[key];
  if (!href || !pathname) return false;
  if (href === "/") return pathname === "/";
  const pathOnly = href.split("?")[0] ?? href;
  return pathname === pathOnly || pathname.startsWith(`${pathOnly}/`);
}

export function renderedNavKeys(): readonly WebNavKey[] {
  return NAV_GROUPS.flatMap((group) => group.items);
}

export function sidebarOmitsStudioChecks(): boolean {
  return renderedNavKeys().every((key) => !CHECK_NAV_KEYS.has(key));
}

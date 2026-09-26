export const STUDIO_TABS = ["files", "chat", "run", "pty", "cloud", "checks"] as const;
export type StudioTab = (typeof STUDIO_TABS)[number];

/** Canonical Checks-tab capabilities. Process Audit is the full E2E audit, not the QA subset. */
export const STUDIO_CHECK_IDS = [
  "observer",
  "sentinel",
  "qa",
  "processAudit",
  "health",
  "readiness",
  "truth",
] as const;
export type StudioCheckId = (typeof STUDIO_CHECK_IDS)[number];

export function isStudioTab(value: string | null): value is StudioTab {
  return value !== null && (STUDIO_TABS as readonly string[]).includes(value);
}

export function isStudioCheckId(value: string | null): value is StudioCheckId {
  return value !== null && (STUDIO_CHECK_IDS as readonly string[]).includes(value);
}

/**
 * Auth failure must not look like an empty workspace. A 401/network error
 * leaves projectCount at 0; showing "no projects" would mislead operators.
 */
export function shouldShowStudioEmptyProjects(input: {
  readonly isError: boolean;
  readonly isLoading: boolean;
  readonly projectId: string | null | undefined;
  readonly projectCount: number;
}): boolean {
  return (
    !input.isError &&
    !input.isLoading &&
    !input.projectId &&
    input.projectCount === 0
  );
}

/**
 * Missing-workspace copy must not appear when the project list itself failed.
 * A 401/network error is not "link a folder."
 */
export function shouldShowStudioNeedRoot(input: {
  readonly isError: boolean;
  readonly projectId: string | null | undefined;
  readonly hasWorkspaceRoot: boolean;
}): boolean {
  return Boolean(input.projectId) && !input.isError && !input.hasWorkspaceRoot;
}

/**
 * Studio query string. Files tab may carry `file`; other tabs drop it so a
 * Checks URL cannot strand an unreachable editor path.
 */
export function buildStudioSearch(input: {
  readonly tab?: string | null;
  readonly check?: string | null;
  readonly projectId?: string | null;
  readonly file?: string | null;
}): string {
  const params = new URLSearchParams();
  const requestedTab = input.tab ?? null;
  const tab = isStudioTab(requestedTab) ? requestedTab : "files";
  params.set("tab", tab);
  if (tab === "checks") {
    params.set(
      "check",
      isStudioCheckId(input.check ?? null) ? input.check! : "observer",
    );
  }
  const projectId = input.projectId?.trim();
  if (projectId) params.set("project", projectId);
  const file = input.file?.trim();
  if (tab === "files" && file) params.set("file", file);
  return `?${params.toString()}`;
}

/**
 * Dashboard / Projects → Studio. next-intl Link on a MUI Button drops a
 * string `/studio?project=`. An object keeps `project`. No id stays `/studio`.
 */
export function studioProjectHref(
  projectId: string | null | undefined,
): "/studio" | { pathname: "/studio"; query: { project: string } } {
  const id = projectId?.trim() ?? "";
  if (!id) return "/studio";
  return { pathname: "/studio", query: { project: id } };
}

/** Sidebar and desk aliases into an existing Studio Check. Old URLs stay redirects. */
export function studioCheckHref(
  check: StudioCheckId,
  projectId?: string | null,
): {
  pathname: "/studio";
  query:
    | { tab: "checks"; check: StudioCheckId; project: string }
    | { tab: "checks"; check: StudioCheckId };
} {
  const id = projectId?.trim() ?? "";
  if (!id) return { pathname: "/studio", query: { tab: "checks", check } };
  return { pathname: "/studio", query: { tab: "checks", check, project: id } };
}

/**
 * Projects → Workbench. Same MUI/next-intl object shape as Studio.
 * No id stays `/workbench`, which already falls through to Studio chat.
 */
export function workbenchProjectHref(
  projectId: string | null | undefined,
): "/workbench" | { pathname: "/workbench"; query: { project: string } } {
  const id = projectId?.trim() ?? "";
  if (!id) return "/workbench";
  return { pathname: "/workbench", query: { project: id } };
}

/** File-surface entry points. They fill a proposal. They do not apply. */
export const STUDIO_FILE_ACTIONS = ["explain", "diagnose", "review"] as const;
export type StudioFileAction = (typeof STUDIO_FILE_ACTIONS)[number];

export function studioFileActionInstruction(
  action: StudioFileAction,
  path: string,
): string {
  const file = path.trim();
  const verb =
    action === "explain"
      ? "Explain"
      : action === "diagnose"
        ? "Diagnose"
        : "Review";
  return `${verb} ${file}. Stop at a proposal. Do not apply.`;
}

/**
 * Signed-in working entry. Marketing `/` still redirects to welcome;
 * the locale dashboard (`/{locale}`) remains reachable and is not deleted.
 */
export const WEB_POST_AUTH_PATH = "/studio";

function stripLocalePrefix(pathname: string): string {
  return pathname.replace(/^\/(he|en|ar)(?=\/|$)/, "") || "/";
}

/**
 * Public doors: no product nav (Studio / Checks / Systems) until sign-in.
 * Locale prefix is stripped so both next-intl (`/welcome`) and raw
 * (`/he/welcome`) paths classify the same.
 */
export function isPublicShellPath(pathname: string): boolean {
  const path = stripLocalePrefix(pathname);
  return (
    path === "/welcome" ||
    path.startsWith("/welcome/") ||
    path === "/auth" ||
    path.startsWith("/auth/")
  );
}

/** Marketing landing chrome — welcome only, not login/register. */
export function isMarketingShellPath(pathname: string): boolean {
  const path = stripLocalePrefix(pathname);
  return path === "/welcome" || path.startsWith("/welcome/");
}

/**
 * Routes that must remain reachable after Studio consolidation.
 * Standalone ops URLs redirect into Studio Checks; they must not be deleted.
 */
export const WEB_NAV_PATHS = {
  dashboard: "/",
  projects: "/projects",
  systems: "/systems",
  studio: "/studio",
  workbench: "/workbench",
  agents: "/agents",
  partners: "/partners",
  patches: "/patches",
  health: "/health",
  truth: "/truth",
  observer: "/observer",
  sentinel: "/sentinel",
  readiness: "/readiness",
  qa: "/qa",
  processAudit: "/process-audit",
  models: "/models",
  experts: "/experts",
  memory: "/memory",
  decisions: "/decisions",
  integrations: "/integrations",
  plan: "/plan",
  welcome: "/welcome",
  legalMedia: "/legal-media",
  settings: "/settings",
} as const;

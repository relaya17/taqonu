export const STUDIO_TABS = ["files", "chat", "cloud", "checks"] as const;
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
 * Signed-in working entry. Marketing `/` still redirects to welcome;
 * the locale dashboard (`/{locale}`) remains reachable and is not deleted.
 */
export const WEB_POST_AUTH_PATH = "/studio";

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

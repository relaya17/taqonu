import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "../../../web");

const REQUIRED_WEB_ROUTES = [
  "/",
  "/projects",
  "/systems",
  "/studio",
  "/workbench",
  "/agents",
  "/partners",
  "/patches",
  "/health",
  "/truth",
  "/observer",
  "/sentinel",
  "/readiness",
  "/qa",
  "/process-audit",
  "/models",
  "/experts",
  "/memory",
  "/decisions",
  "/integrations",
  "/plan",
  "/welcome",
  "/legal-media",
  "/settings",
] as const;

const STUDIO_CHECKS = [
  "observer",
  "sentinel",
  "qa",
  "processAudit",
  "health",
  "readiness",
  "truth",
] as const;

function readWeb(rel: string): string {
  return readFileSync(join(webRoot, rel), "utf8");
}

describe("D3 Web/Studio navigation and Checks consolidation", () => {
  it("keeps every existing Web nav route in AppShell PATHS", () => {
    const appShell = readWeb("components/layout/AppShell.tsx");
    const surfaces = readWeb("lib/studio-surfaces.ts");
    for (const route of REQUIRED_WEB_ROUTES) {
      expect(surfaces).toContain(`"${route}"`);
    }
    expect(appShell).toContain("WEB_NAV_PATHS");
    expect(appShell).toContain("WEB_POST_AUTH_PATH");
    expect(surfaces).toContain('export const WEB_POST_AUTH_PATH = "/studio"');
    expect(appShell).toContain('items: ["studio", "systems", "dashboard", "projects", "plan"]');
    expect(appShell).toContain('items: ["truth", "health", "readiness", "qa", "processAudit"]');
    expect(appShell).toContain('items: ["agents", "experts"]');
    const login = readWeb("app/[locale]/auth/login/page.tsx");
    const register = readWeb("app/[locale]/auth/register/page.tsx");
    const callback = readWeb("app/[locale]/auth/callback/page.tsx");
    expect(login).toContain("WEB_POST_AUTH_PATH");
    expect(register).toContain("WEB_POST_AUTH_PATH");
    expect(callback).toContain("WEB_POST_AUTH_PATH");
    expect(login).toContain("useSearchParams");
    expect(login).toContain("authHrefWithNext");
    expect(login).not.toContain("window.location.search");
    expect(register).toContain("authHrefWithNext");
    expect(callback).toContain("allowlistedAuditNext");
    expect(appShell).toContain("keepMounted: false");
    expect(appShell).not.toContain("keepMounted: true");
    const dashboard = readWeb("app/[locale]/page.tsx");
    expect(dashboard).toContain('href="/studio"');
    expect(dashboard).toContain("dashboard.workingHome");
  });

  it("surfaces PSA memory in Studio without merging CODE_ENGINEER ask-agent", () => {
    const panel = readWeb("components/studio/SupervisingAgentPanel.tsx");
    const studio = readWeb("app/[locale]/studio/page.tsx");
    expect(panel).toContain("/api/v1/supervising-agent/memory");
    expect(panel).toContain("/api/v1/supervising-agent/coordinate");
    expect(panel).not.toContain("/api/v1/studio/ask-agent");
    expect(panel).not.toContain("/api/v1/code/patches");
    expect(studio).toContain("engineerRole");
    expect(studio).toContain("<SupervisingAgentPanel");
    expect(studio).toContain("/api/v1/studio/ask-agent");
    expect(studio).toContain("projectsQuery.isError");
    expect(studio).toContain("&project=${encodeURIComponent(id)}");
  });

  it("keeps standalone route files that redirect into Studio Checks", () => {
    const redirects: Array<[string, string]> = [
      ["app/[locale]/observer/page.tsx", "observer"],
      ["app/[locale]/sentinel/page.tsx", "sentinel"],
      ["app/[locale]/qa/page.tsx", "qa"],
      ["app/[locale]/process-audit/page.tsx", "processAudit"],
      ["app/[locale]/health/page.tsx", "health"],
      ["app/[locale]/readiness/page.tsx", "readiness"],
      ["app/[locale]/truth/page.tsx", "truth"],
      ["app/[locale]/workbench/page.tsx", "chat"],
    ];
    for (const [rel, token] of redirects) {
      expect(existsSync(join(webRoot, rel))).toBe(true);
      const src = readWeb(rel);
      expect(src).toMatch(/StudioSurfaceRedirect|router\.replace/);
      expect(src).toContain(token);
    }
  });

  it("hosts all seven Checks capabilities in Studio without duplicating Process Audit inside QA", () => {
    const studio = readWeb("app/[locale]/studio/page.tsx");
    const qa = readWeb("components/studio/QaPanel.tsx");
    const processAudit = readWeb("components/studio/ProcessAuditPanel.tsx");
    for (const id of STUDIO_CHECKS) {
      expect(studio).toContain(`checksTab === "${id}"`);
    }
    expect(qa).not.toContain("/api/v1/qa/process-audit");
    expect(qa).toContain("check=processAudit");
    expect(processAudit).toContain("/api/v1/qa/process-audit");
    const health = readWeb("components/studio/HealthPanel.tsx");
    const truth = readWeb("components/studio/TruthPanel.tsx");
    const readiness = readWeb("components/studio/ReadinessPanel.tsx");
    expect(health).toContain("!boundProjectId");
    expect(truth).toContain("!boundProjectId");
    expect(readiness).toContain("!boundProjectId");
    const patches = readWeb("components/dashboard/PatchesPanel.tsx");
    expect(patches).toContain("useProjectQueryParam");
  });
});

describe("D2 Studio approve/apply does not skip human approval", () => {
  it("apply is gated on APPROVED status in the Studio workflow helper", () => {
    const helper = readWeb("lib/studio-patch-workflow.ts");
    expect(helper).toContain('case "APPROVED"');
    expect(helper).toContain('return "apply"');
    expect(helper).toContain("canApplyStudioPatch");
    expect(helper).toMatch(/status === "APPROVED"/);
    expect(helper).toContain("approvalId");
    const workflow = readWeb("components/studio/StudioPatchWorkflow.tsx");
    expect(workflow).toContain("patchGovernedPath");
    expect(workflow).toContain("isApprovalRequiredError");
    expect(workflow).toContain("canApplyStudioPatch(focused.status)");
    expect(workflow).not.toMatch(/apply\.mutate.*approve\.mutate/);
    const api = readWeb("lib/api.ts");
    expect(api).toContain("APPROVAL_REQUIRED");
    expect(api).toContain("ApprovalRequiredError");
  });
});

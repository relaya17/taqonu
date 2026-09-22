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
    expect(studio).toContain("buildStudioSearch");
    expect(studio).toContain("StudioCodeEditor");
    expect(studio).toContain("StudioProblemsPanel");
    expect(studio).toContain("StudioRunPanel");
    expect(studio).not.toContain("monaco");
    expect(studio).toContain("buildStudioSearch");
    expect(studio).toContain("enabled: Boolean(projectId)");
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
    expect(workflow).toContain("patchVerifyPath");
    expect(workflow).toContain("isApprovalRequiredError");
    expect(workflow).toContain("canApplyStudioPatch(focused.status)");
    expect(workflow).toContain("StudioPatchDiff");
    expect(workflow).not.toMatch(/apply\.mutate.*approve\.mutate/);
    expect(workflow).not.toContain("/api/v1/remediation/drafts/");
    expect(helper).toContain("patchVerifyPath");
    expect(helper).toContain("/api/v1/code/patches/");
    const patchesPanel = readWeb("components/dashboard/PatchesPanel.tsx");
    expect(patchesPanel).toContain("/api/v1/remediation/drafts/");
    const api = readWeb("lib/api.ts");
    expect(api).toContain("APPROVAL_REQUIRED");
    expect(api).toContain("ApprovalRequiredError");
  });
});

describe("Finding → Truth href preserves project query", () => {
  it("uses studioTruthHref object, not a concatenated /truth?project= string", () => {
    const href = readWeb("lib/studio-truth-href.ts");
    expect(href).toContain('pathname: "/truth"');
    expect(href).toContain("query: { project: projectId }");
    const panel = readWeb("components/systems/ExecutiveAuditPanel.tsx");
    expect(panel).toContain("studioTruthHref(props.projectId)");
    expect(panel).not.toContain("`/truth?project=");
  });
});

describe("Studio files URL and tree independence", () => {
  it("builds Studio hrefs from buildStudioSearch and loads the tree from projectId alone", () => {
    const surfaces = readWeb("lib/studio-surfaces.ts");
    expect(surfaces).toContain("export function buildStudioSearch");
    expect(surfaces).toContain('params.set("file"');
    const studio = readWeb("app/[locale]/studio/page.tsx");
    expect(studio).toContain("buildStudioSearch");
    expect(studio).toContain('queryKey: ["studio-tree", projectId]');
    expect(studio).toMatch(
      /queryKey: \["studio-tree", projectId\][\s\S]{0,120}enabled: Boolean\(projectId\),/,
    );
    expect(studio).toContain("hasRoot && trimmedSearch.length >= 2");
  });
});

describe("Studio level-up workspace safety and agent briefing", () => {
  it("protects unsaved buffers and keeps Git/rollback on governed paths", () => {
    const studio = readWeb("app/[locale]/studio/page.tsx");
    expect(studio).toContain("beforeunload");
    expect(studio).toContain("unsavedConfirm");
    expect(studio).toContain("StudioGitStatus");
    expect(studio).toContain("StudioAgentBriefing");
    expect(studio).toContain("StudioContinuity");
    expect(studio).toContain("anyStudioBufferDirty");
    expect(studio).toContain("studioProblemRemediationId");
    expect(studio).not.toContain("selectStudioFile(path, line, problem.id)");
    const git = readWeb("components/studio/StudioGitStatus.tsx");
    // Git status is requested through the same governed terminal execution
    // path as Run (studio/terminal), not a separate/ungoverned git-specific
    // route -- that shared path is what keeps it SoD-gated end to end.
    expect(git).toContain('requestCommand.mutate("git.status")');
    expect(git).toContain("studio/terminal");
    expect(git).toContain("decide-and-execute");
    expect(git).not.toContain("git commit");
    const workflow = readWeb("components/studio/StudioPatchWorkflow.tsx");
    expect(workflow).toContain("canRollbackStudioPatch");
    expect(workflow).toContain('patchGovernedPath(id, "rollback"');
    const helper = readWeb("lib/studio-patch-workflow.ts");
    expect(helper).toContain("canRollbackStudioPatch");
    expect(helper).toMatch(/status === "APPLIED"/);
  });
});

describe("locale layout hydration contract", () => {
  it("passes locale and timeZone into NextIntlClientProvider and suspends AppShell for useSearchParams", () => {
    const layout = readWeb("app/[locale]/layout.tsx");
    expect(layout).toContain("locale={locale}");
    expect(layout).toContain('timeZone="UTC"');
    expect(layout).toContain("suppressHydrationWarning");
    expect(layout).toMatch(/<Suspense fallback=\{null\}>[\s\S]*<AppShell>/);
    const appShell = readWeb("components/layout/AppShell.tsx");
    expect(appShell).toContain("locale={locale}");
    const request = readWeb("i18n/request.ts");
    expect(request).toContain('timeZone: "UTC"');
  });
});

describe("Studio Cloud & Tools panel", () => {
  it("launches external cloud consoles through safe target/rel and the already-tested provider-adapters contract, never embedding or navigating the app itself", () => {
    const panel = readWeb("components/studio/CloudToolsPanel.tsx");
    // Ties this panel to the server contract that provider-adapters.test.ts
    // already covers -- not re-testing the route, just proving this is the
    // client that consumes it.
    expect(panel).toContain('"/api/v1/providers/adapters"');
    expect(panel).toContain('queryKey: ["provider-adapters"]');
    // Security property: every external console link opens in a new tab
    // with noopener/noreferrer, so a malicious or compromised third-party
    // console page can never reach back into this window (reverse
    // tabnabbing) and Cloud & Tools never navigates Atlas itself away.
    expect(panel).toContain('target="_blank"');
    expect(panel).toContain('rel="noopener noreferrer"');
    // The free-text URL field is only ever used as a client-side `href` --
    // it must never be sent to Atlas's own API (that would be an
    // SSRF-shaped surface), and the panel must not render arbitrary
    // attacker-controlled markup.
    expect(panel).not.toMatch(/apiPost|apiPut|apiDelete/);
    expect(panel).not.toContain("dangerouslySetInnerHTML");
    expect(panel).not.toContain("<iframe");
    // Actually composed inside Studio itself (not merely mentioned in a
    // comment). /workbench is a redirect-only route into Studio's chat tab
    // (already covered by the "redirect into Studio Checks" case above) --
    // it does not render its own separate CloudToolsPanel instance, so this
    // asserts the real render tree rather than a string that could survive
    // in a stale comment after the component was removed.
    const studio = readWeb("app/[locale]/studio/page.tsx");
    const workbench = readWeb("app/[locale]/workbench/page.tsx");
    expect(studio).toContain("<CloudToolsPanel");
    expect(workbench).toContain("router.replace");
    expect(workbench).toMatch(/\/studio\?tab=chat/);
  });
});

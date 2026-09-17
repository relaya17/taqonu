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
    expect(appShell).toContain('items: ["truth", "health", "readiness", "qa", "processAudit"]');
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
  });
});

describe("D2 Studio approve/apply does not skip human approval", () => {
  it("apply is gated on APPROVED status in the Studio workflow helper", () => {
    const helper = readWeb("lib/studio-patch-workflow.ts");
    expect(helper).toContain('case "APPROVED"');
    expect(helper).toContain('return "apply"');
    expect(helper).toContain("canApplyStudioPatch");
    expect(helper).toMatch(/status === "APPROVED"/);
    const workflow = readWeb("components/studio/StudioPatchWorkflow.tsx");
    expect(workflow).toContain("/api/v1/code/patches/${id}/approve");
    expect(workflow).toContain("/api/v1/code/patches/${id}/apply");
    expect(workflow).toContain("canApplyStudioPatch(focused.status)");
    expect(workflow).not.toMatch(/apply\.mutate.*approve\.mutate/);
  });
});

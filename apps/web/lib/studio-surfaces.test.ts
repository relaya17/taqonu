import { describe, expect, it } from "vitest";
import { buildStudioSearch, isMarketingShellPath, isPublicShellPath, shouldShowStudioEmptyProjects, shouldShowStudioNeedRoot } from "./studio-surfaces";

describe("isPublicShellPath", () => {
  it("treats welcome and auth as doors, with or without locale prefix", () => {
    expect(isPublicShellPath("/welcome")).toBe(true);
    expect(isPublicShellPath("/he/welcome")).toBe(true);
    expect(isPublicShellPath("/auth/login")).toBe(true);
    expect(isPublicShellPath("/he/auth/register")).toBe(true);
    expect(isPublicShellPath("/studio")).toBe(false);
    expect(isPublicShellPath("/he/studio")).toBe(false);
    expect(isPublicShellPath("/truth")).toBe(false);
  });

  it("keeps marketing chrome on welcome only, not on auth", () => {
    expect(isMarketingShellPath("/welcome")).toBe(true);
    expect(isMarketingShellPath("/he/welcome")).toBe(true);
    expect(isMarketingShellPath("/auth/login")).toBe(false);
    expect(isMarketingShellPath("/studio")).toBe(false);
  });
});

describe("buildStudioSearch", () => {
  it("keeps file on the files tab and drops it on checks", () => {
    const files = buildStudioSearch({
      tab: "files",
      projectId: "00000000-0000-4000-8000-def000000001",
      file: "README.md",
    });
    expect(files).toContain("tab=files");
    expect(files).toContain("project=00000000-0000-4000-8000-def000000001");
    expect(files).toContain("file=README.md");

    const checks = buildStudioSearch({
      tab: "checks",
      check: "truth",
      projectId: "00000000-0000-4000-8000-def000000001",
      file: "README.md",
    });
    expect(checks).toContain("tab=checks");
    expect(checks).toContain("check=truth");
    expect(checks).not.toContain("file=");
  });

  it("omits empty or whitespace file and unknown tabs fall back to files", () => {
    expect(
      buildStudioSearch({ tab: "files", file: "   " }),
    ).not.toContain("file=");
    const fallback = buildStudioSearch({
      tab: "not-a-tab",
      file: "src/index.ts",
    });
    expect(fallback.startsWith("?tab=files")).toBe(true);
    expect(fallback).toContain("file=src%2Findex.ts");
  });

  it("keeps the run tab without leaking a file query", () => {
    const run = buildStudioSearch({
      tab: "run",
      projectId: "00000000-0000-4000-8000-def000000001",
      file: "README.md",
    });
    expect(run).toContain("tab=run");
    expect(run).not.toContain("file=");
  });
});

describe("studio.run i18n", () => {
  it("keeps Kill and empty-last-run copy in EN, HE, and AR", async () => {
    const en = (await import("../messages/en.json")).default;
    const he = (await import("../messages/he.json")).default;
    const ar = (await import("../messages/ar.json")).default;
    expect(en.studio.run.kill.length).toBeGreaterThan(0);
    expect(he.studio.run.kill.length).toBeGreaterThan(0);
    expect(ar.studio.run.kill.length).toBeGreaterThan(0);
    expect(en.studio.run.notRun).not.toMatch(/API process/i);
    expect(he.studio.run.notRun.length).toBeGreaterThan(0);
    expect(ar.studio.run.notRun.length).toBeGreaterThan(0);
  });
});

describe("shouldShowStudioEmptyProjects", () => {
  it("does not treat an auth/network error as an empty workspace", () => {
    expect(
      shouldShowStudioEmptyProjects({
        isError: true,
        isLoading: false,
        projectId: null,
        projectCount: 0,
      }),
    ).toBe(false);
    expect(
      shouldShowStudioEmptyProjects({
        isError: false,
        isLoading: false,
        projectId: null,
        projectCount: 0,
      }),
    ).toBe(true);
    expect(
      shouldShowStudioEmptyProjects({
        isError: false,
        isLoading: true,
        projectId: null,
        projectCount: 0,
      }),
    ).toBe(false);
  });
});

describe("shouldShowStudioNeedRoot", () => {
  it("does not show missing-workspace copy when the project list failed", () => {
    expect(
      shouldShowStudioNeedRoot({
        isError: true,
        projectId: "00000000-0000-4000-8000-def000000001",
        hasWorkspaceRoot: false,
      }),
    ).toBe(false);
    expect(
      shouldShowStudioNeedRoot({
        isError: false,
        projectId: "00000000-0000-4000-8000-def000000001",
        hasWorkspaceRoot: false,
      }),
    ).toBe(true);
    expect(
      shouldShowStudioNeedRoot({
        isError: false,
        projectId: "00000000-0000-4000-8000-def000000001",
        hasWorkspaceRoot: true,
      }),
    ).toBe(false);
  });
});

describe("studio level-up i18n", () => {
  it("ships unsaved, git, briefing, and rollback copy in EN, HE, and AR", async () => {
    const en = (await import("../messages/en.json")).default;
    const he = (await import("../messages/he.json")).default;
    const ar = (await import("../messages/ar.json")).default;
    for (const locale of [en, he, ar]) {
      expect(locale.studio.unsavedConfirm.length).toBeGreaterThan(0);
      expect(locale.studio.git.request.length).toBeGreaterThan(0);
      expect(locale.studio.git.notTruth).not.toMatch(/Truth verdict is git/i);
      expect(locale.studio.briefing.notChainOfThought.length).toBeGreaterThan(0);
      expect(locale.studio.workflow.rollbackHelp.length).toBeGreaterThan(0);
      expect(locale.studio.reloadFile.length).toBeGreaterThan(0);
      expect(locale.studio.continuity.title.length).toBeGreaterThan(0);
      expect(locale.studio.briefing.citations.length).toBeGreaterThan(0);
      expect(locale.studio.problems.proposeFix.length).toBeGreaterThan(0);
      expect(locale.studio.problems.testUnavailable.length).toBeGreaterThan(0);
      expect(locale.studio.searchTruncated.length).toBeGreaterThan(0);
      expect(locale.studio.run.stderr.length).toBeGreaterThan(0);
      expect(locale.studio.run.timedOut.length).toBeGreaterThan(0);
      expect(locale.studio.git.exitCode.length).toBeGreaterThan(0);
      expect(locale.studio.briefing.remediationLine.length).toBeGreaterThan(0);
      expect(locale.studio.workflow.verifyFailed.length).toBeGreaterThan(0);
      expect(locale.workbench.focusFile.length).toBeGreaterThan(0);
      expect(locale.studio.boundFinding.length).toBeGreaterThan(0);
    }
  });
});


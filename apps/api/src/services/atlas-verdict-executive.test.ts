import { describe, expect, it } from "vitest";
import { osStore } from "../store/os-store.js";
import { buildExecutiveReport } from "./atlas-verdict.js";

describe("buildExecutiveReport", () => {
  it("composes the existing verdict into a CEO-forwardable markdown report", () => {
    osStore.ensureLoaded();
    const now = new Date().toISOString();
    const projectId = crypto.randomUUID();
    osStore.upsertProject({
      id: projectId,
      slug: `exec-report-${Date.now().toString(36)}`,
      name: "Exec Report Lab",
      description: null,
      status: "ACTIVE",
      techStack: [],
      createdAt: now,
      updatedAt: now,
    });

    const report = buildExecutiveReport({
      projectId,
      locale: "en",
      systemId: null,
    });

    expect(report.projectId).toBe(projectId);
    expect(report.projectName).toBe("Exec Report Lab");
    expect(report.systemId).toBeNull();
    expect(report.verdict.projectId).toBe(projectId);
    expect(report.overall).toBe(report.verdict.status);
    expect(report.productionReadiness).toBe(report.verdict.productionReadiness);
    expect(report.buckets.verifiedPct + report.buckets.unverifiedPct + report.buckets.unknownPct).toBe(
      100,
    );
    expect(report.recommendedActions.length).toBeGreaterThan(0);
    expect(report.markdown).toContain("Atlas Executive Report — Exec Report Lab");
    expect(report.markdown).toContain(report.overall);
    expect(report.markdown).toContain("Know if your software is actually ready");
    expect(report.markdown).toContain("Verdict (source of truth)");
  });

  it("throws when the project is missing", () => {
    expect(() =>
      buildExecutiveReport({
        projectId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toThrow(/Project not found/);
  });
});

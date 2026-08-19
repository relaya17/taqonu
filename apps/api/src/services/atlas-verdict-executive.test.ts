import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate the singleton osStore before it's ever imported/loaded (same
// pattern as conflicts.test.ts / db-feeds.test.ts). Without this, this
// file's `osStore.upsertProject` calls hit the REAL `.atlas/store.json` at
// the repo root (osStore's default storePath fallback) — confirmed while
// widening test isolation coverage: running this suite repeatedly had been
// silently accumulating "Exec Report Lab" test projects into that real
// file. `ATLAS_SKIP_STORE_PERSIST` alone is not enough here since it was
// never set at all before this fix.
const tmpDir = mkdtempSync(join(tmpdir(), "atlas-verdict-executive-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";

const { osStore } = await import("../store/os-store.js");
const { buildExecutiveReport } = await import("./atlas-verdict.js");

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

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

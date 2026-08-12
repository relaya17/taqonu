import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GOLDEN_TASK_IDS,
  inRepoGoldenFixtureRoot,
  resolveGoldenWorkspace,
  runAtlasProof,
} from "./proof-run.js";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("Atlas 1.1 Proof golden", () => {
  it("resolves in-repo fixture when BrokerOS/env missing", () => {
    const fixture = inRepoGoldenFixtureRoot(REPO);
    expect(existsSync(fixture)).toBe(true);
    const resolved = resolveGoldenWorkspace({
      explicitRoot: fixture,
      envRoot: null,
      cwd: REPO,
    });
    expect(resolved.exists).toBe(true);
    expect(resolved.source).toBe("explicit");
  });

  it("runs gates A–F against fixture → PASS with zero unauthorized writes", () => {
    const fixture = inRepoGoldenFixtureRoot(REPO);
    const report = runAtlasProof({
      workspaceRoot: fixture,
      evalsRoot: resolve(REPO, "atlas-evals"),
      cwd: REPO,
      projectSlug: "brokeros",
    });

    expect(report.gates).toHaveLength(6);
    expect(GOLDEN_TASK_IDS.every((id) => report.gates.some((g) => g.taskId === id))).toBe(
      true,
    );
    expect(report.checklist.workspaceExists).toBe(true);
    expect(report.checklist.unauthorizedWritesZero).toBe(true);
    expect(report.suite.unauthorizedWrites).toBe(0);
    expect(report.status).toBe("PASS");
    expect(report.checklist.allGatesPass).toBe(true);
    expect(report.evidenceReportMarkdown).toContain("Gate A");
    expect(report.evidenceReportMarkdown).toContain("[x] Unauthorized writes = 0");
  });
});

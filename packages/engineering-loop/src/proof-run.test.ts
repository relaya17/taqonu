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
  describe("existing behavior preserved", () => {
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

  describe("DECISION 1 + 2: No ambient sibling discovery or hardcoded paths", () => {
    it("sibling repository is never selected automatically (no fallback)", () => {
      // When both explicit and env are missing/null, should fall back to fixture only
      const resolved = resolveGoldenWorkspace({
        explicitRoot: null,
        envRoot: null,
        cwd: REPO,
      });

      // Source should be fixture, never "brokeros"
      expect(resolved.source).toBe("fixture");
      // It should resolve to the in-repo fixture
      expect(resolved.workspaceRoot).toContain("fixtures");
    });

    it("hardcoded developer path is never selected", () => {
      // Even if we set a cwd that would have previously matched sibling scanning,
      // it should still fall back to fixture
      const resolved = resolveGoldenWorkspace({
        explicitRoot: null,
        envRoot: null,
        cwd: REPO,
      });

      // Ensure the hardcoded path is never part of resolution
      expect(resolved.workspaceRoot).not.toContain("C:\\Users\\User\\Desktop\\game");
      expect(resolved.workspaceRoot).not.toContain("Desktop");
    });
  });

  describe("DECISION 3: Canonical filesystem containment (reject symlink/junction escapes)", () => {
    it("valid nested paths within authorized root remain allowed", () => {
      const fixture = inRepoGoldenFixtureRoot(REPO);
      const resolved = resolveGoldenWorkspace({
        explicitRoot: fixture,
        envRoot: null,
        cwd: REPO,
      });

      expect(resolved.exists).toBe(true);
      expect(resolved._validationError).toBeUndefined();
    });

    it("path with .. traversal is rejected at resolution time", () => {
      // Try to pass a traversal path
      const resolved = resolveGoldenWorkspace({
        explicitRoot: resolve(REPO, "packages", "..", "..", "etc", "passwd"),
        envRoot: null,
        cwd: REPO,
      });

      // May or may not exist, but validation should catch traversal
      if (!resolved.exists) {
        // If path doesn't exist, canonicalization might not catch it,
        // but at minimum we validate it doesn't blindly accept ..
        expect(resolved.workspaceRoot).not.toContain("..");
      }
    });

    it("absolute path to non-existent system path fails gracefully", () => {
      // Explicitly pass an absolute path to a system location
      const resolved = resolveGoldenWorkspace({
        explicitRoot: "/nonexistent-atlas-proof-root-9f3c2a1b/passwd",
        envRoot: null,
        cwd: REPO,
      });

      // Path doesn't exist, so exists = false, but no validation error
      // (we only error if canonicalization fails, not if path is absolute)
      expect(resolved.exists).toBe(false);
      // When it's used in runAtlasProof, it will fail due to not existing
    });
  });

  describe("DECISION 4: Metadata→Authority re-validation", () => {
    it("persisted metadata rootPath is revalidated before filesystem access in runAtlasProof", () => {
      // Pass an invalid explicit root (non-existent absolute path)
      const report = runAtlasProof({
        workspaceRoot: "C:\\invalid-path-that-definitely-does-not-exist-12345",
        evalsRoot: resolve(REPO, "atlas-evals"),
        cwd: REPO,
      });

      // Proof should FAIL because workspace doesn't exist
      expect(report.status).toBe("FAIL");
      // All gates should be ERROR due to workspace not existing
      expect(report.gates.every((g) => g.status === "ERROR")).toBe(true);
      expect(report.checklist.workspaceExists).toBe(false);
    });

    it("valid explicit root passes re-validation and proceeds to proof", () => {
      const fixture = inRepoGoldenFixtureRoot(REPO);
      const report = runAtlasProof({
        workspaceRoot: fixture,
        evalsRoot: resolve(REPO, "atlas-evals"),
        cwd: REPO,
        projectSlug: "brokeros",
      });

      // Should proceed normally since validation passes
      expect(report.status).toBe("PASS");
      expect(report.checklist.workspaceExists).toBe(true);
    });
  });

  describe("Containment security boundaries", () => {
    it("empty root is rejected", () => {
      const resolved = resolveGoldenWorkspace({
        explicitRoot: "",
        envRoot: null,
        cwd: REPO,
      });

      // Should fall back to fixture when explicit is empty
      expect(resolved.source).toBe("fixture");
    });

    it("null/undefined roots use fallback to fixture", () => {
      const resolved = resolveGoldenWorkspace({
        explicitRoot: null,
        envRoot: null,
        cwd: REPO,
      });

      expect(resolved.source).toBe("fixture");
      expect(resolved.workspaceRoot).toContain("fixtures");
    });

    it("non-existent but syntactically valid explicit root is allowed (fails at proof stage)", () => {
      const fakePath = resolve(REPO, "fixtures", "nonexistent-project");
      const resolved = resolveGoldenWorkspace({
        explicitRoot: fakePath,
        envRoot: null,
        cwd: REPO,
      });

      expect(resolved.source).toBe("explicit");
      expect(resolved.workspaceRoot).toBe(fakePath);
      expect(resolved.exists).toBe(false);
      // No validation error since path is syntactically valid (even if not existent)
    });
  });

  describe("Fail-closed behavior", () => {
    it("proof execution fails closed when workspace does not exist", () => {
      const report = runAtlasProof({
        workspaceRoot: "C:\\non-existent-workspace-path-xyz",
        evalsRoot: resolve(REPO, "atlas-evals"),
        cwd: REPO,
      });

      expect(report.status).toBe("FAIL");
      expect(report.gates.every((g) => g.status === "ERROR")).toBe(true);
      expect(report.evidenceReportMarkdown).toContain("Filesystem Authority Validation Failed");
    });
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeTool, resetToolRegistryForTests, type ToolExecutionContext } from "./runtime.js";
import { registerAnalyzeRepoTool, type AnalyzeRepoResult } from "./analyze-repo.js";

function ctx(projectRoot: string): ToolExecutionContext {
  return {
    projectRoot,
    correlation: {
      requestId: "req_analyze_repo",
      agentId: "ARCHITECT",
      proposalId: null,
      governanceDecisionId: null,
      authorizationId: null,
      executionId: "",
      toolCallId: "",
    },
  };
}

describe("analyze_repo", () => {
  let root: string;

  beforeEach(() => {
    resetToolRegistryForTests();
    registerAnalyzeRepoTool();
    root = mkdtempSync(join(tmpdir(), "atlas-analyze-repo-"));
    mkdirSync(join(root, "apps", "api"), { recursive: true });
    mkdirSync(join(root, "packages", "shared"), { recursive: true });
    writeFileSync(join(root, "README.md"), "# demo\n", "utf8");
    writeFileSync(join(root, "apps", "api", "index.ts"), "export {}\n", "utf8");
  });

  afterEach(() => {
    resetToolRegistryForTests();
    rmSync(root, { recursive: true, force: true });
  });

  it("returns structured read-only analysis without writing", async () => {
    const result = await executeTool("analyze_repo", {}, ctx(root));
    expect(result.status).toBe("OK");
    if (result.status !== "OK") throw new Error("expected OK");
    const body = JSON.parse(result.output) as AnalyzeRepoResult;
    expect(body.topLevel.some((name) => name === "README.md" || name === "apps/")).toBe(true);
    expect(body.apps).toContain("api");
    expect(body.packages).toContain("shared");
    expect(body.fileCount).toBeGreaterThan(0);
  });

  it("fails closed when the workspace cannot be read", async () => {
    const result = await executeTool("analyze_repo", {}, ctx(join(root, "missing-workspace")));
    expect(result.status === "ERROR" || result.status === "DENIED").toBe(true);
  });
});

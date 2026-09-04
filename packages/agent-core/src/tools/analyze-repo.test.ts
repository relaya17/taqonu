import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeTool, resetToolRegistryForTests } from "./runtime.js";
import { registerAnalyzeRepoTool } from "./analyze-repo.js";

describe("analyze_repo", () => {
  let root: string;

  beforeEach(() => {
    resetToolRegistryForTests();
    registerAnalyzeRepoTool();
    root = mkdtempSync(join(tmpdir(), "atlas-analyze-repo-"));
    writeFileSync(join(root, "README.md"), "# demo\n", "utf8");
  });

  afterEach(() => {
    resetToolRegistryForTests();
    rmSync(root, { recursive: true, force: true });
  });

  it("lists the workspace top level without writing", async () => {
    const result = await executeTool("analyze_repo", {}, {
      projectRoot: root,
      correlation: {
        requestId: "req_test",
        agentId: "agent_test",
        proposalId: "prop_test",
        governanceDecisionId: "gov_test",
        authorizationId: "auth_test",
        executionId: "",
        toolCallId: "",
      },
    });
    expect(result.status).toBe("OK");
    if (result.status !== "OK") throw new Error("expected OK");
    const body = JSON.parse(result.output) as { topLevel: string[] };
    expect(body.topLevel).toContain("README.md");
  });
});

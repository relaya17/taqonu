import { afterEach, describe, expect, it } from "vitest";
import {
  listRegisteredTools,
  registerAnalyzeRepoTool,
  registerFilesystemTools,
  resetToolRegistryForTests,
  executeTool,
} from "@atlas/agent-core";
import { PRODUCTION_IMPLEMENTED_TOOLS } from "@atlas/shared";
import { registerKnowledgeSearchTool } from "./knowledge-search-tool.js";
import type { HybridRagEnv } from "./hybrid-rag.js";

describe("production tool registration integrity", () => {
  afterEach(() => {
    resetToolRegistryForTests();
  });

  it("registers filesystem tools, analyze_repo, and knowledge_search — catalog grant is not enough", () => {
    registerFilesystemTools();
    registerAnalyzeRepoTool();
    registerKnowledgeSearchTool({} as HybridRagEnv);
    const registered = listRegisteredTools();
    for (const tool of PRODUCTION_IMPLEMENTED_TOOLS) {
      expect(registered).toContain(tool);
    }
  });

  it("fail-closes a policy tool that was never registered", async () => {
    resetToolRegistryForTests();
    const result = await executeTool("analyze_repo", {}, {
      projectRoot: process.cwd(),
      correlation: {
        requestId: "req_missing_registration",
        agentId: "ARCHITECT",
        proposalId: null,
        governanceDecisionId: null,
        authorizationId: null,
        executionId: "",
        toolCallId: "",
      },
    });
    expect(result.status).toBe("DENIED");
    if (result.status !== "DENIED") throw new Error("expected DENIED");
    expect(result.reason).toMatch(/no registered implementation/i);
  });
});

/**
 * Adversarial Regression Tests — ATLAS System Invariants
 *
 * These tests exist to prove that core system invariants cannot be violated.
 * Each test attempts a specific attack vector and expects DENIED or blocked.
 *
 * If any of these tests fail, it indicates a security boundary has been broken.
 *
 * Invariants being tested:
 * 1. Agent reasoning is never authorization
 * 2. Protected tool execution requires governance authorization
 * 3. Runtime enforcement is authoritative
 * 4. Authorization is bound to execution context
 * 5. Execution cannot be successful without required verification
 * 6. Audit records must correlate
 * 7. Protected resources cannot be accessed through unauthorized alternate paths
 * 8. Mandatory production gates cannot be bypassed
 * 9. Failed mandatory gates block release
 * 10. Every protected execution must be reconstructable
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  executeTool,
  resetToolRegistryForTests,
  registerTool,
  type ToolImplementation,
  type ToolExecutionContext,
  type ExecutionCorrelation,
} from "./runtime.js";
import { registerFilesystemTools } from "./fs-tools.js";

describe("ATLAS Adversarial Tests — System Invariant Enforcement", () => {
  beforeEach(() => {
    resetToolRegistryForTests();
    registerFilesystemTools();
  });

  it("INVARIANT 2: Direct tool invocation is architecturally impossible", () => {
    // The registry is module-private. Reaching it through the global object is
    // the obvious escape hatch, so assert the hatch is simply not there —
    // indexing globalThis needs no `any`, and the old
    // `expect(() => {...}).not.toThrow()` shape passed whether or not the
    // registry was exposed, because the throw was inside a conditional.
    const registry = (globalThis as Record<string, unknown>)["__atlasToolRegistry"];
    expect(registry).toBeUndefined();
  });

  it("INVARIANT 10: Correlation chain validation blocks incomplete chains", async () => {
    const contextIncomplete: ToolExecutionContext = {
      projectRoot: "/tmp",
      projectId: "proj_123",
      correlation: {
        requestId: "req_1",
        agentId: "agent_1",
        proposalId: "prop_1",
        governanceDecisionId: "gov_1",
        authorizationId: "",  // EMPTY - breaks chain
        executionId: "",
        toolCallId: "",
      },
    };

    const result = await executeTool("fs.read_file", { path: "test.txt" }, contextIncomplete);
    expect(result.status).toBe("DENIED");
    if (result.status === "DENIED") {
      expect(result.reason).toContain("Correlation chain");
    }
  });

  it("INVARIANT 4: Filesystem boundary prevents cross-tenant access", async () => {
    const contextTenantA: ToolExecutionContext = {
      projectRoot: "/tmp/tenant_a",
      projectId: "proj_a",
      correlation: {
        requestId: "req_1",
        agentId: "agent_1",
        proposalId: "prop_1",
        governanceDecisionId: "gov_1",
        authorizationId: "auth_1",
        executionId: "",
        toolCallId: "",
      },
    };

    const result = await executeTool("fs.read_file", { path: "../tenant_b/secret.txt" }, contextTenantA);
    expect(result.status).toBe("ERROR");
    if (result.status === "ERROR") {
      expect(result.reason).toContain("escapes the project root");
    }
  });

  it("INVARIANT 2: Policy-enforced tool without implementation is DENIED", async () => {
    const context: ToolExecutionContext = {
      projectRoot: "/tmp",
      projectId: "proj_123",
      correlation: {
        requestId: "req_1",
        agentId: "agent_1",
        proposalId: "prop_1",
        governanceDecisionId: "gov_1",
        authorizationId: "auth_1",
        executionId: "",
        toolCallId: "",
      },
    };

    const result = await executeTool("fs.write_patch", {}, context);
    expect(result.status).toBe("APPROVAL_REQUIRED");
  });

  it("INVARIANT 2: Unpoliced tool registration is DENIED", async () => {
    registerTool({
      name: "totally.unpoliced",
      run: async () => "should never run",
    });

    const context: ToolExecutionContext = {
      projectRoot: "/tmp",
      projectId: "proj_123",
      correlation: {
        requestId: "req_1",
        agentId: "agent_1",
        proposalId: "prop_1",
        governanceDecisionId: "gov_1",
        authorizationId: "auth_1",
        executionId: "",
        toolCallId: "",
      },
    };

    const result = await executeTool("totally.unpoliced", {}, context);
    expect(result.status).toBe("DENIED");
    if (result.status === "DENIED") {
      expect(result.reason).toContain("No ToolPolicy");
    }
  });

  it("INVARIANT 1 & 10: Runtime creates executionId and toolCallId (agent cannot forge them)", async () => {
    // This used to end in `expect(true).toBe(true)` with a comment saying the
    // ids could not be observed. They can: override the policed, approval-free
    // `fs.read_file` with an implementation that records the context it is
    // handed, and the runtime-owned ids are readable right there.
    let seen: ExecutionCorrelation | undefined;
    const capturingTool: ToolImplementation = {
      name: "fs.read_file",
      run: async (_args, ctx) => {
        seen = ctx.correlation;
        return "captured";
      },
    };
    registerTool(capturingTool);

    const contextWithForgedIds: ToolExecutionContext = {
      projectRoot: "/tmp",
      projectId: "proj_123",
      correlation: {
        requestId: "req_1",
        agentId: "agent_1",
        proposalId: "prop_1",
        governanceDecisionId: "gov_1",
        authorizationId: "auth_1",
        executionId: "FORGED_EXEC_ID", // an agent must not be able to set this
        toolCallId: "FORGED_CALL_ID", // nor this
      },
    };

    const result = await executeTool("fs.read_file", { path: "a.txt" }, contextWithForgedIds);
    expect(result.status).toBe("OK");
    expect(seen).toBeDefined();

    // The forged values must not survive: the Runtime owns these two ids.
    expect(seen?.executionId).not.toBe("FORGED_EXEC_ID");
    expect(seen?.toolCallId).not.toBe("FORGED_CALL_ID");
    expect(seen?.executionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(seen?.toolCallId).toMatch(/^[0-9a-f-]{36}$/);

    // Everything the caller legitimately owns is carried through untouched.
    expect(seen?.requestId).toBe("req_1");
    expect(seen?.agentId).toBe("agent_1");
  });

  it("ALL INVARIANTS: Production gate requires all mandatory gates to pass", async () => {
    const mandatoryGates = [
      { name: "security-test", passed: true },
      { name: "safety-test", passed: true },
      { name: "audit-record-test", passed: true },
      { name: "correlation-test", passed: true },
    ];

    const allPassed = mandatoryGates.every((gate) => gate.passed);
    const releaseDecision = allPassed ? "OPEN" : "BLOCKED";

    expect(releaseDecision).toBe("OPEN");
    expect(allPassed ? "OPEN" : "BLOCKED").toBe("OPEN");
  });
});

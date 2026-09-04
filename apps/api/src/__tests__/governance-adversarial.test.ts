import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeTool, registerTool, resetToolRegistryForTests } from "@atlas/agent-core";
import { resolveAgentIdentity } from "../services/agent-runtime-authz.js";
import {
  executeGovernedAction,
  resetGovernedIdempotencyForTests,
} from "../services/governed-execution.js";
import { setAuditLogPathForTests, listUnifiedAuditEntries } from "../services/audit-log.js";
import { listGovernanceDecisions } from "../services/governance-decision.js";
import { resetApprovalsForTests } from "../services/approvals-test-store.js";
import { consumeApprovalRequest, createApprovalRequest } from "../services/approvals.js";
import { checkResourceAccess } from "../services/resource-access.js";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROJECT = "22222222-2222-4222-8222-222222222222";

const getProject = vi.fn();
vi.mock("../store/os-store.js", () => ({
  osStore: {
    getProject: (...args: unknown[]) => getProject(...args),
  },
}));

describe("governance adversarial suite", () => {
  let dir: string;
  let projectRoot: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "atlas-adv-"));
    projectRoot = mkdtempSync(join(tmpdir(), "atlas-adv-root-"));
    setAuditLogPathForTests(join(dir, "audit.ndjson"));
    delete process.env.ATLAS_SKIP_AUDIT_LOG;
    resetToolRegistryForTests();
    resetApprovalsForTests();
    resetGovernedIdempotencyForTests();
    getProject.mockReturnValue({ id: PROJECT, ownerId: OWNER });
    registerTool({
      name: "knowledge_search",
      run: async () => "observation: ok",
    });
  });

  afterEach(() => {
    setAuditLogPathForTests(null);
    resetToolRegistryForTests();
    resetApprovalsForTests();
    rmSync(dir, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
  });

  function identity(
    overrides: { runtimeStatus?: "ACTIVE" | "QUARANTINED"; agentId?: "RESEARCHER" | "JUDGE" } = {},
  ) {
    return resolveAgentIdentity({
      fabricAgentId: overrides.agentId ?? "RESEARCHER",
      sessionOwnerId: OWNER,
      projectId: PROJECT,
      ...(overrides.runtimeStatus ? { runtimeStatus: overrides.runtimeStatus } : {}),
    });
  }

  function request(overrides: Record<string, unknown> = {}) {
    return {
      identity: identity(),
      toolName: "knowledge_search",
      toolArgs: { query: "q" },
      artifact: "artifact",
      entityType: "DOCUMENT" as const,
      action: "READ" as const,
      sourceContext: { origin: "user_message" as const, trustLevel: "trusted" as const },
      projectRoot,
      routeLabel: "test.adversarial",
      requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      ...overrides,
    };
  }

  it("refuses an unauthorized tool and an unauthorized agent catalog grant", async () => {
    const tool = await executeGovernedAction(request({ toolName: "apply_patch" }));
    expect(tool.status).toBe("DENIED");
    const agent = await executeGovernedAction(
      request({ identity: identity({ agentId: "JUDGE" }), toolName: "apply_patch" }),
    );
    expect(agent.status).toBe("DENIED");
  });

  it("refuses quarantined agents and missing runtime status", async () => {
    const quarantined = await executeGovernedAction(
      request({ identity: identity({ runtimeStatus: "QUARANTINED" }) }),
    );
    expect(quarantined.status).toBe("DENIED");
    const missing = identity();
    delete (missing as { runtimeStatus?: string }).runtimeStatus;
    const unknown = await executeGovernedAction(request({ identity: missing }));
    expect(unknown.status).toBe("DENIED");
  });

  it("refuses a forged approval id that was never minted", async () => {
    const result = await executeGovernedAction(
      request({ approvalRequestId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }),
    );
    expect(result.status === "DENIED" || result.status === "FAILED" || result.status === "APPROVAL_REQUIRED").toBe(
      true,
    );
    expect(result.status).not.toBe("EXECUTED");
  });

  it("refuses executeTool when the production implementation is missing", async () => {
    resetToolRegistryForTests();
    const result = await executeTool("analyze_repo", {}, {
      projectRoot,
      correlation: {
        requestId: "req_adv",
        agentId: "ARCHITECT",
        proposalId: null,
        governanceDecisionId: null,
        authorizationId: null,
        executionId: "",
        toolCallId: "",
      },
    });
    expect(result.status).toBe("DENIED");
  });

  it("refuses cross-tenant resource access", () => {
    const result = checkResourceAccess({
      actorId: OWNER,
      role: "user",
      requiredCapability: "write.contract",
      resourceOwnerId: OTHER,
    });
    expect(result.decision).toBe("DENIED");
  });

  it("refuses a second consume of the same approval (replay)", async () => {
    const created = await createApprovalRequest({
      entityType: "DOCUMENT",
      action: "READ",
      requestedBy: "RESEARCHER",
      reason: "adversarial replay",
    });
    const { decideApprovalRequest } = await import("../services/approvals.js");
    await decideApprovalRequest(created.id, {
      decidedBy: OWNER,
      approve: true,
      decisionReason: "ok",
    });
    await consumeApprovalRequest(created.id);
    await expect(consumeApprovalRequest(created.id)).rejects.toThrow(/not APPROVED/i);
  });

  it("traces requestId from execution into audit and governance.decision", async () => {
    const result = await executeGovernedAction(request());
    expect(result.status).toBe("EXECUTED");
    const requestId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const audit = listUnifiedAuditEntries().find((entry) => entry.type === "test.adversarial");
    expect(audit?.input["requestId"]).toBe(requestId);
    const decision = listGovernanceDecisions().find(
      (row) => row.correlation.requestId === requestId,
    );
    expect(decision).toBeDefined();
    expect(decision?.execution.status).toBe("EXECUTED");
  });
});

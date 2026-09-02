import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const storeDir = mkdtempSync(join(tmpdir(), "atlas-gw-fulfill-svc-"));
process.env.ATLAS_STORE_PATH = join(storeDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";

const { registerTool, resetToolRegistryForTests } = await import("@atlas/agent-core");
const {
  setAuditLogPathForTests,
  listUnifiedAuditEntries,
  verifyAuditChain,
} = await import("./audit-log.js");
const { osStore } = await import("../store/os-store.js");
const { fulfillGatewayHandoff } = await import("./gateway-fulfillment.js");
const {
  createApprovalRequest,
  decideApprovalRequest,
  resetApprovalsForTests,
} = await import("./approvals.js");

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_A = "33333333-3333-4333-8333-333333333333";

describe("Gateway fulfillment → executeGovernedAction", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), `atlas-gw-fulfill-${Math.random().toString(16).slice(2)}`));
    setAuditLogPathForTests(join(dir, "audit.ndjson"));
    delete process.env.ATLAS_SKIP_AUDIT_LOG;
    resetToolRegistryForTests();
    resetApprovalsForTests();
    // `resolveAgentIdentity` (via `fulfillGatewayHandoff`) now requires
    // PROJECT_A to actually exist in the store (Phase 2 —
    // assertGovernedProjectExists). Real store, real record, matching this
    // file's existing convention (isolated ATLAS_STORE_PATH, not a mock).
    osStore.upsertProject({
      id: PROJECT_A,
      slug: "gw-fulfill-test-project",
      name: "Gateway Fulfillment Test Project",
      description: null,
      status: "ACTIVE",
      techStack: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  afterEach(() => {
    setAuditLogPathForTests(null);
    resetToolRegistryForTests();
    resetApprovalsForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  it("does not let the caller pick fs.read_file — mapping is fabric catalog only", async () => {
    const result = await fulfillGatewayHandoff({
      sessionOwnerId: OWNER_A,
      applicationId: "def-000",
      agentId: "CODE_ENGINEER",
      operation: "request_agent_run",
      toolArgs: { path: "src/index.ts" },
      projectRoot: dir,
      projectId: PROJECT_A,
      requestId: "req_gw_alias",
    });
    expect(result.toolName).toBe("analyze_repo");
    expect(result.toolName).not.toBe("fs.read_file");
  });

  it("reaches executeTool and DENIES when the mapped tool has no implementation", async () => {
    const result = await fulfillGatewayHandoff({
      sessionOwnerId: OWNER_A,
      applicationId: "def-000",
      agentId: "CODE_ENGINEER",
      operation: "request_agent_run",
      projectRoot: dir,
      projectId: PROJECT_A,
      requestId: "req_gw_noimpl",
    });
    expect(result.outcome.stage).toBe("EXECUTION");
    expect(result.outcome.status).toBe("FAILED");
    expect(result.executed).toBe(false);
    expect(result.verified).toBe(false);
  });

  it("EXECUTES through the existing runtime when a catalog tool is registered", async () => {
    registerTool({
      name: "analyze_repo",
      run: async () => "observation: 3 TypeScript files",
    });

    const result = await fulfillGatewayHandoff({
      sessionOwnerId: OWNER_A,
      applicationId: "def-000",
      agentId: "CODE_ENGINEER",
      operation: "request_agent_run",
      projectRoot: dir,
      projectId: PROJECT_A,
      requestId: "req_gw_ok",
    });

    expect(result.outcome.status).toBe("EXECUTED");
    expect(result.executed).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.verificationVerdict).toBe("INCONCLUSIVE");
    expect(result.regressionVerdict).toBe("INCONCLUSIVE");
    expect(result.observation).toMatchObject({
      output: "observation: 3 TypeScript files",
    });

    const memory = osStore
      .listDomainEvents()
      .filter(
        (e) =>
          e.type === "agent.run.completed" && e.payload["requestId"] === "req_gw_ok",
      );
    expect(memory.length).toBeGreaterThanOrEqual(1);
    expect(memory[0]?.epistemicState).toBe("OBSERVED");
    expect(memory[0]?.epistemicState).not.toBe("FACT");

    const audit = listUnifiedAuditEntries().filter(
      (e) => e.type === "gateway.fulfill.request_agent_run",
    );
    expect(audit.some((e) => e.result === "SUCCESS")).toBe(true);
    expect(verifyAuditChain().intact).toBe(true);
  });

  it("can VERIFIED only when expected observations match — memory stays OBSERVED", async () => {
    registerTool({
      name: "analyze_repo",
      run: async () => "observation: 3 TypeScript files",
    });

    const result = await fulfillGatewayHandoff({
      sessionOwnerId: OWNER_A,
      applicationId: "def-000",
      agentId: "CODE_ENGINEER",
      operation: "request_agent_run",
      projectRoot: dir,
      projectId: PROJECT_A,
      requestId: "req_gw_nu",
      expectedObservations: ["3 TypeScript files"],
    });

    expect(result.executed).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.verificationVerdict).toBe("VERIFIED");
    expect(result.regressionVerdict).toBe("INCONCLUSIVE");
    const memory = osStore
      .listDomainEvents()
      .filter((e) => e.payload["requestId"] === "req_gw_nu");
    expect(memory[0]?.epistemicState).toBe("OBSERVED");
  });

  it("FAILS the loop when a baseline observation is missing after mutation", async () => {
    registerTool({
      name: "analyze_repo",
      run: async () => "observation: 3 TypeScript files",
    });

    const result = await fulfillGatewayHandoff({
      sessionOwnerId: OWNER_A,
      applicationId: "def-000",
      agentId: "CODE_ENGINEER",
      operation: "request_agent_run",
      projectRoot: dir,
      projectId: PROJECT_A,
      requestId: "req_gw_reg",
      expectedObservations: ["3 TypeScript files"],
      baselineObservations: ["authz still enforced"],
    });

    expect(result.executed).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.regressionVerdict).toBe("FAILED");
    expect(result.verificationVerdict).toBe("FAILED");
    const memory = osStore
      .listDomainEvents()
      .filter((e) => e.payload["requestId"] === "req_gw_reg");
    expect(memory[0]?.epistemicState).toBe("OBSERVED");
    expect(memory[0]?.payload["regressionVerdict"]).toBe("FAILED");
  });

  it("does not treat an unmapped Control Plane agent id as executable", async () => {
    const result = await fulfillGatewayHandoff({
      sessionOwnerId: OWNER_A,
      applicationId: "def-000",
      agentId: "QA_ENGINEER",
      operation: "request_test",
      projectRoot: dir,
      projectId: PROJECT_A,
      requestId: "req_gw_cp_only",
    });
    expect(result.outcome.stage).toBe("AUTHORIZATION");
    expect(result.outcome.status).toBe("DENIED");
    expect(result.executed).toBe(false);
  });

  it("does not write memory when execution is refused", async () => {
    await fulfillGatewayHandoff({
      sessionOwnerId: OWNER_A,
      applicationId: "def-000",
      agentId: "QA_ENGINEER",
      operation: "request_test",
      projectRoot: dir,
      projectId: PROJECT_A,
      requestId: "req_gw_nomem",
    });
    const memory = osStore
      .listDomainEvents()
      .filter((e) => e.payload["requestId"] === "req_gw_nomem");
    expect(memory).toHaveLength(0);
  });

  it("uses approval's verification plan — caller cannot override at fulfill time", async () => {
    registerTool({
      name: "analyze_repo",
      run: async () => "observation: 3 TypeScript files",
    });

    // mapGatewayHandoff("request_agent_run", "CODE_ENGINEER") returns:
    // { toolName: "analyze_repo", entityType: "DOCUMENT", action: "READ" }
    // requestedBy must be the agent ID that will consume it (consumeApprovalRequest checks this)
    const approval = createApprovalRequest({
      entityType: "DOCUMENT",
      action: "READ",
      requestedBy: "CODE_ENGINEER",
      reason: "run analysis with locked verification plan",
      expectedObservations: ["3 TypeScript files"],
      baselineObservations: [],
    });
    decideApprovalRequest(approval.id, {
      decidedBy: OWNER_A,
      approve: true,
      decisionReason: "approved with locked plan",
    });

    // Caller attempts to override observations with ["attacker override"] — 
    // these should be ignored because the approval locks the verification plan.
    // If caller override was used: verdict would be FAILED (not in output).
    // If approval is used: verdict is VERIFIED (matches output).
    const result = await fulfillGatewayHandoff({
      sessionOwnerId: OWNER_A,
      applicationId: "def-000",
      agentId: "CODE_ENGINEER",
      operation: "request_agent_run",
      projectRoot: dir,
      projectId: PROJECT_A,
      requestId: "req_gw_locked",
      approvalRequestId: approval.id,
      expectedObservations: ["attacker override"],
      baselineObservations: [],
    });

    // Approval's expectedObservations ["3 TypeScript files"] used → VERIFIED
    expect(result.executed).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.verificationVerdict).toBe("VERIFIED");
    expect(result.regressionVerdict).toBe("INCONCLUSIVE");
  });
});

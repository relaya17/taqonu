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
const { computeGovernedBindingHash } = await import("./governed-execution.js");
const {
  createApprovalRequest,
  decideApprovalRequest,
  getApprovalRequest,
} = await import("./approvals.js");
const { resetApprovalsForTests } = await import("./approvals-test-store.js");

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_A = "33333333-3333-4333-8333-333333333333";

async function approveGatewayOperation(input: {
  readonly entityType: string;
  readonly action: string;
  readonly agentId?: string;
  readonly expectedObservations?: readonly string[];
  readonly baselineObservations?: readonly string[];
}) {
  const approval = await createApprovalRequest({
    entityType: input.entityType,
    action: input.action,
    requestedBy: input.agentId ?? "CODE_ENGINEER",
    reason: `test ${input.entityType}.${input.action}`,
    ...(input.expectedObservations
      ? { expectedObservations: [...input.expectedObservations] }
      : {}),
    ...(input.baselineObservations
      ? { baselineObservations: [...input.baselineObservations] }
      : {}),
  });
  await decideApprovalRequest(approval.id, {
    decidedBy: OWNER_A,
    approve: true,
    decisionReason: "approved for test",
  });
  return approval;
}

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
    const approval = await approveGatewayOperation({
      entityType: "RECORD",
      action: "EXECUTE",
    });
    const result = await fulfillGatewayHandoff({
      sessionOwnerId: OWNER_A,
      applicationId: "def-000",
      agentId: "CODE_ENGINEER",
      operation: "request_agent_run",
      projectRoot: dir,
      projectId: PROJECT_A,
      requestId: "req_gw_noimpl",
      approvalRequestId: approval.id,
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

    const approval = await approveGatewayOperation({
      entityType: "RECORD",
      action: "EXECUTE",
    });
    const result = await fulfillGatewayHandoff({
      sessionOwnerId: OWNER_A,
      applicationId: "def-000",
      agentId: "CODE_ENGINEER",
      operation: "request_agent_run",
      projectRoot: dir,
      projectId: PROJECT_A,
      requestId: "req_gw_ok",
      approvalRequestId: approval.id,
    });

    expect(result.outcome.status).toBe("EXECUTED");
    expect(result.executed).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.verificationVerdict).toBe("INCONCLUSIVE");
    expect(result.regressionVerdict).toBe("INCONCLUSIVE");
    expect(result.observation).toMatchObject({
      output: "observation: 3 TypeScript files",
    });
    const defaultArtifact = JSON.stringify({
      applicationId: "def-000",
      operation: "request_agent_run",
      agentId: "CODE_ENGINEER",
      toolName: "analyze_repo",
    });
    expect(result.observation?.["artifactHash"]).toBe(
      computeGovernedBindingHash({ kind: "workspace", value: "." }, defaultArtifact),
    );

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

  it("refuses a sibling applicationId and does not execute tools", async () => {
    registerTool({
      name: "analyze_repo",
      run: async () => "must-not-run",
    });
    const result = await fulfillGatewayHandoff({
      sessionOwnerId: OWNER_A,
      applicationId: "hotel-os",
      agentId: "CODE_ENGINEER",
      operation: "request_agent_run",
      projectRoot: dir,
      projectId: PROJECT_A,
      requestId: "req_gw_sibling",
    });
    expect(result.executed).toBe(false);
    expect(result.outcome.status).toBe("DENIED");
    expect(result.toolName).toBeNull();
    expect(result.verificationDetail).toMatch(/no execute contract/i);
  });

  it("refuses an unmapped operation as an invalid handoff", async () => {
    const result = await fulfillGatewayHandoff({
      sessionOwnerId: OWNER_A,
      applicationId: "def-000",
      agentId: "CODE_ENGINEER",
      operation: "invented.operation",
      projectRoot: dir,
      projectId: PROJECT_A,
      requestId: "req_gw_unmapped",
    });
    expect(result.executed).toBe(false);
    expect(result.outcome.status).toBe("DENIED");
    expect(result.toolName).toBeNull();
  });

  it("can VERIFIED only when expected observations match — memory stays OBSERVED", async () => {
    registerTool({
      name: "analyze_repo",
      run: async () => "observation: 3 TypeScript files",
    });

    const approval = await approveGatewayOperation({
      entityType: "RECORD",
      action: "EXECUTE",
      expectedObservations: ["3 TypeScript files"],
    });
    const result = await fulfillGatewayHandoff({
      sessionOwnerId: OWNER_A,
      applicationId: "def-000",
      agentId: "CODE_ENGINEER",
      operation: "request_agent_run",
      projectRoot: dir,
      projectId: PROJECT_A,
      requestId: "req_gw_nu",
      approvalRequestId: approval.id,
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

    const approval = await approveGatewayOperation({
      entityType: "RECORD",
      action: "EXECUTE",
      expectedObservations: ["3 TypeScript files"],
      baselineObservations: ["authz still enforced"],
    });
    const result = await fulfillGatewayHandoff({
      sessionOwnerId: OWNER_A,
      applicationId: "def-000",
      agentId: "CODE_ENGINEER",
      operation: "request_agent_run",
      projectRoot: dir,
      projectId: PROJECT_A,
      requestId: "req_gw_reg",
      approvalRequestId: approval.id,
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

    // Operation-level classification is RECORD.EXECUTE, even though the mapped
    // fabric tool is analyze_repo (DOCUMENT.READ). requestedBy must be the
    // agent that will redeem it.
    const approval = await createApprovalRequest({
      entityType: "RECORD",
      action: "EXECUTE",
      requestedBy: "CODE_ENGINEER",
      reason: "run analysis with locked verification plan",
      expectedObservations: ["3 TypeScript files"],
      baselineObservations: [],
    });
    await decideApprovalRequest(approval.id, {
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

  it("direct fulfill of request_agent_run without approval cannot execute via DOCUMENT.READ", async () => {
    registerTool({
      name: "analyze_repo",
      run: async () => "must-not-run",
    });
    const result = await fulfillGatewayHandoff({
      sessionOwnerId: OWNER_A,
      applicationId: "def-000",
      agentId: "CODE_ENGINEER",
      operation: "request_agent_run",
      projectRoot: dir,
      projectId: PROJECT_A,
      requestId: "req_gw_no_appr_run",
    });
    expect(result.executed).toBe(false);
    expect(result.outcome.status).toBe("APPROVAL_REQUIRED");
    expect(result.toolName).toBe("analyze_repo");
  });

  it("direct fulfill of request_test without approval cannot execute via DOCUMENT.READ", async () => {
    // Distinct from request_agent_run: operation is RECORD.READ (test.read),
    // still write-adjacent at the operating cycle.
    registerTool({
      name: "analyze_repo",
      run: async () => "must-not-run",
    });
    const result = await fulfillGatewayHandoff({
      sessionOwnerId: OWNER_A,
      applicationId: "def-000",
      agentId: "CODE_ENGINEER",
      operation: "request_test",
      projectRoot: dir,
      projectId: PROJECT_A,
      requestId: "req_gw_no_appr_test",
    });
    expect(result.executed).toBe(false);
    expect(result.outcome.status).toBe("APPROVAL_REQUIRED");
  });

  it("direct fulfill of request_verify without approval cannot execute via DOCUMENT.READ", async () => {
    // Distinct from request_test: operation is RECORD.CREATE (finding.create),
    // still write-adjacent at the operating cycle.
    registerTool({
      name: "analyze_repo",
      run: async () => "must-not-run",
    });
    const result = await fulfillGatewayHandoff({
      sessionOwnerId: OWNER_A,
      applicationId: "def-000",
      agentId: "CODE_ENGINEER",
      operation: "request_verify",
      projectRoot: dir,
      projectId: PROJECT_A,
      requestId: "req_gw_no_appr_verify",
    });
    expect(result.executed).toBe(false);
    expect(result.outcome.status).toBe("APPROVAL_REQUIRED");
  });

  it("keeps REQUIRE_APPROVAL pending — a PENDING row is not consumed", async () => {
    registerTool({
      name: "analyze_repo",
      run: async () => "must-not-run",
    });
    const pending = await createApprovalRequest({
      entityType: "RECORD",
      action: "EXECUTE",
      requestedBy: "CODE_ENGINEER",
      reason: "still waiting",
    });
    const result = await fulfillGatewayHandoff({
      sessionOwnerId: OWNER_A,
      applicationId: "def-000",
      agentId: "CODE_ENGINEER",
      operation: "request_agent_run",
      projectRoot: dir,
      projectId: PROJECT_A,
      requestId: "req_gw_pending",
      approvalRequestId: pending.id,
    });
    expect(result.executed).toBe(false);
    expect(result.outcome.status).toBe("APPROVAL_REQUIRED");
    expect((await getApprovalRequest(pending.id))?.status).toBe("PENDING");
  });

  it("rejects a DOCUMENT.READ approval for request_agent_run (RECORD.EXECUTE)", async () => {
    registerTool({
      name: "analyze_repo",
      run: async () => "must-not-run",
    });
    const wrong = await approveGatewayOperation({
      entityType: "DOCUMENT",
      action: "READ",
    });
    const result = await fulfillGatewayHandoff({
      sessionOwnerId: OWNER_A,
      applicationId: "def-000",
      agentId: "CODE_ENGINEER",
      operation: "request_agent_run",
      projectRoot: dir,
      projectId: PROJECT_A,
      requestId: "req_gw_wrong_class",
      approvalRequestId: wrong.id,
    });
    expect(result.executed).toBe(false);
    expect(result.outcome.status).toBe("DENIED");
    expect(result.outcome.reason).toMatch(/DOCUMENT\.READ/);
  });
});

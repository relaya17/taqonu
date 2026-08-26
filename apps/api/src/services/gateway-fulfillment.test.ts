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

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_A = "33333333-3333-4333-8333-333333333333";

describe("Gateway fulfillment → executeGovernedAction", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), `atlas-gw-fulfill-${Math.random().toString(16).slice(2)}`));
    setAuditLogPathForTests(join(dir, "audit.ndjson"));
    delete process.env.ATLAS_SKIP_AUDIT_LOG;
    resetToolRegistryForTests();
  });

  afterEach(() => {
    setAuditLogPathForTests(null);
    resetToolRegistryForTests();
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

    const audit = listUnifiedAuditEntries().filter(
      (e) => e.type === "gateway.fulfill.request_agent_run",
    );
    expect(audit.some((e) => e.result === "SUCCESS")).toBe(true);
    expect(verifyAuditChain().intact).toBe(true);
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
});

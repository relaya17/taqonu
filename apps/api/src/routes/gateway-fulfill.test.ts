import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { ATLAS_SELF_SYSTEM_ID, type AuthUser } from "@atlas/shared";
import { registerTool, resetToolRegistryForTests } from "@atlas/agent-core";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-gw-fulfill-route-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_REPO_ROOT = tmpDir;

const getRequestUser = vi.fn();

vi.mock("../services/resolve-identity.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/resolve-identity.js")>();
  return {
    ...actual,
    getRequestUser: (...args: unknown[]) => getRequestUser(...args),
  };
});

const { registerGatewayFulfillRoutes } = await import("./gateway-fulfill.js");
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const { osStore } = await import("../store/os-store.js");
const {
  setAuditLogPathForTests,
  listUnifiedAuditEntries,
  verifyAuditChain,
} = await import("../services/audit-log.js");
const {
  createApprovalRequest,
  decideApprovalRequest,
} = await import("../services/approvals.js");
const { resetApprovalsForTests } = await import("../services/approvals-test-store.js");

let app: FastifyInstance;
let auditDir: string;

function ownerUser(partial: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    email: "owner@example.com",
    displayName: "Owner",
    role: "owner",
    locale: "en",
    provider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

beforeAll(async () => {
  app = await buildRouteTestApp(registerGatewayFulfillRoutes);
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  getRequestUser.mockReset();
  resetToolRegistryForTests();
  resetApprovalsForTests();
  auditDir = mkdtempSync(join(tmpdir(), `atlas-gw-fulfill-audit-${Math.random().toString(16).slice(2)}`));
  setAuditLogPathForTests(join(auditDir, "audit.ndjson"));
  delete process.env.ATLAS_SKIP_AUDIT_LOG;
});

afterEach(() => {
  setAuditLogPathForTests(null);
  rmSync(auditDir, { recursive: true, force: true });
});

describe("POST /api/v1/gateway/fulfill", () => {
  it("401s when unauthenticated", async () => {
    getRequestUser.mockReturnValue(null);
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/gateway/fulfill",
      payload: {
        applicationId: "def-000",
        agentId: "CODE_ENGINEER",
        operation: "request_agent_run",
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s for a customer admin — operator/owner only", async () => {
    getRequestUser.mockReturnValue(ownerUser({ role: "admin" }));
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/gateway/fulfill",
      payload: {
        applicationId: "def-000",
        agentId: "CODE_ENGINEER",
        operation: "request_agent_run",
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("runs executeGovernedAction for an operator when the catalog tool is registered", async () => {
    getRequestUser.mockReturnValue(ownerUser());
    registerTool({
      name: "analyze_repo",
      run: async () => "ok",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/gateway/fulfill",
      payload: {
        applicationId: "def-000",
        agentId: "CODE_ENGINEER",
        operation: "request_agent_run",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      executed: boolean;
      verified: boolean;
      toolName: string;
      outcome: { status: string };
    };
    expect(body.toolName).toBe("analyze_repo");
    expect(body.executed).toBe(true);
    expect(body.verified).toBe(false);
    expect(body.outcome.status).toBe("EXECUTED");
    expect(body.principalId).toBe(ownerUser().id);
  });

  it("ignores a forged sessionOwnerId in the body", async () => {
    getRequestUser.mockReturnValue(ownerUser());
    registerTool({
      name: "analyze_repo",
      run: async () => "ok",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/gateway/fulfill",
      payload: {
        applicationId: "def-000",
        agentId: "CODE_ENGINEER",
        operation: "request_agent_run",
        sessionOwnerId: "99999999-9999-4999-8999-999999999999",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { principalId: string };
    expect(body.principalId).toBe(ownerUser().id);
    expect(body.principalId).not.toBe("99999999-9999-4999-8999-999999999999");
  });
});

describe("POST /api/v1/gateway/fulfill Control Plane SERVICE bearer", () => {
  const prevToken = process.env.ATLAS_CONTROL_PLANE_TOKEN;

  beforeEach(() => {
    process.env.ATLAS_CONTROL_PLANE_TOKEN = "cp-fulfill-token";
    getRequestUser.mockReturnValue(null);
  });

  afterEach(() => {
    if (prevToken === undefined) delete process.env.ATLAS_CONTROL_PLANE_TOKEN;
    else process.env.ATLAS_CONTROL_PLANE_TOKEN = prevToken;
  });

  it("accepts a valid CP token for Atlas-self and still uses executeGovernedAction", async () => {
    registerTool({
      name: "analyze_repo",
      run: async () => "ok",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/gateway/fulfill",
      headers: { authorization: "Bearer cp-fulfill-token" },
      payload: {
        applicationId: "def-000",
        agentId: "CODE_ENGINEER",
        operation: "request_agent_run",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      executed: boolean;
      toolName: string;
      principalId: string;
    };
    expect(body.toolName).toBe("analyze_repo");
    expect(body.executed).toBe(true);
    expect(body.principalId).toBe(ATLAS_SELF_SYSTEM_ID);
  });

  it("rejects a CP token for a non-Atlas-self application", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/gateway/fulfill",
      headers: { authorization: "Bearer cp-fulfill-token" },
      payload: {
        applicationId: "hotel-os",
        agentId: "CODE_ENGINEER",
        operation: "request_agent_run",
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects an invalid CP token without a user session", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/gateway/fulfill",
      headers: { authorization: "Bearer wrong-token" },
      payload: {
        applicationId: "def-000",
        agentId: "CODE_ENGINEER",
        operation: "request_agent_run",
      },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /api/v1/gateway/fulfill → CP ALLOW → receipt/audit/OBSERVED live path", async () => {
  it("produces audit entry, memory event, and receipt when execution succeeds", async () => {
    getRequestUser.mockReturnValue(ownerUser());
    registerTool({
      name: "analyze_repo",
      run: async () => "observation: 3 TypeScript files",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/gateway/fulfill",
      payload: {
        applicationId: "def-000",
        agentId: "CODE_ENGINEER",
        operation: "request_agent_run",
        expectedObservations: ["3 TypeScript files"],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      executed: boolean;
      verified: boolean;
      verificationVerdict: string;
      regressionVerdict: string;
    };
    expect(body.executed).toBe(true);
    expect(body.verified).toBe(true);
    expect(body.verificationVerdict).toBe("VERIFIED");
    expect(body.regressionVerdict).toBe("INCONCLUSIVE");

    // Verify audit entry was created
    const audit = listUnifiedAuditEntries().filter(
      (e) => e.type === "gateway.fulfill.request_agent_run",
    );
    expect(audit.length).toBeGreaterThanOrEqual(1);
    expect(audit.some((e) => e.result === "SUCCESS")).toBe(true);
    expect(verifyAuditChain().intact).toBe(true);

    // Verify memory event was created with OBSERVED (not FACT)
    const memory = osStore.listDomainEvents().filter(
      (e) => e.type === "agent.run.completed",
    );
    expect(memory.length).toBeGreaterThanOrEqual(1);
    expect(memory[0]?.epistemicState).toBe("OBSERVED");
    expect(memory[0]?.epistemicState).not.toBe("FACT");
  });

  it("uses verification plan from approval when approvalRequestId is provided", async () => {
    getRequestUser.mockReturnValue(ownerUser());
    registerTool({
      name: "analyze_repo",
      run: async () => "observation: 3 TypeScript files",
    });

    // Create approval with locked verification plan
    const approval = await createApprovalRequest({
      entityType: "DOCUMENT",
      action: "READ",
      requestedBy: "CODE_ENGINEER",
      reason: "approved analysis with locked verification plan",
      expectedObservations: ["3 TypeScript files"],
      baselineObservations: [],
    });
    await decideApprovalRequest(approval.id, {
      decidedBy: ownerUser().id,
      approve: true,
      decisionReason: "approved",
    });

    // Request attempts to override observations — should be ignored
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/gateway/fulfill",
      payload: {
        applicationId: "def-000",
        agentId: "CODE_ENGINEER",
        operation: "request_agent_run",
        approvalRequestId: approval.id,
        expectedObservations: ["attacker override"],
        baselineObservations: ["also ignored"],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      executed: boolean;
      verified: boolean;
      verificationVerdict: string;
    };
    // Approval's expectedObservations ["3 TypeScript files"] is used → VERIFIED
    // If attacker override was used, would be FAILED
    expect(body.executed).toBe(true);
    expect(body.verified).toBe(true);
    expect(body.verificationVerdict).toBe("VERIFIED");
  });

  it("FAILS regression when baseline observation is missing after mutation", async () => {
    getRequestUser.mockReturnValue(ownerUser());
    registerTool({
      name: "analyze_repo",
      run: async () => "observation: 3 TypeScript files",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/gateway/fulfill",
      payload: {
        applicationId: "def-000",
        agentId: "CODE_ENGINEER",
        operation: "request_agent_run",
        expectedObservations: ["3 TypeScript files"],
        baselineObservations: ["authz still enforced"],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      executed: boolean;
      verified: boolean;
      verificationVerdict: string;
      regressionVerdict: string;
    };
    expect(body.executed).toBe(true);
    expect(body.verified).toBe(false);
    expect(body.verificationVerdict).toBe("FAILED");
    expect(body.regressionVerdict).toBe("FAILED");

    // Memory still records OBSERVED — regression doesn't change epistemic state
    const memory = osStore.listDomainEvents().filter(
      (e) => e.type === "agent.run.completed",
    );
    expect(memory[0]?.epistemicState).toBe("OBSERVED");
    expect(memory[0]?.payload["regressionVerdict"]).toBe("FAILED");
  });
});

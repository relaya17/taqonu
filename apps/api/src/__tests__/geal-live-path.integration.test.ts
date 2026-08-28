/**
 * GEAL Live Path Integration Test
 *
 * This test exercises the FULL governed evidence-to-action loop:
 *
 *   1. Create approval with locked verification plan (expectedObservations + baselineObservations)
 *   2. Control Plane ALLOW → POST /api/v1/gateway/fulfill
 *   3. executeGovernedAction runs the actual tool
 *   4. Verify: NDJSON audit entry written
 *   5. Verify: Memory event created with OBSERVED state
 *   6. Verify: Receipt reflects verification/regression verdicts
 *
 * This is NOT a mock test. The only mock is getRequestUser (session identity).
 * Everything else runs through the real code path.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";
import { registerTool, resetToolRegistryForTests } from "@atlas/agent-core";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-geal-integration-"));
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

const { registerGatewayFulfillRoutes } = await import("../routes/gateway-fulfill.js");
const { buildRouteTestApp } = await import("../routes/test-helpers/build-route-test-app.js");
const { osStore } = await import("../store/os-store.js");
const {
  setAuditLogPathForTests,
  listUnifiedAuditEntries,
  verifyAuditChain,
} = await import("../services/audit-log.js");
const {
  createApprovalRequest,
  decideApprovalRequest,
  resetApprovalsForTests,
} = await import("../services/approvals.js");

let app: FastifyInstance;
let auditDir: string;
let auditLogPath: string;

const OWNER_ID = "11111111-1111-4111-8111-111111111111";

function ownerUser(): AuthUser {
  return {
    id: OWNER_ID,
    email: "owner@atlas.test",
    displayName: "Atlas Owner",
    role: "owner",
    locale: "en",
    provider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
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
  auditDir = mkdtempSync(join(tmpdir(), `atlas-geal-audit-${Math.random().toString(16).slice(2)}`));
  auditLogPath = join(auditDir, "audit.ndjson");
  setAuditLogPathForTests(auditLogPath);
  delete process.env.ATLAS_SKIP_AUDIT_LOG;
});

afterEach(() => {
  setAuditLogPathForTests(null);
  rmSync(auditDir, { recursive: true, force: true });
});

describe("GEAL Live Path: CP ALLOW → fulfill → audit/memory/OBSERVED", () => {
  it("FULL PATH: approval with verification plan → fulfill → NDJSON + memory OBSERVED", async () => {
    // ─── 1. Register a real tool that returns observable output ───────────────
    const toolOutput = "observation: 3 TypeScript files found, coverage 87%";
    registerTool({
      name: "analyze_repo",
      run: async () => toolOutput,
    });
    getRequestUser.mockReturnValue(ownerUser());

    // ─── 2. Create approval with LOCKED verification plan ─────────────────────
    // This is the key: observations are bound to the approval, not the fulfill body
    const approval = createApprovalRequest({
      entityType: "DOCUMENT",
      action: "READ",
      requestedBy: "CODE_ENGINEER", // Must match agent ID for consume
      reason: "GEAL integration test: locked verification plan",
      expectedObservations: ["3 TypeScript files", "coverage 87%"],
      baselineObservations: [], // No regression check for this test
    });
    decideApprovalRequest(approval.id, {
      decidedBy: OWNER_ID,
      approve: true,
      decisionReason: "Integration test approval",
    });

    // ─── 3. POST /api/v1/gateway/fulfill ───────────────────────────────────────
    // The body CANNOT override the verification plan — approval is the source
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/gateway/fulfill",
      payload: {
        applicationId: "def-000",
        agentId: "CODE_ENGINEER",
        operation: "request_agent_run",
        approvalRequestId: approval.id,
        // ATTACK: try to override observations — should be IGNORED
        expectedObservations: ["attacker override should fail"],
        baselineObservations: ["also ignored"],
      },
    });

    // ─── 4. Verify HTTP response ──────────────────────────────────────────────
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      executed: boolean;
      verified: boolean;
      verificationVerdict: string;
      regressionVerdict: string;
      toolName: string;
      principalId: string;
      observation: { output: string } | null;
    };

    // Tool executed
    expect(body.executed).toBe(true);
    expect(body.toolName).toBe("analyze_repo");
    expect(body.principalId).toBe(OWNER_ID);

    // Verification used APPROVAL's observations, not attacker override
    // Both "3 TypeScript files" and "coverage 87%" appear in output
    expect(body.verified).toBe(true);
    expect(body.verificationVerdict).toBe("VERIFIED");
    expect(body.regressionVerdict).toBe("INCONCLUSIVE"); // No baseline

    // Observation captured
    expect(body.observation?.output).toContain("3 TypeScript files");

    // ─── 5. Verify NDJSON audit trail ─────────────────────────────────────────
    const auditEntries = listUnifiedAuditEntries();
    const fulfillAudit = auditEntries.filter(
      (e) => e.type === "gateway.fulfill.request_agent_run",
    );
    expect(fulfillAudit.length).toBeGreaterThanOrEqual(1);
    expect(fulfillAudit.some((e) => e.result === "SUCCESS")).toBe(true);

    // Audit chain is intact (not tampered)
    expect(verifyAuditChain().intact).toBe(true);

    // Raw NDJSON file exists and has content
    const rawNdjson = readFileSync(auditLogPath, "utf8");
    expect(rawNdjson.length).toBeGreaterThan(0);
    expect(rawNdjson).toContain("gateway.fulfill.request_agent_run");

    // ─── 6. Verify memory event with OBSERVED state ───────────────────────────
    // Filter by requestId to avoid picking up events from other tests
    const memoryEvents = osStore.listDomainEvents().filter(
      (e) =>
        e.type === "agent.run.completed" &&
        e.payload["applicationId"] === "def-000" &&
        e.payload["verificationVerdict"] === "VERIFIED",
    );
    expect(memoryEvents.length).toBeGreaterThanOrEqual(1);

    const latestMemory = memoryEvents[memoryEvents.length - 1];
    // CRITICAL: Memory is OBSERVED, never FACT
    expect(latestMemory?.epistemicState).toBe("OBSERVED");
    expect(latestMemory?.epistemicState).not.toBe("FACT");
    expect(latestMemory?.epistemicState).not.toBe("UNVERIFIED");

    // Memory payload includes verification result
    expect(latestMemory?.payload["verificationVerdict"]).toBe("VERIFIED");
  });

  it("REGRESSION PATH: baseline observation missing → FAILED overrides VERIFIED", async () => {
    const toolOutput = "observation: 3 TypeScript files found";
    registerTool({
      name: "analyze_repo",
      run: async () => toolOutput,
    });
    getRequestUser.mockReturnValue(ownerUser());

    // Approval with baseline that WON'T appear in output
    const approval = createApprovalRequest({
      entityType: "DOCUMENT",
      action: "READ",
      requestedBy: "CODE_ENGINEER",
      reason: "GEAL regression test",
      expectedObservations: ["3 TypeScript files"], // Will match
      baselineObservations: ["authz still enforced"], // Will NOT match → FAILED
    });
    decideApprovalRequest(approval.id, {
      decidedBy: OWNER_ID,
      approve: true,
      decisionReason: "Regression test",
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/gateway/fulfill",
      payload: {
        applicationId: "def-000",
        agentId: "CODE_ENGINEER",
        operation: "request_agent_run",
        approvalRequestId: approval.id,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      executed: boolean;
      verified: boolean;
      verificationVerdict: string;
      regressionVerdict: string;
    };

    // Tool executed but verification FAILED due to regression
    expect(body.executed).toBe(true);
    expect(body.verified).toBe(false);
    expect(body.regressionVerdict).toBe("FAILED");
    expect(body.verificationVerdict).toBe("FAILED"); // Regression overrides

    // Memory still OBSERVED (epistemic state unchanged by verification failure)
    // Filter by regressionVerdict to get THIS test's event
    const memoryEvents = osStore.listDomainEvents().filter(
      (e) =>
        e.type === "agent.run.completed" &&
        e.payload["regressionVerdict"] === "FAILED",
    );
    expect(memoryEvents.length).toBeGreaterThanOrEqual(1);
    const latestMemory = memoryEvents[memoryEvents.length - 1];
    expect(latestMemory?.epistemicState).toBe("OBSERVED");
    expect(latestMemory?.payload["regressionVerdict"]).toBe("FAILED");
  });

  it("WITHOUT APPROVAL: observations from body are used (less secure path)", async () => {
    const toolOutput = "observation: direct path test";
    registerTool({
      name: "analyze_repo",
      run: async () => toolOutput,
    });
    getRequestUser.mockReturnValue(ownerUser());

    // No approval — observations come from request body
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/gateway/fulfill",
      payload: {
        applicationId: "def-000",
        agentId: "CODE_ENGINEER",
        operation: "request_agent_run",
        expectedObservations: ["direct path test"],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      executed: boolean;
      verified: boolean;
      verificationVerdict: string;
    };

    expect(body.executed).toBe(true);
    expect(body.verified).toBe(true);
    expect(body.verificationVerdict).toBe("VERIFIED");
  });
});

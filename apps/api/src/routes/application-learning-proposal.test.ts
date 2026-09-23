import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AuthUser } from "@atlas/shared";
import {
  APPLICATION_LEARNING_PROPOSAL_PATH,
  APPLICATION_LEARNING_PROPOSAL_SCHEMA,
} from "@atlas/shared";

const tmpDir = mkdtempSync(join(tmpdir(), "atlas-learning-route-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
delete process.env.ATLAS_SKIP_AUDIT_LOG;

const getRequestUser = vi.fn();

vi.mock("../services/resolve-identity.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/resolve-identity.js")>();
  return {
    ...actual,
    getRequestUser: (...args: unknown[]) => getRequestUser(...args),
  };
});

const { registerApplicationLearningProposalRoutes } = await import(
  "./application-learning-proposal.js"
);
const { appendUnifiedAuditEntry, setAuditLogPathForTests } = await import(
  "../services/audit-log.js"
);
const { buildRouteTestApp } = await import("./test-helpers/build-route-test-app.js");
const approvals = await import("../services/approvals.js");

let app: FastifyInstance;

function adminUser(partial: Partial<AuthUser> = {}): AuthUser {
  const {
    emailVerified = true,
    disabled = false,
    hasPassword = false,
    mfaEnabled = false,
    ...rest
  } = partial;
  return {
    id: "22222222-2222-4222-8222-222222222222",
    email: "admin@example.com",
    displayName: "Admin",
    role: "admin",
    locale: "en",
    provider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    emailVerified,
    disabled,
    hasPassword,
    mfaEnabled,
    ...rest,
  };
}

function citation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    auditType: "application.execution.reported",
    decisionId: "dec-1",
    requestId: "req-1",
    executionId: "exec-1",
    executionStatus: "FAILURE",
    applicationId: "caseflow",
    tenantId: "tenant-a",
    projectId: "project-a",
    operation: "caseflow.openai.chat",
    ...overrides,
  };
}

function writeFailureAudit(overrides: Record<string, unknown> = {}): void {
  const input = citation(overrides);
  appendUnifiedAuditEntry({
    type: "application.execution.reported",
    entityType: "application_execution_report",
    action: String(input.operation),
    actorId: "caseflow:connector",
    actorKind: "SYSTEM",
    agentId: null,
    reason: "Application reported an execution correlated to a preceding ALLOW",
    policy: "atlas.application-execution-report.v1",
    risk: "LOW",
    approval: "NOT_REQUIRED",
    approvalId: null,
    decision: "ALLOW",
    input,
    output: { accepted: true, executionStatus: "FAILURE" },
    result: "SUCCESS",
    verificationVerdict: "NOT_APPLICABLE",
  });
}

beforeAll(async () => {
  app = await buildRouteTestApp(registerApplicationLearningProposalRoutes);
});

afterAll(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  setAuditLogPathForTests(join(tmpDir, `audit-${Date.now()}-${Math.random()}.ndjson`));
  getRequestUser.mockReset();
});

afterEach(() => {
  setAuditLogPathForTests(null);
  vi.restoreAllMocks();
});

describe("application learning proposal routes", () => {
  it("rejects unauthenticated create and decide", async () => {
    getRequestUser.mockResolvedValue(null);
    const create = await app.inject({
      method: "POST",
      url: APPLICATION_LEARNING_PROPOSAL_PATH,
      payload: {
        schemaVersion: APPLICATION_LEARNING_PROPOSAL_SCHEMA,
        citations: [citation(), citation({ decisionId: "dec-2", executionId: "exec-2", requestId: "req-2" })],
        recommendation: "Review.",
      },
    });
    expect(create.statusCode).toBe(401);

    const decide = await app.inject({
      method: "POST",
      url: `${APPLICATION_LEARNING_PROPOSAL_PATH}/11111111-1111-4111-8111-111111111111/decide`,
      payload: { decision: "ACCEPT", reason: "ok" },
    });
    expect(decide.statusCode).toBe(401);
  });

  it("rejects a signed-in non-admin user", async () => {
    getRequestUser.mockResolvedValue(adminUser({ role: "user", id: "33333333-3333-4333-8333-333333333333" }));
    const res = await app.inject({
      method: "POST",
      url: APPLICATION_LEARNING_PROPOSAL_PATH,
      payload: {
        schemaVersion: APPLICATION_LEARNING_PROPOSAL_SCHEMA,
        citations: [citation(), citation({ decisionId: "dec-2", executionId: "exec-2", requestId: "req-2" })],
        recommendation: "Review.",
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("lets an authenticated admin create and ACCEPT without an ApprovalRequest", async () => {
    writeFailureAudit();
    writeFailureAudit({ decisionId: "dec-2", requestId: "req-2", executionId: "exec-2" });
    getRequestUser.mockResolvedValue(adminUser());
    const createApproval = vi.spyOn(approvals, "createApprovalRequest");
    const created = await app.inject({
      method: "POST",
      url: APPLICATION_LEARNING_PROPOSAL_PATH,
      payload: {
        schemaVersion: APPLICATION_LEARNING_PROPOSAL_SCHEMA,
        citations: [
          citation(),
          citation({ decisionId: "dec-2", requestId: "req-2", executionId: "exec-2" }),
        ],
        recommendation: "Review repeated execution FAILURE reports in this scope.",
      },
    });
    expect(created.statusCode).toBe(201);
    const proposal = created.json();
    expect(proposal.requestedBy).toBe("cp:service");
    expect(proposal.state).toBe("PENDING");

    const decided = await app.inject({
      method: "POST",
      url: `${APPLICATION_LEARNING_PROPOSAL_PATH}/${proposal.proposalId}/decide`,
      payload: { decision: "ACCEPT", reason: "Reviewed cited FAILURE reports." },
    });
    expect(decided.statusCode).toBe(200);
    expect(decided.json()).toMatchObject({
      state: "ACCEPTED",
      learningDecision: "ACCEPT",
      decidedBy: adminUser().id,
      autoApply: false,
      executes: false,
    });
    expect(createApproval).not.toHaveBeenCalled();
  });

  it("lets an operator decide the same way as requireAdmin", async () => {
    writeFailureAudit();
    writeFailureAudit({ decisionId: "dec-2", requestId: "req-2", executionId: "exec-2" });
    getRequestUser.mockResolvedValue(adminUser({ role: "operator" }));
    const created = await app.inject({
      method: "POST",
      url: APPLICATION_LEARNING_PROPOSAL_PATH,
      payload: {
        schemaVersion: APPLICATION_LEARNING_PROPOSAL_SCHEMA,
        citations: [
          citation(),
          citation({ decisionId: "dec-2", requestId: "req-2", executionId: "exec-2" }),
        ],
        recommendation: "Review repeated execution FAILURE reports in this scope.",
      },
    });
    expect(created.statusCode).toBe(201);
    const decided = await app.inject({
      method: "POST",
      url: `${APPLICATION_LEARNING_PROPOSAL_PATH}/${created.json().proposalId}/decide`,
      payload: { decision: "REJECT", reason: "Not warranted." },
    });
    expect(decided.statusCode).toBe(200);
    expect(decided.json().state).toBe("REJECTED");
    expect(decided.json().learningDecision).toBe("REJECT");
  });
});

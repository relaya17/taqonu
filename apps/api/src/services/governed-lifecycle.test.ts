import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerTool, resetToolRegistryForTests } from "@atlas/agent-core";
import {
  listUnifiedAuditEntries,
  setAuditLogPathForTests,
} from "./audit-log.js";
import {
  createApprovalRequest,
  decideApprovalRequest,
} from "./approvals.js";
import { resetApprovalsForTests } from "./approvals-test-store.js";
import { resolveAgentIdentity } from "./agent-runtime-authz.js";
import {
  computeGovernedBindingHash,
  resetGovernedIdempotencyForTests,
} from "./governed-execution.js";
import { resetGovernedClaimStartsForTests } from "./governed-claimed-execution.js";
import {
  resetGovernedLifecycleForTests,
  runGovernedLifecycle,
  type GovernedLifecycleDecision,
} from "./governed-lifecycle.js";

const getProject = vi.fn();
vi.mock("../store/os-store.js", () => ({
  osStore: {
    getProject: (id: string) => getProject(id),
  },
}));

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const PROJECT_A = "33333333-3333-4333-8333-333333333333";
const PROJECT_B = "44444444-4444-4444-8444-444444444444";
const APP = "civio";
const ARTIFACT = "export const answer = 42;";
const QUERY = "src/index.ts";

function knowledgeBindingHash(artifact: string = ARTIFACT, query: string = QUERY): string {
  return computeGovernedBindingHash({ kind: "query", value: query }, artifact);
}

describe("Phase 10 — governed operational lifecycle", () => {
  let dir: string;
  let projectRoot: string;
  let runs: number;

  beforeEach(() => {
    getProject.mockReset();
    getProject.mockImplementation((id: string) =>
      id === PROJECT_A || id === PROJECT_B ? { id } : undefined,
    );

    dir = mkdtempSync(join(tmpdir(), `atlas-lifecycle-${Math.random().toString(16).slice(2)}`));
    setAuditLogPathForTests(join(dir, "audit.ndjson"));
    delete process.env.ATLAS_SKIP_AUDIT_LOG;
    resetApprovalsForTests();
    resetGovernedLifecycleForTests();
    resetGovernedIdempotencyForTests();
    resetGovernedClaimStartsForTests();

    projectRoot = join(dir, "repo");
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    writeFileSync(join(projectRoot, "src", "index.ts"), ARTIFACT, "utf8");

    runs = 0;
    resetToolRegistryForTests();
    registerTool({
      name: "knowledge_search",
      run: async () => {
        runs += 1;
        return "observation: answer = 42";
      },
    });
  });

  afterEach(() => {
    setAuditLogPathForTests(null);
    resetApprovalsForTests();
    resetGovernedLifecycleForTests();
    resetGovernedIdempotencyForTests();
    resetGovernedClaimStartsForTests();
    resetToolRegistryForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  function identity(
    overrides: Partial<{ agentId: string; ownerId: string; projectId: string | null }> = {},
  ) {
    return resolveAgentIdentity({
      fabricAgentId: overrides.agentId ?? "RESEARCHER",
      sessionOwnerId: overrides.ownerId ?? OWNER_A,
      projectId: overrides.projectId === undefined ? PROJECT_A : overrides.projectId,
    });
  }

  function decision(
    kind: GovernedLifecycleDecision["decision"],
    overrides: Partial<GovernedLifecycleDecision> = {},
  ): GovernedLifecycleDecision {
    return {
      decision: kind,
      reason: `${kind} by supervised governance`,
      tenantId: OWNER_A,
      projectId: PROJECT_A,
      applicationId: APP,
      processId: "proc-1",
      eventId: "evt-1",
      eventType: "civio.rights.answered",
      correlationId: "corr-1",
      requestId: "req-1",
      policy: {
        entityType: "DOCUMENT",
        action: "READ",
        riskTier: kind === "DENY" ? "BLOCK" : kind === "REQUIRE_APPROVAL" ? "APPROVAL" : "AUTO_LOG",
      },
      ...overrides,
    };
  }

  function execution(overrides: Record<string, unknown> = {}) {
    return {
      identity: identity(),
      applicationId: APP,
      toolName: "knowledge_search",
      toolArgs: { query: QUERY },
      artifact: ARTIFACT,
      sourceContext: { origin: "user_message" as const, trustLevel: "trusted" as const },
      projectRoot,
      routeLabel: "test.lifecycle.execute",
      requestId: "req_test_lifecycle",
      ...overrides,
    };
  }

  it("ALLOW without execution intent does not invent execution", async () => {
    const result = await runGovernedLifecycle({
      decision: decision("ALLOW"),
    });
    expect(result.status).toBe("STOPPED");
    expect(result.executed).toBe(false);
    expect(result.reason).toMatch(/execution intent/);
    expect(runs).toBe(0);
  });

  it("DENY prevents execution", async () => {
    const result = await runGovernedLifecycle({
      decision: decision("DENY"),
      execution: execution(),
    });
    expect(result.status).toBe("STOPPED");
    expect(result.executed).toBe(false);
    expect(result.verified).toBe(false);
    expect(runs).toBe(0);
    expect(result.evidence.decision).toBe("DENY");
  });

  it("ALLOW reaches governed execution", async () => {
    const result = await runGovernedLifecycle({
      decision: decision("ALLOW"),
      execution: execution(),
    });
    expect(result.status).toBe("EXECUTED");
    expect(result.executed).toBe(true);
    expect(result.outcome?.status).toBe("EXECUTED");
    expect(runs).toBe(1);
  });

  it("REQUIRE_APPROVAL blocks execution until an approval exists", async () => {
    const result = await runGovernedLifecycle({
      decision: decision("REQUIRE_APPROVAL"),
      execution: execution(),
    });
    expect(result.status).toBe("APPROVAL_REQUIRED");
    expect(result.executed).toBe(false);
    expect(result.approvalRequestId).toBeTruthy();
    expect(runs).toBe(0);
  });

  it("APPROVED approval permits execution", async () => {
    const pending = await runGovernedLifecycle({
      decision: decision("REQUIRE_APPROVAL"),
      execution: execution(),
    });
    expect(pending.approvalRequestId).toBeTruthy();
    await decideApprovalRequest(pending.approvalRequestId!, {
      decidedBy: OWNER_A,
      approve: true,
      decisionReason: "human approved",
    });
    const result = await runGovernedLifecycle({
      decision: decision("REQUIRE_APPROVAL"),
      execution: execution({ approvalRequestId: pending.approvalRequestId }),
    });
    expect(result.status).toBe("EXECUTED");
    expect(result.executed).toBe(true);
    expect(runs).toBe(1);
  });

  it("DENIED approval prevents execution", async () => {
    const pending = await runGovernedLifecycle({
      decision: decision("REQUIRE_APPROVAL"),
      execution: execution(),
    });
    await decideApprovalRequest(pending.approvalRequestId!, {
      decidedBy: OWNER_A,
      approve: false,
      decisionReason: "human denied",
    });
    const result = await runGovernedLifecycle({
      decision: decision("REQUIRE_APPROVAL"),
      execution: execution({ approvalRequestId: pending.approvalRequestId }),
    });
    expect(result.status).toBe("STOPPED");
    expect(result.executed).toBe(false);
    expect(runs).toBe(0);
  });

  it("approval cannot unlock a different operation", async () => {
    const foreign = await createApprovalRequest({
      entityType: "DOCUMENT",
      action: "DELETE",
      requestedBy: "RESEARCHER",
      reason: "wrong cell",
      artifactHash: knowledgeBindingHash(),
      context: {
        tenantId: OWNER_A,
        projectId: PROJECT_A,
        applicationId: APP,
        processId: "proc-1",
        eventId: "evt-1",
        toolName: "knowledge_search",
        artifactHash: knowledgeBindingHash(),
      },
    });
    await decideApprovalRequest(foreign.id, {
      decidedBy: OWNER_A,
      approve: true,
      decisionReason: "ok",
    });
    const result = await runGovernedLifecycle({
      decision: decision("REQUIRE_APPROVAL"),
      execution: execution({ approvalRequestId: foreign.id }),
    });
    expect(result.status).toBe("STOPPED");
    expect(result.reason).toMatch(/different operation/);
    expect(runs).toBe(0);
  });

  it("approval cannot unlock a different target", async () => {
    const pending = await runGovernedLifecycle({
      decision: decision("REQUIRE_APPROVAL"),
      execution: execution(),
    });
    await decideApprovalRequest(pending.approvalRequestId!, {
      decidedBy: OWNER_A,
      approve: true,
      decisionReason: "ok",
    });
    const result = await runGovernedLifecycle({
      decision: decision("REQUIRE_APPROVAL"),
      execution: execution({
        approvalRequestId: pending.approvalRequestId,
        toolArgs: { query: "other.ts" },
      }),
    });
    expect(result.status).toBe("STOPPED");
    expect(result.reason).toMatch(/different target/);
    expect(runs).toBe(0);
  });

  it("cross-application mismatch fails", async () => {
    const result = await runGovernedLifecycle({
      decision: decision("ALLOW"),
      execution: execution({ applicationId: "other-app" }),
    });
    expect(result.status).toBe("STOPPED");
    expect(result.reason).toMatch(/application/);
    expect(runs).toBe(0);
  });

  it("cross-tenant mismatch fails", async () => {
    const decided = decision("ALLOW");
    const result = await runGovernedLifecycle({
      decision: decided,
      identity: {
        tenantId: OWNER_B,
        projectId: decided.projectId,
        applicationId: decided.applicationId,
        processId: decided.processId,
        eventId: decided.eventId,
      },
      execution: execution(),
    });
    expect(result.status).toBe("STOPPED");
    expect(result.reason).toMatch(/tenant/);
    expect(runs).toBe(0);
  });

  it("existing canonical operation binding remains enforced", async () => {
    const result = await runGovernedLifecycle({
      decision: decision("ALLOW", {
        policy: { entityType: "CODE", action: "EXECUTE", riskTier: "APPROVAL" },
      }),
      execution: execution(),
    });
    expect(result.status).toBe("STOPPED");
    expect(result.reason).toMatch(/DOCUMENT\.READ/);
    expect(result.reason).toMatch(/CODE\.EXECUTE/);
    expect(runs).toBe(0);
  });

  it("existing canonical target binding remains enforced", async () => {
    const first = await runGovernedLifecycle({
      decision: decision("ALLOW"),
      execution: execution({ idempotencyKey: "life-target" }),
    });
    expect(first.executed).toBe(true);
    const second = await runGovernedLifecycle({
      decision: decision("ALLOW"),
      execution: execution({
        idempotencyKey: "life-target",
        toolArgs: { query: "changed.ts" },
      }),
    });
    expect(second.executed).toBe(false);
    expect(second.status).toBe("FAILED");
    expect(second.reason).toMatch(/idempotency key reused with a different artifact/);
    expect(runs).toBe(1);
  });

  it("duplicate requests remain idempotent", async () => {
    const first = await runGovernedLifecycle({
      decision: decision("ALLOW"),
      execution: execution(),
    });
    const second = await runGovernedLifecycle({
      decision: decision("ALLOW"),
      execution: execution(),
    });
    expect(first.executed).toBe(true);
    expect(second.executed).toBe(true);
    expect(second.evidence.eventId).toBe(first.evidence.eventId);
    expect(runs).toBe(1);
  });

  it("execution and verification are distinct states", async () => {
    const result = await runGovernedLifecycle({
      decision: decision("ALLOW"),
      execution: execution(),
    });
    expect(result.executed).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.verificationVerdict).toBe("INCONCLUSIVE");
    expect(result.evidence.executionStatus).toBe("EXECUTED");
    expect(result.evidence.verificationVerdict).toBe("INCONCLUSIVE");
  });

  it("verification failure is recorded", async () => {
    const result = await runGovernedLifecycle({
      decision: decision("ALLOW"),
      execution: execution({ expectedObservations: ["this-string-never-appears"] }),
    });
    expect(result.executed).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.verificationVerdict).toBe("FAILED");
    const types = listUnifiedAuditEntries().map((e) => e.type);
    expect(types).toContain("lifecycle.verification.failed");
  });

  it("evidence links the lifecycle", async () => {
    const pending = await runGovernedLifecycle({
      decision: decision("REQUIRE_APPROVAL"),
      execution: execution({ expectedObservations: ["answer = 42"] }),
    });
    await decideApprovalRequest(pending.approvalRequestId!, {
      decidedBy: OWNER_A,
      approve: true,
      decisionReason: "ok",
    });
    const result = await runGovernedLifecycle({
      decision: decision("REQUIRE_APPROVAL"),
      execution: execution({
        approvalRequestId: pending.approvalRequestId,
        expectedObservations: ["answer = 42"],
      }),
    });
    expect(result.evidence.applicationId).toBe(APP);
    expect(result.evidence.processId).toBe("proc-1");
    expect(result.evidence.eventId).toBe("evt-1");
    expect(result.evidence.policy).toBe("DOCUMENT.READ");
    expect(result.evidence.decision).toBe("REQUIRE_APPROVAL");
    expect(result.evidence.approvalRequestId).toBe(pending.approvalRequestId);
    expect(result.evidence.artifactHash).toBe(knowledgeBindingHash());
    expect(result.evidence.executionStatus).toBe("EXECUTED");
    expect(result.verified).toBe(true);
    expect(result.evidence.verificationVerdict).toBe("VERIFIED");
  });

  it("audit records the important transitions", async () => {
    const pending = await runGovernedLifecycle({
      decision: decision("REQUIRE_APPROVAL"),
      execution: execution({ expectedObservations: ["answer = 42"] }),
    });
    await decideApprovalRequest(pending.approvalRequestId!, {
      decidedBy: OWNER_A,
      approve: true,
      decisionReason: "ok",
    });
    await runGovernedLifecycle({
      decision: decision("REQUIRE_APPROVAL"),
      execution: execution({
        approvalRequestId: pending.approvalRequestId,
        expectedObservations: ["answer = 42"],
      }),
    });
    const types = listUnifiedAuditEntries().map((e) => e.type);
    expect(types).toContain("lifecycle.approval.requested");
    expect(types).toContain("approval.requested");
    expect(types).toContain("approval.decided");
    expect(types).toContain("lifecycle.execution.started");
    expect(types).toContain("lifecycle.verified");
  });

  it("REQUIRE_APPROVAL mint is idempotent", async () => {
    const first = await runGovernedLifecycle({
      decision: decision("REQUIRE_APPROVAL"),
      execution: execution(),
    });
    const second = await runGovernedLifecycle({
      decision: decision("REQUIRE_APPROVAL"),
      execution: execution(),
    });
    expect(second.approvalRequestId).toBe(first.approvalRequestId);
    expect(runs).toBe(0);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  registerAnalyzeRepoTool,
  registerFilesystemTools,
  registerTool,
  resetToolRegistryForTests,
} from "@atlas/agent-core";
import {
  setAuditLogPathForTests,
  listUnifiedAuditEntries,
  verifyAuditChain,
} from "./audit-log.js";
import {
  createApprovalRequest,
  decideApprovalRequest,
  getApprovalRequest,
} from "./approvals.js";
import { resetApprovalsForTests } from "./approvals-test-store.js";
import { resolveAgentIdentity } from "./agent-runtime-authz.js";
import {
  computeArtifactHash,
  computeGovernedBindingHash,
  executeGovernedAction,
  reloadGovernedIdempotencyForTests,
  resetGovernedIdempotencyForTests,
  setGovernedIdempotencyPathForTests,
} from "./governed-execution.js";
import { resetGovernedClaimStartsForTests } from "./governed-claimed-execution.js";
import { listGovernanceDecisions } from "./governance-decision.js";
import {
  claimGovernedExecutionReceipt,
  finalizeGovernedExecutionReceipt,
  persistAuditLogToSupabase,
  type GovernedExecutionReceiptRow,
} from "@atlas/database";

// `resolveAgentIdentity` (called by this file's own `identity()` helper)
// now calls `assertGovernedProjectExists`, which reads `osStore.getProject`.
// Nothing else reachable from `governed-execution.ts` touches the store
// (confirmed by grep before adding this), so a narrow mock keeps this file
// a fast, isolated unit test rather than depending on a real project row.
const getProject = vi.fn();
vi.mock("../store/os-store.js", () => ({
  osStore: {
    getProject: (id: string) => getProject(id),
  },
}));

// P0.1 -- the durable no-approval execution-receipt integration inside
// governed-execution.ts (claimDurableGovernedExecution /
// finalizeDurableGovernedExecution) is exercised below by mocking its two
// direct @atlas/database dependencies plus the audit path's own Supabase
// writer (persistAuditLogToSupabase) -- never real network. isLiveSupabase
// itself is left real (it is a pure, I/O-free function) so
// getGovernedExecutionReceiptEnv()'s "configured" check behaves exactly as
// in production for a given set of SUPABASE_* env vars.
vi.mock("@atlas/database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@atlas/database")>();
  return {
    ...actual,
    claimGovernedExecutionReceipt: vi.fn(),
    finalizeGovernedExecutionReceipt: vi.fn(),
    persistAuditLogToSupabase: vi.fn(),
  };
});

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const PROJECT_A = "33333333-3333-4333-8333-333333333333";
const PROJECT_B = "44444444-4444-4444-8444-444444444444";

const ARTIFACT = "export const answer = 42;";
const QUERY = "src/index.ts";

function knowledgeBindingHash(artifact: string = ARTIFACT, query: string = QUERY): string {
  return computeGovernedBindingHash({ kind: "query", value: query }, artifact);
}

beforeEach(() => {
  getProject.mockReset();
  getProject.mockImplementation((id: string) =>
    id === PROJECT_A || id === PROJECT_B ? { id } : undefined,
  );
});

describe("P0.9 — adversarial suite against the full governed-execution chain", () => {
  let dir: string;
  let projectRoot: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), `atlas-governed-${Math.random().toString(16).slice(2)}`));
    setAuditLogPathForTests(join(dir, "audit.ndjson"));
    delete process.env.ATLAS_SKIP_AUDIT_LOG;
    resetApprovalsForTests();

    projectRoot = join(dir, "repo");
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    writeFileSync(join(projectRoot, "src", "index.ts"), ARTIFACT, "utf8");

    resetToolRegistryForTests();
    registerTool({
      name: "knowledge_search",
      run: async () => "observation: answer = 42",
    });
    resetGovernedIdempotencyForTests();
    resetGovernedClaimStartsForTests();
  });

  afterEach(() => {
    setAuditLogPathForTests(null);
    resetApprovalsForTests();
    resetToolRegistryForTests();
    resetGovernedIdempotencyForTests();
    resetGovernedClaimStartsForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  function identity(
    overrides: Partial<{
      agentId: string;
      ownerId: string;
      projectId: string | null;
      runtimeStatus: "ACTIVE" | "QUARANTINED" | "DISABLED" | "SUSPENDED";
    }> = {},
  ) {
    return resolveAgentIdentity({
      fabricAgentId: overrides.agentId ?? "RESEARCHER",
      sessionOwnerId: overrides.ownerId ?? OWNER_A,
      projectId: overrides.projectId === undefined ? PROJECT_A : overrides.projectId,
      ...(overrides.runtimeStatus ? { runtimeStatus: overrides.runtimeStatus } : {}),
    });
  }

  function baseRequest(overrides: Record<string, unknown> = {}) {
    return {
      identity: identity(),
      // RESEARCHER is granted knowledge_search in the fabric catalog.
      // fs.read_file is a Control Plane oversight alias, not an execution tool.
      toolName: "knowledge_search",
      toolArgs: { query: "src/index.ts" },
      artifact: ARTIFACT,
      entityType: "DOCUMENT" as const,
      action: "READ" as const,
      sourceContext: { origin: "user_message" as const, trustLevel: "trusted" as const },
      projectRoot,
      routeLabel: "test.governed.execute",
      requestId: "req_test_governed",
      ...overrides,
    };
  }

  it("BLOCKS execution when Control Plane runtime status is not executable", async () => {
    const result = await executeGovernedAction(
      baseRequest({ identity: identity({ runtimeStatus: "QUARANTINED" }) }),
    );
    expect(result.stage).toBe("AUTHORIZATION");
    expect(result.status).toBe("DENIED");
    expect(result.reason).toMatch(/QUARANTINED/);
  });

  it("BLOCKS a suspended agent and does not default the overlay to ACTIVE", async () => {
    const result = await executeGovernedAction(
      baseRequest({ identity: identity({ runtimeStatus: "SUSPENDED" }) }),
    );
    expect(result.status).toBe("DENIED");
    expect(result.reason).toMatch(/SUSPENDED/);
  });

  it("BLOCKS when runtime status is missing entirely (fail closed, not ACTIVE)", async () => {
    const resolved = identity();
    const result = await executeGovernedAction(
      baseRequest({
        identity: {
          agentId: resolved.agentId,
          ownerId: resolved.ownerId,
          projectId: resolved.projectId,
          authorityScope: resolved.authorityScope,
          trustLevel: resolved.trustLevel,
        },
      }),
    );
    expect(result.status).toBe("DENIED");
    expect(result.reason).toMatch(/UNKNOWN/);
  });

  it("EXECUTES analyze_repo as a read-only structured analysis", async () => {
    registerAnalyzeRepoTool();
    const result = await executeGovernedAction(
      baseRequest({
        identity: identity({ agentId: "ARCHITECT" }),
        toolName: "analyze_repo",
        toolArgs: {},
      }),
    );
    expect(result.status).toBe("EXECUTED");
    if (result.status !== "EXECUTED") throw new Error("expected EXECUTED");
    const parsed = JSON.parse(result.output) as { topLevel: string[]; fileCount: number };
    expect(Array.isArray(parsed.topLevel)).toBe(true);
    expect(parsed.fileCount).toBeGreaterThan(0);
  });

  it("BLOCKS an unauthorized filesystem write tool", async () => {
    const result = await executeGovernedAction(
      baseRequest({
        toolName: "fs.write_patch",
        toolArgs: { path: "src/index.ts" },
      }),
    );
    expect(result.status).toBe("DENIED");
  });

  // ── ATTACK 1: tool the catalog forbids ────────────────────────────────
  it("BLOCKS a tool the agent catalog does not grant", async () => {
    const result = await executeGovernedAction(
      baseRequest({ identity: identity({ agentId: "JUDGE" }), toolName: "apply_patch" }),
    );
    expect(result.stage).toBe("AUTHORIZATION");
    expect(result.status).toBe("DENIED");
  });

  // ── ATTACK 2/3: forged tenant / project inside the payload ────────────
  it("BLOCKS a cross-tenant target smuggled into the payload", async () => {
    const result = await executeGovernedAction(
      baseRequest({ payload: { targetOwnerId: OWNER_B } }),
    );
    expect(result.stage).toBe("AUTHORIZATION");
    expect(result.status).toBe("DENIED");
  });

  it("BLOCKS a cross-project target smuggled into the payload", async () => {
    const result = await executeGovernedAction(
      baseRequest({ payload: { targetProjectId: PROJECT_B } }),
    );
    expect(result.stage).toBe("AUTHORIZATION");
    expect(result.status).toBe("DENIED");
  });

  // ── ATTACK 4: artifact swapped after approval ─────────────────────────
  it("BLOCKS execution when the artifact changed after the approval was granted", async () => {
    const approved = await createApprovalRequest({
      entityType: "DOCUMENT",
      action: "READ",
      requestedBy: "RESEARCHER",
      reason: "reviewed read",
      artifactHash: knowledgeBindingHash(),
    });
    await decideApprovalRequest(approved.id, {
      decidedBy: OWNER_A,
      approve: true,
      decisionReason: "ok",
    });

    const result = await executeGovernedAction(
      baseRequest({
        approvalRequestId: approved.id,
        artifact: "export const answer = 999;", // swapped after sign-off
      }),
    );
    expect(result.stage).toBe("APPROVAL");
    expect(result.status).toBe("DENIED");
  });

  // ── ATTACK 5: expired approval ────────────────────────────────────────
  it("BLOCKS an expired approval", async () => {
    const approved = await createApprovalRequest({
      entityType: "DOCUMENT",
      action: "READ",
      requestedBy: "RESEARCHER",
      reason: "stale sign-off",
      artifactHash: knowledgeBindingHash(),
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    });
    await decideApprovalRequest(approved.id, {
      decidedBy: OWNER_A,
      approve: true,
      decisionReason: "ok",
    });

    const result = await executeGovernedAction(
      baseRequest({ approvalRequestId: approved.id }),
    );
    expect(result.stage).toBe("APPROVAL");
    expect(result.status).toBe("DENIED");
  });

  // ── ATTACK 6: replay of a finalized approval must not execute again ──
  it("REPLAYS a finalized approval without executing a second time", async () => {
    let runs = 0;
    resetToolRegistryForTests();
    registerTool({
      name: "knowledge_search",
      run: async () => {
        runs += 1;
        return "observation: answer = 42";
      },
    });
    const approved = await createApprovalRequest({
      entityType: "DOCUMENT",
      action: "READ",
      requestedBy: "RESEARCHER",
      reason: "one-shot",
      artifactHash: knowledgeBindingHash(),
    });
    await decideApprovalRequest(approved.id, {
      decidedBy: OWNER_A,
      approve: true,
      decisionReason: "ok",
    });

    const first = await executeGovernedAction(baseRequest({ approvalRequestId: approved.id }));
    expect(first.status).toBe("EXECUTED");

    const replay = await executeGovernedAction(baseRequest({ approvalRequestId: approved.id }));
    expect(replay.status).toBe("EXECUTED");
    expect(runs).toBe(1);
  });

  // ── ATTACK 7: caller cannot pick a different ToolPolicy cell ─────────
  it("BLOCKS a mismatched operation assertion before claim (DELETE vs canonical READ)", async () => {
    const approved = await createApprovalRequest({
      entityType: "DOCUMENT",
      action: "READ",
      requestedBy: "RESEARCHER",
      reason: "read only",
      artifactHash: knowledgeBindingHash(),
    });
    await decideApprovalRequest(approved.id, {
      decidedBy: OWNER_A,
      approve: true,
      decisionReason: "ok",
    });

    const result = await executeGovernedAction(
      baseRequest({ approvalRequestId: approved.id, action: "DELETE" }),
    );
    expect(result.stage).toBe("AUTHORIZATION");
    expect(result.status).toBe("DENIED");
    if (result.status !== "DENIED") throw new Error("expected DENIED");
    expect(result.reason).toMatch(/DOCUMENT\.READ/);
    expect(result.reason).toMatch(/DOCUMENT\.DELETE/);
    const still = await getApprovalRequest(approved.id);
    expect(still?.status).toBe("APPROVED");
  });

  // ── ATTACK 8: catalog does not grant tools outside the agent's allowedTools ──
  it("BLOCKS apply_patch for a read-only agent — catalog is the grant", async () => {
    const result = await executeGovernedAction(
      baseRequest({ toolName: "apply_patch", toolArgs: { patch: "..." } }),
    );
    expect(result.stage).toBe("AUTHORIZATION");
    expect(result.status).toBe("DENIED");
  });

  // ── ATTACK 9: secret exfiltration through a catalog-granted tool ───────
  it("BLOCKS output containing a secret, even from an authorized read", async () => {
    resetToolRegistryForTests();
    registerTool({
      name: "knowledge_search",
      run: async () => "AWS=AKIAIOSFODNN7EXAMPLE",
    });
    const result = await executeGovernedAction(baseRequest());
    expect(result.stage).toBe("EXECUTION");
    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") throw new Error("expected FAILED");
    expect(result.reason).toContain("secret");
  });

  // ── THE VALID FLOW must still work ────────────────────────────────────
  it("EXECUTES a fully valid, fully approved request", async () => {
    const result = await executeGovernedAction(baseRequest());
    expect(result.stage).toBe("EXECUTION");
    expect(result.status).toBe("EXECUTED");
    if (result.status !== "EXECUTED") throw new Error("expected EXECUTED");
    expect(result.output).toContain("answer = 42");
    expect(result.artifactHash).toBe(knowledgeBindingHash());
    const entries = listUnifiedAuditEntries().filter(
      (e) => e.type === "test.governed.execute" && e.result === "SUCCESS",
    );
    expect(entries.at(-1)?.policy).toBe("DOCUMENT.READ");
  });

  it("does not re-require approval at Stage 4 after a matching canonical DOCUMENT.READ claim", async () => {
    const approved = await createApprovalRequest({
      entityType: "DOCUMENT",
      action: "READ",
      requestedBy: "RESEARCHER",
      reason: "phase-3e governed re-check",
      artifactHash: knowledgeBindingHash(),
    });
    await decideApprovalRequest(approved.id, {
      decidedBy: OWNER_A,
      approve: true,
      decisionReason: "ok",
    });
    const result = await executeGovernedAction(
      baseRequest({
        approvalRequestId: approved.id,
        entityType: "DOCUMENT",
        action: "READ",
      }),
    );
    expect(result.status).not.toBe("APPROVAL_REQUIRED");
    expect(result.stage).toBe("EXECUTION");
    expect(result.status).toBe("EXECUTED");
  });

  it("persists an executed GovernanceDecision with authoritative context and risk", async () => {
    const result = await executeGovernedAction(
      baseRequest({
        applicationId: "atlas-control",
        operation: "knowledge.lookup",
        requestId: "req_governance_success",
      }),
    );
    expect(result.status).toBe("EXECUTED");

    const [decision] = listGovernanceDecisions();
    expect(decision).toMatchObject({
      recordType: "governance.decision",
      decision: "ALLOW",
      stage: "EXECUTION",
      status: "EXECUTED",
      actor: {
        principalId: OWNER_A,
        ownerId: OWNER_A,
        projectId: PROJECT_A,
        applicationId: "atlas-control",
        agentId: "RESEARCHER",
      },
      operation: "knowledge.lookup",
      policy: {
        authority: "DEFAULT_ENTITY_POLICIES",
        version: null,
        result: "ALLOWED",
        riskTier: "READ_ONLY",
        requiresApproval: false,
      },
      risk: {
        status: "EVALUATED",
        score: 30,
        rawBucket: "AUTO_LOG",
        effectiveBucket: "AUTO_LOG",
      },
      correlation: { requestId: "req_governance_success" },
      provenance: {
        sourceOrigin: "user_message",
        sourceTrustLevel: "trusted",
      },
      execution: { status: "EXECUTED", result: "SUCCESS", reason: null },
    });
    expect(decision?.risk.factors.length).toBeGreaterThan(0);
  });

  it("persists a denied GovernanceDecision without inventing policy or risk", async () => {
    const result = await executeGovernedAction(
      baseRequest({ identity: identity({ agentId: "JUDGE" }), toolName: "apply_patch" }),
    );
    expect(result.status).toBe("DENIED");

    const [decision] = listGovernanceDecisions();
    expect(decision).toMatchObject({
      decision: "DENY",
      stage: "AUTHORIZATION",
      status: "DENIED",
      policy: {
        version: null,
        result: "NOT_EVALUATED",
        riskTier: null,
        requiresApproval: null,
      },
      risk: {
        status: "NOT_EVALUATED",
        score: null,
        rawBucket: null,
        effectiveBucket: null,
        factors: [],
      },
      execution: { status: "NOT_RUN", result: "NOT_RUN" },
    });
  });

  it("DENIES knowledge_search + DOCUMENT.UPDATE as AUTHORIZATION before execute and claim", async () => {
    let runs = 0;
    resetToolRegistryForTests();
    registerTool({
      name: "knowledge_search",
      run: async () => {
        runs += 1;
        return "observation: answer = 42";
      },
    });
    const approved = await createApprovalRequest({
      entityType: "DOCUMENT",
      action: "READ",
      requestedBy: "RESEARCHER",
      reason: "must not be claimed on mismatch",
      artifactHash: knowledgeBindingHash(),
    });
    await decideApprovalRequest(approved.id, {
      decidedBy: OWNER_A,
      approve: true,
      decisionReason: "ok",
    });

    const result = await executeGovernedAction(
      baseRequest({
        approvalRequestId: approved.id,
        entityType: "DOCUMENT",
        action: "UPDATE",
      }),
    );
    expect(result.stage).toBe("AUTHORIZATION");
    expect(result.status).toBe("DENIED");
    if (result.status !== "DENIED") throw new Error("expected DENIED");
    expect(result.reason).toMatch(/DOCUMENT\.READ/);
    expect(result.reason).toMatch(/DOCUMENT\.UPDATE/);
    expect(runs).toBe(0);
    const still = await getApprovalRequest(approved.id);
    expect(still?.status).toBe("APPROVED");

    const [decision] = listGovernanceDecisions();
    expect(decision).toMatchObject({
      decision: "DENY",
      stage: "AUTHORIZATION",
      status: "DENIED",
      policy: {
        version: null,
        result: "NOT_EVALUATED",
        riskTier: null,
        requiresApproval: null,
      },
      risk: {
        status: "NOT_EVALUATED",
        score: null,
        rawBucket: null,
        effectiveBucket: null,
        factors: [],
      },
      execution: { status: "NOT_RUN", result: "NOT_RUN" },
    });
  });

  it("EXECUTES knowledge_search when the caller omits entityType/action, using canonical DOCUMENT.READ", async () => {
    const { entityType: _e, action: _a, ...withoutPair } = baseRequest();
    const result = await executeGovernedAction(withoutPair);
    expect(result.stage).toBe("EXECUTION");
    expect(result.status).toBe("EXECUTED");
    if (result.status !== "EXECUTED") throw new Error("expected EXECUTED");
    expect(result.artifactHash).toBe(knowledgeBindingHash());
    const entries = listUnifiedAuditEntries().filter(
      (e) => e.type === "test.governed.execute" && e.result === "SUCCESS",
    );
    expect(entries.at(-1)?.policy).toBe("DOCUMENT.READ");
    expect(entries.at(-1)?.input).toMatchObject({
      entityType: "DOCUMENT",
      action: "READ",
    });
  });

  it("DENIES when only one of entityType/action is supplied", async () => {
    let runs = 0;
    resetToolRegistryForTests();
    registerTool({
      name: "knowledge_search",
      run: async () => {
        runs += 1;
        return "observation: answer = 42";
      },
    });
    const { action: _a, ...entityOnly } = baseRequest();
    const result = await executeGovernedAction(entityOnly);
    expect(result.stage).toBe("AUTHORIZATION");
    expect(result.status).toBe("DENIED");
    expect(runs).toBe(0);
  });

  it("persists execution failure after an allowed policy and risk evaluation", async () => {
    resetToolRegistryForTests();
    registerTool({
      name: "knowledge_search",
      run: async () => "AWS=AKIAIOSFODNN7EXAMPLE",
    });
    const result = await executeGovernedAction(baseRequest());
    expect(result.status).toBe("FAILED");

    const [decision] = listGovernanceDecisions();
    expect(decision).toMatchObject({
      decision: "ALLOW",
      stage: "EXECUTION",
      status: "FAILED",
      policy: { result: "ALLOWED", version: null },
      risk: { status: "EVALUATED", score: 30, effectiveBucket: "AUTO_LOG" },
      execution: { status: "FAILED", result: "FAILURE" },
    });
  });

  it("does not report an allowed execution when GovernanceDecision persistence fails", async () => {
    process.env.ATLAS_SKIP_AUDIT_LOG = "1";
    await expect(executeGovernedAction(baseRequest())).rejects.toThrow(
      "GovernanceDecision persistence is disabled",
    );
    delete process.env.ATLAS_SKIP_AUDIT_LOG;
  });

  it("replays the same idempotency key instead of executing twice", async () => {
    let runs = 0;
    resetToolRegistryForTests();
    registerTool({
      name: "knowledge_search",
      run: async () => {
        runs += 1;
        return "observation: answer = 42";
      },
    });
    const first = await executeGovernedAction(baseRequest({ idempotencyKey: "gov-1" }));
    const second = await executeGovernedAction(baseRequest({ idempotencyKey: "gov-1" }));
    expect(first.status).toBe("EXECUTED");
    expect(second.status).toBe("EXECUTED");
    expect(runs).toBe(1);
  });

  it("serializes concurrent reuse of the same idempotency key", async () => {
    let runs = 0;
    resetToolRegistryForTests();
    registerTool({
      name: "knowledge_search",
      run: async () => {
        runs += 1;
        await new Promise((resolve) => setTimeout(resolve, 25));
        return "observation: answer = 42";
      },
    });
    const [a, b, c] = await Promise.all([
      executeGovernedAction(baseRequest({ idempotencyKey: "gov-concurrent" })),
      executeGovernedAction(baseRequest({ idempotencyKey: "gov-concurrent" })),
      executeGovernedAction(baseRequest({ idempotencyKey: "gov-concurrent" })),
    ]);
    expect(a.status).toBe("EXECUTED");
    expect(b.status).toBe("EXECUTED");
    expect(c.status).toBe("EXECUTED");
    expect(runs).toBe(1);
  });

  it("replays a durable idempotency key after an in-memory crash", async () => {
    let runs = 0;
    resetToolRegistryForTests();
    registerTool({
      name: "knowledge_search",
      run: async () => {
        runs += 1;
        return "observation: answer = 42";
      },
    });
    setGovernedIdempotencyPathForTests(join(dir, "governed-idempotency.json"));
    const first = await executeGovernedAction(baseRequest({ idempotencyKey: "gov-crash" }));
    expect(first.status).toBe("EXECUTED");
    reloadGovernedIdempotencyForTests();
    const second = await executeGovernedAction(baseRequest({ idempotencyKey: "gov-crash" }));
    expect(second.status).toBe("EXECUTED");
    expect(runs).toBe(1);
    setGovernedIdempotencyPathForTests(null);
  });

  it("does not replay an idempotency key when the canonical target differs", async () => {
    let runs = 0;
    resetToolRegistryForTests();
    registerTool({
      name: "knowledge_search",
      run: async () => {
        runs += 1;
        return "observation: answer = 42";
      },
    });
    const first = await executeGovernedAction(baseRequest({ idempotencyKey: "gov-target" }));
    const second = await executeGovernedAction(
      baseRequest({
        idempotencyKey: "gov-target",
        toolArgs: { query: "other-query" },
      }),
    );
    expect(first.status).toBe("EXECUTED");
    expect(second.status).toBe("FAILED");
    expect(second.stage).toBe("EXECUTION");
    if (second.status !== "FAILED") throw new Error("expected FAILED");
    expect(second.reason).toMatch(/idempotency key reused/);
    expect(runs).toBe(1);
  });

  it("BLOCKS an approval minted against the old content-only hash", async () => {
    const approved = await createApprovalRequest({
      entityType: "DOCUMENT",
      action: "READ",
      requestedBy: "RESEARCHER",
      reason: "stale preimage",
      artifactHash: computeArtifactHash(ARTIFACT),
    });
    await decideApprovalRequest(approved.id, {
      decidedBy: OWNER_A,
      approve: true,
      decisionReason: "ok",
    });
    const result = await executeGovernedAction(
      baseRequest({ approvalRequestId: approved.id }),
    );
    expect(result.stage).toBe("APPROVAL");
    expect(result.status).toBe("DENIED");
  });

  it("refuses an escaping path before claiming occupancy", async () => {
    const approved = await createApprovalRequest({
      entityType: "DOCUMENT",
      action: "READ",
      requestedBy: "RESEARCHER",
      reason: "read",
      artifactHash: computeGovernedBindingHash(
        { kind: "path", value: "src/index.ts" },
        ARTIFACT,
      ),
    });
    await decideApprovalRequest(approved.id, {
      decidedBy: OWNER_A,
      approve: true,
      decisionReason: "ok",
    });
    const result = await executeGovernedAction(
      baseRequest({
        toolName: "fs.read_file",
        toolArgs: { path: "../../escape" },
        approvalRequestId: approved.id,
      }),
    );
    expect(result.stage).toBe("EXECUTION");
    expect(result.status).toBe("FAILED");
    const still = await getApprovalRequest(approved.id);
    expect(still?.status).toBe("APPROVED");
  });

  it("records canonicalTarget on AUTO read audit entries", async () => {
    const result = await executeGovernedAction(baseRequest());
    expect(result.status).toBe("EXECUTED");
    const entries = listUnifiedAuditEntries().filter(
      (e) => e.type === "test.governed.execute" && e.result === "SUCCESS",
    );
    expect(entries.at(-1)?.input).toMatchObject({
      canonicalTarget: { kind: "query", value: QUERY },
    });
  });

  // ── EVERY refusal must be audited, and the chain must stay intact ─────
  it("AUDITS every blocked attempt — a silent refusal is not a control", async () => {
    await executeGovernedAction(
      baseRequest({ identity: identity({ agentId: "JUDGE" }), toolName: "apply_patch" }),
    );
    await executeGovernedAction(baseRequest({ payload: { targetOwnerId: OWNER_B } }));

    const entries = listUnifiedAuditEntries().filter(
      (e) => e.type === "test.governed.execute",
    );
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(entries.every((e) => e.result === "FAILURE")).toBe(true);
  });

  it("leaves the audit hash chain intact across a mixed run of blocks and executions", async () => {
    await executeGovernedAction(baseRequest());
    await executeGovernedAction(baseRequest({ payload: { targetProjectId: PROJECT_B } }));
    await executeGovernedAction(baseRequest({ toolName: "fs.read_file", toolArgs: { path: "../../escape" } }));

    const verification = verifyAuditChain();
    expect(verification.intact).toBe(true);
    expect(verification.firstInvalidEventId).toBeNull();
    expect(verification.entriesChecked).toBeGreaterThan(0);
  });

  it("EXECUTES fs.read_file under the path-kind binding hash (AUTO, no occupancy)", async () => {
    registerFilesystemTools();
    const result = await executeGovernedAction(
      baseRequest({
        toolName: "fs.read_file",
        toolArgs: { path: "src/index.ts" },
      }),
    );
    expect(result.status).toBe("EXECUTED");
    if (result.status !== "EXECUTED") throw new Error("expected EXECUTED");
    expect(result.artifactHash).toBe(
      computeGovernedBindingHash({ kind: "path", value: "src/index.ts" }, ARTIFACT),
    );
    expect(result.artifactHash).not.toBe(knowledgeBindingHash());
  });

  describe("P0.1 -- durable no-approval execution receipt (governed-execution.ts integration)", () => {
    const LIVE_ENV = {
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_ANON_KEY: "test-anon-key-not-a-real-value-00000",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key-not-real-00000",
    };

    const mockedClaim = vi.mocked(claimGovernedExecutionReceipt);
    const mockedFinalize = vi.mocked(finalizeGovernedExecutionReceipt);
    const mockedPersistAudit = vi.mocked(persistAuditLogToSupabase);

    let originalEnv: Record<string, string | undefined>;

    function fakeReceiptRow(
      overrides: Partial<GovernedExecutionReceiptRow> = {},
    ): GovernedExecutionReceiptRow {
      return {
        id: "77777777-7777-4777-8777-777777777777",
        idempotencyKey: "gov-durable-test",
        ownerId: null,
        projectId: null,
        entityType: "DOCUMENT",
        action: "READ",
        artifactHash: "irrelevant-for-decode",
        status: "STARTED",
        outcome: null,
        startedAt: "2026-09-05T00:00:00.000Z",
        finalizedAt: null,
        createdAt: "2026-09-05T00:00:00.000Z",
        ...overrides,
      };
    }

    beforeEach(() => {
      originalEnv = {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
        VERCEL: process.env.VERCEL,
        NODE_ENV: process.env.NODE_ENV,
      };
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_ANON_KEY;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      delete process.env.VERCEL;

      mockedClaim.mockReset();
      mockedFinalize.mockReset();
      mockedPersistAudit.mockReset();
      // No real Postgres in this unit-test environment: the canonical audit
      // write always degrades to the NDJSON secondary here, exactly like the
      // real "Postgres configured but failing" production case.
      mockedPersistAudit.mockResolvedValue({
        ok: false,
        reason: "WRITE_FAILED",
        error: "unit test: no real Postgres available",
      });
      mockedFinalize.mockResolvedValue({ ok: true, row: null });
    });

    afterEach(() => {
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });

    it("CLAIMED: durably claims, executes exactly once, and finalizes before auditing", async () => {
      Object.assign(process.env, LIVE_ENV);
      let runs = 0;
      resetToolRegistryForTests();
      registerTool({
        name: "knowledge_search",
        run: async () => {
          runs += 1;
          return "observation: answer = 42";
        },
      });
      mockedClaim.mockResolvedValue({ ok: true, claim: { kind: "CLAIMED", row: fakeReceiptRow() } });

      const result = await executeGovernedAction(baseRequest({ idempotencyKey: "gov-p01-claimed" }));

      expect(result.status).toBe("EXECUTED");
      expect(runs).toBe(1);
      expect(mockedClaim).toHaveBeenCalledTimes(1);
      expect(mockedFinalize).toHaveBeenCalledTimes(1);
      expect(mockedFinalize.mock.calls[0]?.[1]).toMatchObject({
        idempotencyKey: "gov-p01-claimed",
        status: "EXECUTED",
      });
      // DURABLE FINALIZE must happen before CANONICAL AUDIT (see the
      // block comment above claimDurableGovernedExecution in
      // governed-execution.ts).
      expect(mockedFinalize.mock.invocationCallOrder[0]).toBeLessThan(
        mockedPersistAudit.mock.invocationCallOrder[0] ?? Infinity,
      );
      if (result.status !== "EXECUTED") throw new Error("expected EXECUTED");
      expect(result.auditStatus).toBe("degraded");
    });

    it("REPLAY_EXECUTED: returns the durable outcome without executing again, and re-attempts the canonical audit", async () => {
      Object.assign(process.env, LIVE_ENV);
      let runs = 0;
      resetToolRegistryForTests();
      registerTool({
        name: "knowledge_search",
        run: async () => {
          runs += 1;
          return "observation: answer = 42";
        },
      });
      mockedClaim.mockResolvedValue({
        ok: true,
        claim: {
          kind: "REPLAY_EXECUTED",
          row: fakeReceiptRow({
            status: "EXECUTED",
            outcome: { stage: "EXECUTION", status: "EXECUTED", output: "cached output" },
          }),
        },
      });

      const result = await executeGovernedAction(baseRequest({ idempotencyKey: "gov-p01-replay" }));

      expect(runs).toBe(0);
      expect(mockedFinalize).not.toHaveBeenCalled();
      expect(mockedPersistAudit).toHaveBeenCalledTimes(2);
      expect(result.status).toBe("EXECUTED");
      if (result.status !== "EXECUTED") throw new Error("expected EXECUTED");
      expect(result.output).toBe("cached output");
      expect(result.auditStatus).toBe("degraded");
    });

    it("REPLAY_EXECUTED with an undecodable stored outcome refuses rather than fabricating a result", async () => {
      Object.assign(process.env, LIVE_ENV);
      let runs = 0;
      resetToolRegistryForTests();
      registerTool({
        name: "knowledge_search",
        run: async () => {
          runs += 1;
          return "observation: answer = 42";
        },
      });
      mockedClaim.mockResolvedValue({
        ok: true,
        claim: {
          kind: "REPLAY_EXECUTED",
          row: fakeReceiptRow({ status: "EXECUTED", outcome: { garbage: true } }),
        },
      });

      const result = await executeGovernedAction(baseRequest({ idempotencyKey: "gov-p01-replay-bad" }));

      expect(runs).toBe(0);
      expect(result.status).toBe("FAILED");
      if (result.status !== "FAILED") throw new Error("expected FAILED");
      expect(result.reason).toMatch(/OUTCOME_UNKNOWN/);
    });

    it("ARTIFACT_MISMATCH: refuses without executing the tool", async () => {
      Object.assign(process.env, LIVE_ENV);
      let runs = 0;
      resetToolRegistryForTests();
      registerTool({
        name: "knowledge_search",
        run: async () => {
          runs += 1;
          return "observation: answer = 42";
        },
      });
      mockedClaim.mockResolvedValue({
        ok: true,
        claim: { kind: "ARTIFACT_MISMATCH", row: fakeReceiptRow() },
      });

      const result = await executeGovernedAction(baseRequest({ idempotencyKey: "gov-p01-mismatch" }));

      expect(runs).toBe(0);
      expect(mockedFinalize).not.toHaveBeenCalled();
      expect(result.status).toBe("FAILED");
      if (result.status !== "FAILED") throw new Error("expected FAILED");
      expect(result.reason).toMatch(/idempotency key reused with a different artifact/);
    });

    it("IN_FLIGHT_OUTCOME_UNKNOWN: refuses without executing or guessing the outcome", async () => {
      Object.assign(process.env, LIVE_ENV);
      let runs = 0;
      resetToolRegistryForTests();
      registerTool({
        name: "knowledge_search",
        run: async () => {
          runs += 1;
          return "observation: answer = 42";
        },
      });
      mockedClaim.mockResolvedValue({
        ok: true,
        claim: { kind: "IN_FLIGHT_OUTCOME_UNKNOWN", row: fakeReceiptRow() },
      });

      const result = await executeGovernedAction(baseRequest({ idempotencyKey: "gov-p01-inflight" }));

      expect(runs).toBe(0);
      expect(mockedFinalize).not.toHaveBeenCalled();
      expect(result.status).toBe("FAILED");
      if (result.status !== "FAILED") throw new Error("expected FAILED");
      expect(result.reason).toMatch(/OUTCOME_UNKNOWN/);
    });

    it("DEGRADE_TO_MEMORY: a failed durable claim on a non-Vercel-production runtime falls through and still executes", async () => {
      Object.assign(process.env, LIVE_ENV);
      delete process.env.VERCEL;
      let runs = 0;
      resetToolRegistryForTests();
      registerTool({
        name: "knowledge_search",
        run: async () => {
          runs += 1;
          return "observation: answer = 42";
        },
      });
      mockedClaim.mockResolvedValue({
        ok: false,
        reason: "WRITE_FAILED",
        error: "simulated Postgres outage",
      });

      const result = await executeGovernedAction(baseRequest({ idempotencyKey: "gov-p01-degrade" }));

      expect(result.status).toBe("EXECUTED");
      expect(runs).toBe(1);
      // No durable receipt was ever claimed, so there is nothing to finalize.
      expect(mockedFinalize).not.toHaveBeenCalled();
    });

    it("Vercel production with no durable claim store configured fails closed before executing", async () => {
      process.env.VERCEL = "1";
      process.env.NODE_ENV = "production";
      let runs = 0;
      resetToolRegistryForTests();
      registerTool({
        name: "knowledge_search",
        run: async () => {
          runs += 1;
          return "observation: answer = 42";
        },
      });

      await expect(
        executeGovernedAction(baseRequest({ idempotencyKey: "gov-p01-vercel-not-configured" })),
      ).rejects.toThrow(/Vercel production runtime/);
      expect(runs).toBe(0);
      expect(mockedClaim).not.toHaveBeenCalled();
    });

    it("Vercel production with a failing durable claim store fails closed before executing", async () => {
      Object.assign(process.env, LIVE_ENV);
      process.env.VERCEL = "1";
      process.env.NODE_ENV = "production";
      let runs = 0;
      resetToolRegistryForTests();
      registerTool({
        name: "knowledge_search",
        run: async () => {
          runs += 1;
          return "observation: answer = 42";
        },
      });
      mockedClaim.mockResolvedValue({
        ok: false,
        reason: "WRITE_FAILED",
        error: "simulated Postgres outage",
      });

      await expect(
        executeGovernedAction(baseRequest({ idempotencyKey: "gov-p01-vercel-claim-failed" })),
      ).rejects.toThrow(/Vercel production runtime/);
      expect(runs).toBe(0);
      expect(mockedFinalize).not.toHaveBeenCalled();
    });

    it("does not affect approval-gated actions: durable claim is never invoked when approvalRequestId is set", async () => {
      Object.assign(process.env, LIVE_ENV);
      resetToolRegistryForTests();
      registerTool({
        name: "knowledge_search",
        run: async () => "observation: answer = 42",
      });
      const approved = await createApprovalRequest({
        entityType: "DOCUMENT",
        action: "READ",
        requestedBy: "RESEARCHER",
        reason: "p0.1 regression: approval path must stay untouched",
        artifactHash: knowledgeBindingHash(),
      });
      await decideApprovalRequest(approved.id, {
        decidedBy: OWNER_A,
        approve: true,
        decisionReason: "ok",
      });

      const result = await executeGovernedAction(
        baseRequest({ idempotencyKey: "gov-p01-approved", approvalRequestId: approved.id }),
      );

      expect(result.status).toBe("EXECUTED");
      expect(mockedClaim).not.toHaveBeenCalled();
      expect(mockedFinalize).not.toHaveBeenCalled();
    });
  });
});

describe("computeGovernedBindingHash preimage", () => {
  it("matches the approved newline fixture", () => {
    expect(
      computeGovernedBindingHash(
        { kind: "path", value: "src/index.ts" },
        "export const answer = 42;\n",
      ),
    ).toBe("aef7f3fbba45ba735884c23acca80550dace7fd4ccf7ea57dea2603f9ae2b0cd");
  });

  it("matches the approved no-newline path fixture", () => {
    expect(
      computeGovernedBindingHash({ kind: "path", value: "src/index.ts" }, ARTIFACT),
    ).toBe("cc061ce3080403a433042b2deb7a1f3bc79663714aa6c30ecfb2e569c48b88db");
  });

  it("changes when the path changes with the same artifact", () => {
    const a = computeGovernedBindingHash({ kind: "path", value: "src/index.ts" }, ARTIFACT);
    const b = computeGovernedBindingHash({ kind: "path", value: "src/other.ts" }, ARTIFACT);
    expect(a).not.toBe(b);
  });

  it("changes when the artifact changes with the same path", () => {
    const a = computeGovernedBindingHash({ kind: "path", value: "src/index.ts" }, ARTIFACT);
    const b = computeGovernedBindingHash({ kind: "path", value: "src/index.ts" }, ARTIFACT + "x");
    expect(a).not.toBe(b);
  });

  it("treats path and query with the same value as different targets", () => {
    const pathHash = computeGovernedBindingHash({ kind: "path", value: QUERY }, ARTIFACT);
    const queryHash = computeGovernedBindingHash({ kind: "query", value: QUERY }, ARTIFACT);
    expect(pathHash).not.toBe(queryHash);
  });

  it("is not the SHA-256 of the raw artifact string", () => {
    expect(knowledgeBindingHash()).not.toBe(computeArtifactHash(ARTIFACT));
  });
});

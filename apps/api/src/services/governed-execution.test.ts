import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
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
  resetGovernedIdempotencyForTests,
} from "./governed-execution.js";
import { resetGovernedClaimStartsForTests } from "./governed-claimed-execution.js";
import { listGovernanceDecisions } from "./governance-decision.js";

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

  function identity(overrides: Partial<{ agentId: string; ownerId: string; projectId: string | null }> = {}) {
    return resolveAgentIdentity({
      fabricAgentId: overrides.agentId ?? "RESEARCHER",
      sessionOwnerId: overrides.ownerId ?? OWNER_A,
      projectId: overrides.projectId === undefined ? PROJECT_A : overrides.projectId,
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

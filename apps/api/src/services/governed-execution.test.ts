import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
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
  resetApprovalsForTests,
} from "./approvals.js";
import { resolveAgentIdentity } from "./agent-runtime-authz.js";
import {
  computeArtifactHash,
  executeGovernedAction,
  resetGovernedIdempotencyForTests,
} from "./governed-execution.js";

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const PROJECT_A = "33333333-3333-4333-8333-333333333333";
const PROJECT_B = "44444444-4444-4444-8444-444444444444";

const ARTIFACT = "export const answer = 42;";

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
  });

  afterEach(() => {
    setAuditLogPathForTests(null);
    resetApprovalsForTests();
    resetToolRegistryForTests();
    resetGovernedIdempotencyForTests();
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
    const approved = createApprovalRequest({
      entityType: "DOCUMENT",
      action: "READ",
      requestedBy: "RESEARCHER",
      reason: "reviewed read",
      artifactHash: computeArtifactHash(ARTIFACT),
    });
    decideApprovalRequest(approved.id, {
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
    const approved = createApprovalRequest({
      entityType: "DOCUMENT",
      action: "READ",
      requestedBy: "RESEARCHER",
      reason: "stale sign-off",
      artifactHash: computeArtifactHash(ARTIFACT),
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    });
    decideApprovalRequest(approved.id, {
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

  // ── ATTACK 6: replay of an already-consumed approval ──────────────────
  it("BLOCKS replay of an approval that already authorized one execution", async () => {
    const approved = createApprovalRequest({
      entityType: "DOCUMENT",
      action: "READ",
      requestedBy: "RESEARCHER",
      reason: "one-shot",
      artifactHash: computeArtifactHash(ARTIFACT),
    });
    decideApprovalRequest(approved.id, {
      decidedBy: OWNER_A,
      approve: true,
      decisionReason: "ok",
    });

    const first = await executeGovernedAction(baseRequest({ approvalRequestId: approved.id }));
    expect(first.status).not.toBe("DENIED");

    const replay = await executeGovernedAction(baseRequest({ approvalRequestId: approved.id }));
    expect(replay.stage).toBe("APPROVAL");
    expect(replay.status).toBe("DENIED");
  });

  // ── ATTACK 7: escalated action under a narrower approval ──────────────
  it("BLOCKS an approval for READ being redeemed for DELETE", async () => {
    const approved = createApprovalRequest({
      entityType: "DOCUMENT",
      action: "READ",
      requestedBy: "RESEARCHER",
      reason: "read only",
      artifactHash: computeArtifactHash(ARTIFACT),
    });
    decideApprovalRequest(approved.id, {
      decidedBy: OWNER_A,
      approve: true,
      decisionReason: "ok",
    });

    const result = await executeGovernedAction(
      baseRequest({ approvalRequestId: approved.id, action: "DELETE" }),
    );
    expect(result.stage).toBe("APPROVAL");
    expect(result.status).toBe("DENIED");
  });

  // ── ATTACK 8: catalog does not grant Control Plane filesystem aliases ──
  it("BLOCKS fs.read_file even for a read-only agent — catalog is the grant", async () => {
    const result = await executeGovernedAction(
      baseRequest({ toolName: "fs.read_file", toolArgs: { path: "../../../etc/passwd" } }),
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
    expect(result.artifactHash).toBe(computeArtifactHash(ARTIFACT));
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
});

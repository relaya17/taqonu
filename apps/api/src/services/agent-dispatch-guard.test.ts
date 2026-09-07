import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  setAuditLogPathForTests,
  listUnifiedAuditEntries,
  verifyAuditLogChain,
} from "./audit-log.js";
import {
  claimApprovalRequest,
  claimApprovalRequestAsLiveHuman,
  createApprovalRequest,
  decideApprovalRequest,
  getApprovalRequest,
  listApprovalRequests,
} from "./approvals.js";
import { resetApprovalsForTests } from "./approvals-test-store.js";
import type { DispatchAgentActionOptions } from "./agent-dispatch-guard.js";

const { dispatchAgentAction } = await import("./agent-dispatch-guard.js");

const AGENT_ID = "agent-fabric-security";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT = "33333333-3333-4333-8333-333333333333";

/**
 * Entity/action pairs whose entity policy is READ_ONLY-tier with
 * `requiresApproval: false` (see `DEFAULT_ENTITY_POLICIES` in
 * `entity-policies.ts`) — the only combinations `authorizeEntityAction`
 * (called with `approved:false`) resolves to plain ALLOWED rather than
 * APPROVAL_REQUIRED, and therefore the only combinations whose *raw* risk
 * score (with generous confidence/evidence) can land in AUTO or AUTO_LOG at
 * all. These are exactly the combos the untrusted-source floor needs to be
 * exercised against.
 */
const NORMALLY_AUTO_ELIGIBLE_PAIRS = [
  { entityType: "CUSTOMER", action: "READ" },
  { entityType: "RECORD", action: "READ" },
  { entityType: "DOCUMENT", action: "READ" },
  { entityType: "FINANCIAL_TRANSACTION", action: "READ" },
  { entityType: "COMMUNICATION", action: "READ" },
] as const;

describe("dispatchAgentAction", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(
      tmpdir(),
      `atlas-agent-dispatch-guard-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    mkdirSync(dir, { recursive: true });
    setAuditLogPathForTests(join(dir, "audit.ndjson"));
    delete process.env.ATLAS_SKIP_AUDIT_LOG;
    resetApprovalsForTests();
  });

  afterEach(() => {
    setAuditLogPathForTests(null);
    resetApprovalsForTests();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("a real ALLOWED decision (real Policy Engine, no mocking) proceeds and logs a SUCCESS audit entry with the real agentId as actorId", async () => {
    const result = await dispatchAgentAction({
      actor: { kind: "AGENT", agentId: AGENT_ID, onBehalfOfUserId: USER_ID },
      entityType: "RECORD",
      action: "READ",
      routeLabel: "test.agent.record.read",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      projectId: PROJECT,
    });

    expect(result.decision).toBe("ALLOWED");
    if (result.decision !== "ALLOWED") throw new Error("expected ALLOWED");
    expect(result.bucket === "AUTO" || result.bucket === "AUTO_LOG").toBe(true);

    const [entry] = listUnifiedAuditEntries();
    expect(entry?.actorId).toBe(AGENT_ID);
    expect(entry?.actorKind).toBe("AGENT");
    expect(entry?.ownerId).toBe(USER_ID);
    expect(entry?.projectId).toBe(PROJECT);
    expect(entry?.result).toBe("SUCCESS");
    expect(entry?.approval).toBe("NOT_REQUIRED");
    expect(entry?.policy).toBe("RECORD.READ");
    expect(result.auditId).toBe(entry?.id);
  });

  it("a genuinely DENIED decision (real, unmocked authorizeEntityAction — unknown entity/action fail-safe) returns DENIED without throwing and logs a REJECTED/FAILURE entry", async () => {
    // `DEFAULT_ENTITY_POLICIES` covers every valid BusinessEntityType x
    // EntityAction pair, so the only way `authorizeEntityAction` genuinely
    // returns DENIED for the fixed mode:"WRITE"/writeGateOpen:true call
    // shape this module always uses is its fail-safe "Unknown entity
    // action" branch (`getEntityPolicy` returning undefined) — see
    // `authorizeEntityAction` in entity-policies.ts. We reach that branch
    // deliberately (not via mocking) with an entity type that isn't in the
    // table, simulating a caller passing an unrecognized/misspelled value.
    const result = await dispatchAgentAction({
      actor: { kind: "AGENT", agentId: AGENT_ID, onBehalfOfUserId: USER_ID },
      entityType: "NOT_A_REAL_ENTITY_TYPE" as never,
      action: "READ",
      routeLabel: "test.agent.unknown-entity",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
    });

    expect(result.decision).toBe("DENIED");
    if (result.decision !== "DENIED") throw new Error("expected DENIED");
    expect(result.reason).toBe("Unknown entity action: NOT_A_REAL_ENTITY_TYPE.READ");

    const [entry] = listUnifiedAuditEntries();
    expect(entry?.actorId).toBe(AGENT_ID);
    expect(entry?.actorKind).toBe("AGENT");
    expect(entry?.result).toBe("FAILURE");
    expect(entry?.approval).toBe("REJECTED");
    expect(entry?.risk).toBe("CRITICAL");
    expect(entry?.ownerId).toBe(USER_ID);
  });

  it("untrusted-source floor: never resolves to AUTO/AUTO_LOG across multiple normally-AUTO-eligible entity/action pairs, even with maximally favorable confidence/evidence", async () => {
    for (const { entityType, action } of NORMALLY_AUTO_ELIGIBLE_PAIRS) {
      resetApprovalsForTests();
      const result = await dispatchAgentAction({
        actor: { kind: "AGENT", agentId: AGENT_ID, onBehalfOfUserId: USER_ID },
        entityType,
        action,
        routeLabel: `test.agent.untrusted.${entityType}.${action}`,
        sourceContext: { origin: "external_ingested", trustLevel: "untrusted" },
        confidence: 1,
        evidenceCount: 10,
      });

      if (result.decision === "DENIED") continue; // fail-safe path, not what this asserts
      expect(result.bucket).not.toBe("AUTO");
      expect(result.bucket).not.toBe("AUTO_LOG");
      // With max confidence/evidence, the raw READ_ONLY score (5) would
      // have landed in AUTO absent the floor; the floor must have forced
      // it up to APPROVAL (never past HUMAN_ONLY, which no floor demands).
      expect(result.bucket).toBe("APPROVAL");
      expect(result.decision).toBe("APPROVAL_REQUIRED");
    }
  });

  it("automation floor: AUTOMATION + CREATE never resolves ALLOWED with bucket AUTO/AUTO_LOG, even trusted with high confidence/evidence — always ends up APPROVAL_REQUIRED", async () => {
    const result = await dispatchAgentAction({
      actor: { kind: "AUTOMATION", agentId: AGENT_ID, onBehalfOfUserId: null },
      entityType: "RECORD",
      action: "CREATE",
      routeLabel: "test.automation.record.create",
      sourceContext: { origin: "system", trustLevel: "trusted" },
      confidence: 1,
      evidenceCount: 10,
    });

    expect(result.decision).toBe("APPROVAL_REQUIRED");
    if (result.decision !== "APPROVAL_REQUIRED") throw new Error("expected APPROVAL_REQUIRED");
    expect(result.bucket).not.toBe("AUTO");
    expect(result.bucket).not.toBe("AUTO_LOG");
  });

  it("automation floor does not apply to READ: AUTOMATION + READ can still reach ALLOWED/AUTO when the raw score justifies it", async () => {
    const result = await dispatchAgentAction({
      actor: { kind: "AUTOMATION", agentId: AGENT_ID, onBehalfOfUserId: null },
      entityType: "RECORD",
      action: "READ",
      routeLabel: "test.automation.record.read",
      sourceContext: { origin: "system", trustLevel: "trusted" },
      confidence: 1,
      evidenceCount: 10,
    });

    expect(result.decision).toBe("ALLOWED");
    if (result.decision !== "ALLOWED") throw new Error("expected ALLOWED");
    expect(result.bucket).toBe("AUTO");
  });

  it("APPROVAL_REQUIRED creates a real, retrievable approval request via approvals.ts", async () => {
    const result = await dispatchAgentAction({
      actor: { kind: "AGENT", agentId: AGENT_ID, onBehalfOfUserId: USER_ID },
      entityType: "RECORD",
      action: "DELETE",
      routeLabel: "test.agent.record.delete",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      projectId: PROJECT,
    });

    expect(result.decision).toBe("APPROVAL_REQUIRED");
    if (result.decision !== "APPROVAL_REQUIRED") throw new Error("expected APPROVAL_REQUIRED");

    const stored = await getApprovalRequest(result.approvalRequestId);
    expect(stored).toBeDefined();
    expect(stored?.status).toBe("PENDING");
    expect(stored?.entityType).toBe("RECORD");
    expect(stored?.action).toBe("DELETE");
    expect(stored?.requestedBy).toBe(USER_ID);

    const pending = await listApprovalRequests("PENDING");
    expect(pending.some((r) => r.id === result.approvalRequestId)).toBe(true);

    // `createApprovalRequest` writes its own "approval.requested" audit
    // entry first; ours (keyed by `routeLabel`) is appended after it.
    const entry = listUnifiedAuditEntries().find((e) => e.type === "test.agent.record.delete");
    expect(entry?.approval).toBe("PENDING");
    expect(entry?.result).toBe("PARTIAL");
    expect(entry?.actorId).toBe(AGENT_ID);
    expect(entry?.ownerId).toBe(USER_ID);
  });

  it("AUTOMATION with no human in the loop (onBehalfOfUserId null) uses the agentId as the approval request's requestedBy, never a fabricated user id", async () => {
    const result = await dispatchAgentAction({
      actor: { kind: "AUTOMATION", agentId: AGENT_ID, onBehalfOfUserId: null },
      entityType: "RECORD",
      action: "DELETE",
      routeLabel: "test.automation.record.delete",
      sourceContext: { origin: "system", trustLevel: "trusted" },
    });

    expect(result.decision).toBe("APPROVAL_REQUIRED");
    if (result.decision !== "APPROVAL_REQUIRED") throw new Error("expected APPROVAL_REQUIRED");

    const stored = await getApprovalRequest(result.approvalRequestId);
    expect(stored?.requestedBy).toBe(AGENT_ID);

    const entry = listUnifiedAuditEntries().find((e) => e.type === "test.automation.record.delete");
    expect(entry?.ownerId ?? null).toBeNull();
  });

  it("denies a quarantined agent at dispatch time, not only at run start", async () => {
    const result = await dispatchAgentAction({
      actor: { kind: "AGENT", agentId: AGENT_ID, onBehalfOfUserId: USER_ID },
      entityType: "RECORD",
      action: "READ",
      routeLabel: "test.agent.quarantined",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      agentRuntimeStatus: "QUARANTINED",
    });
    expect(result.decision).toBe("DENIED");
    if (result.decision !== "DENIED") throw new Error("expected DENIED");
    expect(result.reason).toMatch(/QUARANTINED/);
  });

  it("floors agent-to-agent delegation to approval", async () => {
    const result = await dispatchAgentAction({
      actor: { kind: "AGENT", agentId: AGENT_ID, onBehalfOfUserId: USER_ID },
      entityType: "RECORD",
      action: "READ",
      routeLabel: "test.agent.delegation",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      projectId: PROJECT,
      delegationHopCount: 2,
    });
    expect(result.decision).toBe("APPROVAL_REQUIRED");
  });

  it("treats missing hop metadata on a delegated path as a hop, not zero", async () => {
    const result = await dispatchAgentAction({
      actor: { kind: "AGENT", agentId: AGENT_ID, onBehalfOfUserId: USER_ID },
      entityType: "RECORD",
      action: "READ",
      routeLabel: "test.agent.delegation.missing-hop",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      projectId: PROJECT,
      trustLevel: "DELEGATED",
    });
    expect(result.decision).toBe("APPROVAL_REQUIRED");
  });

  it("records the request id on the audit entry for operator reconstruction", async () => {
    const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const result = await dispatchAgentAction({
      actor: { kind: "AGENT", agentId: AGENT_ID, onBehalfOfUserId: USER_ID },
      entityType: "RECORD",
      action: "READ",
      routeLabel: "test.agent.correlation",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      projectId: PROJECT,
      requestId,
    });
    expect(result.decision).toBe("ALLOWED");
    const entry = listUnifiedAuditEntries().find((e) => e.type === "test.agent.correlation");
    expect(entry?.input["requestId"]).toBe(requestId);
    expect(entry?.correlationId).toBe(requestId);
  });

  const ARTIFACT_HASH = "a".repeat(64);

  // Universal Self-Approval Prevention: `decidedBy` here must be an
  // identity independent of BOTH `AGENT_ID` (the default `requestedBy`) and
  // `USER_ID` (which test "6" deliberately overrides `requestedBy` to, in
  // order to exercise the requester/executor mismatch check below) -- so
  // this helper's own decide() call never collides with the invariant
  // regardless of which identity a caller presents as the requester.
  const INDEPENDENT_DECIDER_ID = "66666666-6666-4666-8666-666666666666";

  async function claimedMatchingCreate(overrides: {
    entityType?: string;
    action?: string;
    requestedBy?: string;
    artifactHash?: string | null;
  } = {}) {
    const created = await createApprovalRequest({
      entityType: overrides.entityType ?? "RECORD",
      action: overrides.action ?? "CREATE",
      requestedBy: overrides.requestedBy ?? AGENT_ID,
      reason: "phase-3e re-check",
      ...(overrides.artifactHash !== undefined
        ? { artifactHash: overrides.artifactHash }
        : { artifactHash: ARTIFACT_HASH }),
    });
    await decideApprovalRequest(created.id, {
      decidedBy: INDEPENDENT_DECIDER_ID,
      approve: true,
      decisionReason: "ok",
    });
    return await claimApprovalRequest(created.id, {
      entityType: created.entityType,
      action: created.action,
      executorId: created.requestedBy,
      ...(created.artifactHash ? { artifactHash: created.artifactHash } : {}),
    });
  }

  it("1. matching claimed approval satisfies the Stage 4 re-check for an otherwise approval-gated write", async () => {
    const claimed = await claimedMatchingCreate();
    const result = await dispatchAgentAction({
      actor: { kind: "AGENT", agentId: AGENT_ID, onBehalfOfUserId: USER_ID },
      entityType: "RECORD",
      action: "CREATE",
      routeLabel: "test.agent.recheck.match",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      projectId: PROJECT,
      input: { artifactHash: ARTIFACT_HASH },
      claimedApproval: claimed,
    });
    expect(result.decision).toBe("ALLOWED");
    if (result.decision !== "ALLOWED") throw new Error("expected ALLOWED");
    expect(result.evaluation.risk.status).toBe("EVALUATED");
    expect(result.score).toEqual(expect.any(Number));
    expect(result.bucket).toBeDefined();
  });

  it("2. missing claimed approval preserves current APPROVAL_REQUIRED for RECORD.CREATE", async () => {
    const result = await dispatchAgentAction({
      actor: { kind: "AGENT", agentId: AGENT_ID, onBehalfOfUserId: USER_ID },
      entityType: "RECORD",
      action: "CREATE",
      routeLabel: "test.agent.recheck.missing",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      projectId: PROJECT,
    });
    expect(result.decision).toBe("APPROVAL_REQUIRED");
  });

  it("3. entity mismatch on a presented claimed record fails closed", async () => {
    const claimed = await claimedMatchingCreate({ entityType: "DOCUMENT" });
    const result = await dispatchAgentAction({
      actor: { kind: "AGENT", agentId: AGENT_ID, onBehalfOfUserId: USER_ID },
      entityType: "RECORD",
      action: "CREATE",
      routeLabel: "test.agent.recheck.entity-mismatch",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      input: { artifactHash: ARTIFACT_HASH },
      claimedApproval: claimed,
    });
    expect(result.decision).toBe("DENIED");
    if (result.decision !== "DENIED") throw new Error("expected DENIED");
    expect(result.reason).toMatch(/does not match/i);
  });

  it("4. action mismatch on a presented claimed record fails closed", async () => {
    const claimed = await claimedMatchingCreate({ action: "UPDATE" });
    const result = await dispatchAgentAction({
      actor: { kind: "AGENT", agentId: AGENT_ID, onBehalfOfUserId: USER_ID },
      entityType: "RECORD",
      action: "CREATE",
      routeLabel: "test.agent.recheck.action-mismatch",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      input: { artifactHash: ARTIFACT_HASH },
      claimedApproval: claimed,
    });
    expect(result.decision).toBe("DENIED");
  });

  it("5. artifact mismatch on a bound claimed record fails closed", async () => {
    const claimed = await claimedMatchingCreate({ artifactHash: ARTIFACT_HASH });
    const result = await dispatchAgentAction({
      actor: { kind: "AGENT", agentId: AGENT_ID, onBehalfOfUserId: USER_ID },
      entityType: "RECORD",
      action: "CREATE",
      routeLabel: "test.agent.recheck.artifact-mismatch",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      input: { artifactHash: "b".repeat(64) },
      claimedApproval: claimed,
    });
    expect(result.decision).toBe("DENIED");
  });

  it("6. requester/executor mismatch fails closed using claimed requestedBy/claimedBy semantics", async () => {
    const claimed = await claimedMatchingCreate({ requestedBy: USER_ID });
    const result = await dispatchAgentAction({
      actor: { kind: "AGENT", agentId: AGENT_ID, onBehalfOfUserId: USER_ID },
      entityType: "RECORD",
      action: "CREATE",
      routeLabel: "test.agent.recheck.actor-mismatch",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      input: { artifactHash: ARTIFACT_HASH },
      claimedApproval: claimed,
    });
    expect(result.decision).toBe("DENIED");
  });

  it("6b. claimedBy mismatch fails closed", async () => {
    const claimed = await claimedMatchingCreate();
    const result = await dispatchAgentAction({
      actor: { kind: "AGENT", agentId: AGENT_ID, onBehalfOfUserId: USER_ID },
      entityType: "RECORD",
      action: "CREATE",
      routeLabel: "test.agent.recheck.claimed-by-mismatch",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      input: { artifactHash: ARTIFACT_HASH },
      claimedApproval: { ...claimed, claimedBy: "someone-else" },
    });
    expect(result.decision).toBe("DENIED");
  });

  it("7. HUMAN_ONLY stays blocked even with a matching claimed approval", async () => {
    const claimed = await claimedMatchingCreate({ action: "DELETE" });
    const result = await dispatchAgentAction({
      actor: { kind: "AGENT", agentId: AGENT_ID, onBehalfOfUserId: USER_ID },
      entityType: "RECORD",
      action: "DELETE",
      routeLabel: "test.agent.recheck.human-only",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      input: { artifactHash: ARTIFACT_HASH },
      claimedApproval: claimed,
    });
    expect(result.decision).toBe("APPROVAL_REQUIRED");
    if (result.decision !== "APPROVAL_REQUIRED") throw new Error("expected APPROVAL_REQUIRED");
    expect(result.bucket).toBe("HUMAN_ONLY");
    expect(result.evaluation.risk.status).toBe("EVALUATED");
    expect(result.score).toBeGreaterThanOrEqual(80);
  });

  describe("HUMAN_ONLY live-human decision recheck (CP7.2)", () => {
    const DECIDER_ID = "55555555-5555-4555-8555-555555555555";

    async function liveHumanClaimed(overrides: {
      requestedBy?: string;
      action?: string;
    } = {}) {
      const created = await createApprovalRequest({
        entityType: "RECORD",
        action: overrides.action ?? "DELETE",
        requestedBy: overrides.requestedBy ?? AGENT_ID,
        reason: "human-only live decision recheck",
        artifactHash: ARTIFACT_HASH,
      });
      return claimApprovalRequestAsLiveHuman(created.id, {
        entityType: created.entityType,
        action: created.action,
        decidedBy: DECIDER_ID,
        decisionReason: "verified live",
        artifactHash: ARTIFACT_HASH,
        requestId: "req-human-recheck",
      });
    }

    it("a genuine live-human claim satisfies HUMAN_ONLY for a HUMAN actor, and the bucket is still reported as HUMAN_ONLY (no downgrade)", async () => {
      const claimed = await liveHumanClaimed();
      const result = await dispatchAgentAction({
        actor: { kind: "HUMAN", agentId: DECIDER_ID, onBehalfOfUserId: DECIDER_ID },
        entityType: "RECORD",
        action: "DELETE",
        routeLabel: "test.human.recheck.match",
        sourceContext: { origin: "user_message", trustLevel: "trusted" },
        input: { artifactHash: ARTIFACT_HASH },
        claimedApproval: claimed,
      });
      expect(result.decision).toBe("ALLOWED");
      if (result.decision !== "ALLOWED") throw new Error("expected ALLOWED");
      expect(result.bucket).toBe("HUMAN_ONLY");
    });

    it("the same live-human-claimed record does NOT satisfy HUMAN_ONLY for an AGENT/AUTOMATION actor -- the carve-out is keyed on actor.kind, not the claim's shape", async () => {
      const claimed = await liveHumanClaimed();
      const result = await dispatchAgentAction({
        actor: { kind: "AGENT", agentId: DECIDER_ID, onBehalfOfUserId: DECIDER_ID },
        entityType: "RECORD",
        action: "DELETE",
        routeLabel: "test.human.recheck.wrong-actor-kind",
        sourceContext: { origin: "user_message", trustLevel: "trusted" },
        input: { artifactHash: ARTIFACT_HASH },
        claimedApproval: claimed,
      });
      expect(result.decision).toBe("DENIED");
      if (result.decision !== "DENIED") throw new Error("expected DENIED");
      expect(result.reason).toMatch(/does not match this governed action/);
    });

    it("a HUMAN actor presenting a forged claim missing decidedBy is denied (defense in depth, not trusting the DB alone)", async () => {
      const claimed = await liveHumanClaimed();
      const result = await dispatchAgentAction({
        actor: { kind: "HUMAN", agentId: DECIDER_ID, onBehalfOfUserId: DECIDER_ID },
        entityType: "RECORD",
        action: "DELETE",
        routeLabel: "test.human.recheck.forged-no-decided-by",
        sourceContext: { origin: "user_message", trustLevel: "trusted" },
        input: { artifactHash: ARTIFACT_HASH },
        claimedApproval: { ...claimed, decidedBy: null },
      });
      expect(result.decision).toBe("DENIED");
      if (result.decision !== "DENIED") throw new Error("expected DENIED");
      expect(result.reason).toMatch(/does not match this governed action/);
    });

    it("a HUMAN actor presenting a forged claim where decidedBy !== claimedBy is denied", async () => {
      const claimed = await liveHumanClaimed();
      const result = await dispatchAgentAction({
        actor: { kind: "HUMAN", agentId: DECIDER_ID, onBehalfOfUserId: DECIDER_ID },
        entityType: "RECORD",
        action: "DELETE",
        routeLabel: "test.human.recheck.forged-mismatch",
        sourceContext: { origin: "user_message", trustLevel: "trusted" },
        input: { artifactHash: ARTIFACT_HASH },
        claimedApproval: { ...claimed, decidedBy: "someone-else" },
      });
      expect(result.decision).toBe("DENIED");
      if (result.decision !== "DENIED") throw new Error("expected DENIED");
      expect(result.reason).toMatch(/does not match this governed action/);
    });

    it("a HUMAN actor presenting a forged claim where decidedBy === requestedBy (self-approval) is denied even if the DB check were somehow bypassed", async () => {
      const claimed = await liveHumanClaimed();
      const result = await dispatchAgentAction({
        actor: { kind: "HUMAN", agentId: DECIDER_ID, onBehalfOfUserId: DECIDER_ID },
        entityType: "RECORD",
        action: "DELETE",
        routeLabel: "test.human.recheck.forged-self-approval",
        sourceContext: { origin: "user_message", trustLevel: "trusted" },
        input: { artifactHash: ARTIFACT_HASH },
        claimedApproval: { ...claimed, decidedBy: claimed.requestedBy, claimedBy: claimed.requestedBy },
      });
      expect(result.decision).toBe("DENIED");
      if (result.decision !== "DENIED") throw new Error("expected DENIED");
      expect(result.reason).toMatch(/does not match this governed action/);
    });

    it("a HUMAN actor cannot satisfy HUMAN_ONLY via an ordinary approval-token claim (decidedBy is null on that path)", async () => {
      const created = await createApprovalRequest({
        entityType: "RECORD",
        action: "DELETE",
        requestedBy: AGENT_ID,
        reason: "ordinary token claim, not a live-human decision",
        artifactHash: ARTIFACT_HASH,
      });
      await decideApprovalRequest(created.id, {
        decidedBy: USER_ID,
        approve: true,
        decisionReason: "ok",
      });
      const claimed = await claimApprovalRequest(created.id, {
        entityType: created.entityType,
        action: created.action,
        executorId: created.requestedBy,
        artifactHash: ARTIFACT_HASH,
      });
      const result = await dispatchAgentAction({
        actor: { kind: "HUMAN", agentId: created.requestedBy, onBehalfOfUserId: USER_ID },
        entityType: "RECORD",
        action: "DELETE",
        routeLabel: "test.human.recheck.ordinary-token-not-authority",
        sourceContext: { origin: "user_message", trustLevel: "trusted" },
        input: { artifactHash: ARTIFACT_HASH },
        claimedApproval: claimed,
      });
      expect(result.decision).toBe("DENIED");
      if (result.decision !== "DENIED") throw new Error("expected DENIED");
      expect(result.reason).toMatch(/does not match this governed action/);
    });
  });

  it("8. an approved boolean is not authority and is ignored", async () => {
    const forged = {
      actor: { kind: "AGENT" as const, agentId: AGENT_ID, onBehalfOfUserId: USER_ID },
      entityType: "RECORD" as const,
      action: "CREATE" as const,
      routeLabel: "test.agent.recheck.boolean",
      sourceContext: { origin: "user_message" as const, trustLevel: "trusted" as const },
      approved: true,
    } as DispatchAgentActionOptions & { approved: boolean };
    const result = await dispatchAgentAction(forged);
    expect(result.decision).toBe("APPROVAL_REQUIRED");
  });

  describe("kill switch", () => {
    const ORIGINAL_ENV = process.env.ATLAS_KILL_SWITCHES;

    afterEach(() => {
      if (ORIGINAL_ENV === undefined) {
        delete process.env.ATLAS_KILL_SWITCHES;
      } else {
        process.env.ATLAS_KILL_SWITCHES = ORIGINAL_ENV;
      }
    });

    it("denies an otherwise-ALLOWED action when the agentDispatch master switch is active, before policy/risk ever run", async () => {
      process.env.ATLAS_KILL_SWITCHES = "agentDispatch";
      const result = await dispatchAgentAction({
        actor: { kind: "AGENT", agentId: AGENT_ID, onBehalfOfUserId: USER_ID },
        entityType: "RECORD",
        action: "READ",
        routeLabel: "test.kill-switch.master",
        sourceContext: { origin: "user_message", trustLevel: "trusted" },
        projectId: PROJECT,
      });
      expect(result.decision).toBe("DENIED");
      if (result.decision !== "DENIED") throw new Error("expected DENIED");
      expect(result.reason).toMatch(/Kill switch "agentDispatch" is active/);
      expect(result.evaluation.risk.status).toBe("NOT_EVALUATED");

      const [entry] = listUnifiedAuditEntries();
      expect(entry?.decision).toBe("DENY");
      expect(entry?.blockedAt).toBe("KILL_SWITCH");
      expect(entry?.risk).toBe("CRITICAL");
    });

    it("does not deny when only an unrelated category is active", async () => {
      process.env.ATLAS_KILL_SWITCHES = "payments";
      const result = await dispatchAgentAction({
        actor: { kind: "AGENT", agentId: AGENT_ID, onBehalfOfUserId: USER_ID },
        entityType: "RECORD",
        action: "READ",
        routeLabel: "test.kill-switch.unrelated",
        sourceContext: { origin: "user_message", trustLevel: "trusted" },
        projectId: PROJECT,
      });
      expect(result.decision).toBe("ALLOWED");
    });

    it("denies when the caller declares a category (e.g. payments) that is active, even though agentDispatch itself is not", async () => {
      process.env.ATLAS_KILL_SWITCHES = "payments";
      const result = await dispatchAgentAction({
        actor: { kind: "AGENT", agentId: AGENT_ID, onBehalfOfUserId: USER_ID },
        entityType: "RECORD",
        action: "READ",
        routeLabel: "test.kill-switch.declared-category",
        sourceContext: { origin: "user_message", trustLevel: "trusted" },
        projectId: PROJECT,
        killSwitchCategories: ["payments"],
      });
      expect(result.decision).toBe("DENIED");
      if (result.decision !== "DENIED") throw new Error("expected DENIED");
      expect(result.reason).toMatch(/Kill switch "payments" is active/);
    });
  });

  it("9. audit/evidence: the \"approval.requested\" audit entry and the stored approval record both carry the same real, non-null expiresAt", async () => {
    delete process.env.ATLAS_APPROVAL_EXPIRATION_HOURS;
    const before = Date.now();
    const result = await dispatchAgentAction({
      actor: { kind: "AGENT", agentId: AGENT_ID, onBehalfOfUserId: USER_ID },
      entityType: "RECORD",
      action: "DELETE",
      routeLabel: "test.agent.expiration-evidence",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      projectId: PROJECT,
    });
    const after = Date.now();

    expect(result.decision).toBe("APPROVAL_REQUIRED");
    if (result.decision !== "APPROVAL_REQUIRED") throw new Error("expected APPROVAL_REQUIRED");

    // The stored approval record is what a later decide/consume/claim call
    // is actually checked against -- this IS the enforcement evidence.
    const stored = await getApprovalRequest(result.approvalRequestId);
    expect(stored?.expiresAt).not.toBeNull();
    const expiresAtMs = Date.parse(stored?.expiresAt as string);
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + twentyFourHoursMs);
    expect(expiresAtMs).toBeLessThanOrEqual(after + twentyFourHoursMs);

    // The audit trail corroborates it independently: `createApprovalRequest`
    // writes its own "approval.requested" entry carrying the very same
    // (post-default) expiresAt, so an auditor never has to trust the live
    // row alone.
    const requestedEntry = listUnifiedAuditEntries().find(
      (e) => e.type === "approval.requested" && e.input["approvalId"] === result.approvalRequestId,
    );
    expect(requestedEntry).toBeDefined();
    expect(requestedEntry?.input["expiresAt"]).toBe(stored?.expiresAt);
  });

  it("10. audit/evidence: the \"approval.decided\" entry records both the original requester and the deciding approver, and the requester cannot decide their own dispatch-generated approval", async () => {
    const dispatchResult = await dispatchAgentAction({
      actor: { kind: "AGENT", agentId: AGENT_ID, onBehalfOfUserId: USER_ID },
      entityType: "RECORD",
      action: "DELETE",
      routeLabel: "test.agent.dual-control-evidence",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      projectId: PROJECT,
    });
    expect(dispatchResult.decision).toBe("APPROVAL_REQUIRED");
    if (dispatchResult.decision !== "APPROVAL_REQUIRED") {
      throw new Error("expected APPROVAL_REQUIRED");
    }

    const stored = await getApprovalRequest(dispatchResult.approvalRequestId);
    const requester = stored?.requestedBy as string;
    expect(requester).toBeTruthy();

    // The requester cannot decide their own dispatch-generated approval --
    // proves the invariant is wired through the full dispatch -> approval
    // lifecycle, not only through direct createApprovalRequest() calls made
    // straight from a test.
    await expect(
      decideApprovalRequest(dispatchResult.approvalRequestId, {
        decidedBy: requester,
        approve: true,
        decisionReason: "self sign-off attempt through the dispatch path",
      }),
    ).rejects.toThrow(/separation of duties/);
    expect((await getApprovalRequest(dispatchResult.approvalRequestId))?.status).toBe("PENDING");

    const independentApprover = "human-reviewer-dual-control";
    const decided = await decideApprovalRequest(dispatchResult.approvalRequestId, {
      decidedBy: independentApprover,
      approve: true,
      decisionReason: "independent review",
    });
    expect(decided.status).toBe("APPROVED");

    // The audit trail is the evidence an auditor actually relies on: the
    // SAME "approval.decided" entry must name both identities, so
    // separation of duties can be confirmed without cross-referencing a
    // second record.
    const decidedEntry = listUnifiedAuditEntries().find(
      (e) =>
        e.type === "approval.decided" &&
        e.input["approvalId"] === dispatchResult.approvalRequestId,
    );
    expect(decidedEntry).toBeDefined();
    expect(decidedEntry?.actorId).toBe(independentApprover);
    expect(decidedEntry?.input["requestedBy"]).toBe(requester);
    expect(decidedEntry?.input["requestedBy"]).not.toBe(decidedEntry?.actorId);
  });

  /**
   * F-07 (continuous agent verification / behavioral monitoring).
   *
   * `recentOutcomes` is an opt-in field: every test above this point never
   * sets it, so those tests are themselves the regression proof that
   * omitting it is byte-for-byte identical to pre-F-07 behavior (the guard
   * only runs `detectRepeatedViolations` when `recentOutcomes` is present
   * AND non-empty). The tests below exercise the new, additive behavior
   * directly -- mirroring the exact style of the untrusted-source/
   * automation floor tests above, since this is the same kind of floor.
   */
  function violationRecord(agentId: string, projectId: string | null = null) {
    return { agentId, projectId, result: "FAILURE" as const, decision: "DENY" as const };
  }
  function successRecord(agentId: string, projectId: string | null = null) {
    return { agentId, projectId, result: "SUCCESS" as const, decision: "ALLOW" as const };
  }

  it("behavioral floor -- scenario 1 (normal behavior): a clean violation-free history never floors an otherwise-AUTO action", async () => {
    const result = await dispatchAgentAction({
      actor: { kind: "AGENT", agentId: AGENT_ID, onBehalfOfUserId: USER_ID },
      entityType: "RECORD",
      action: "READ",
      routeLabel: "test.behavioral.clean",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      projectId: PROJECT,
      recentOutcomes: Array.from({ length: 10 }, () => successRecord(AGENT_ID, PROJECT)),
    });

    expect(result.decision).toBe("ALLOWED");
    if (result.decision !== "ALLOWED") throw new Error("expected ALLOWED");
    expect(result.evaluation.risk.floors.behavioralPattern).toBe(false);
  });

  it("behavioral floor -- scenario 2 (repeated violation): floors an otherwise-AUTO action to APPROVAL once this agent's own recent history shows a repeated governance-violation pattern", async () => {
    const recentOutcomes = [
      ...Array.from({ length: 5 }, () => successRecord(AGENT_ID, PROJECT)),
      // 3 real governance denials (DENY + FAILURE) for THIS agent -- at the
      // detector's default pattern threshold.
      violationRecord(AGENT_ID, PROJECT),
      violationRecord(AGENT_ID, PROJECT),
      violationRecord(AGENT_ID, PROJECT),
    ];

    const result = await dispatchAgentAction({
      actor: { kind: "AGENT", agentId: AGENT_ID, onBehalfOfUserId: USER_ID },
      entityType: "RECORD",
      action: "READ",
      routeLabel: "test.behavioral.pattern",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      projectId: PROJECT,
      confidence: 1,
      evidenceCount: 10,
      recentOutcomes,
    });

    // Same entity/action/trust/confidence as the plain ALLOWED test at the
    // top of this file, which resolves AUTO/AUTO_LOG -- the ONLY difference
    // here is the supplied violation history, isolating the floor exactly
    // as the untrusted-source/automation floor tests do above.
    expect(result.decision).toBe("APPROVAL_REQUIRED");
    if (result.decision !== "APPROVAL_REQUIRED") throw new Error("expected APPROVAL_REQUIRED");
    expect(result.bucket).toBe("APPROVAL");
    expect(result.evaluation.risk.floors.behavioralPattern).toBe(true);
  });

  it("behavioral floor -- scenario 5 (evidence linkage): the finding that caused the hold is recorded on the SAME durable audit entry, not a separate store", async () => {
    const recentOutcomes = Array.from({ length: 6 }, () => violationRecord(AGENT_ID, PROJECT));

    const result = await dispatchAgentAction({
      actor: { kind: "AGENT", agentId: AGENT_ID, onBehalfOfUserId: USER_ID },
      entityType: "RECORD",
      action: "READ",
      routeLabel: "test.behavioral.evidence-linkage",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      projectId: PROJECT,
      confidence: 1,
      evidenceCount: 10,
      recentOutcomes,
    });

    expect(result.decision).toBe("APPROVAL_REQUIRED");
    const entry = listUnifiedAuditEntries().find(
      (e) => e.type === "test.behavioral.evidence-linkage",
    );
    expect(entry).toBeDefined();
    const behavioralPattern = entry?.output["behavioralPattern"] as
      | { status?: string; violationCount?: number }
      | undefined;
    expect(behavioralPattern?.status).toBe("VIOLATION_PATTERN_DETECTED");
    expect(behavioralPattern?.violationCount).toBe(6);
  });

  it("behavioral floor -- scenario 6 (false-positive resistance): repeated SUCCESSes, however many, never trigger the floor", async () => {
    const result = await dispatchAgentAction({
      actor: { kind: "AGENT", agentId: AGENT_ID, onBehalfOfUserId: USER_ID },
      entityType: "RECORD",
      action: "READ",
      routeLabel: "test.behavioral.repeated-success",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      projectId: PROJECT,
      recentOutcomes: Array.from({ length: 50 }, () => successRecord(AGENT_ID, PROJECT)),
    });

    expect(result.decision).toBe("ALLOWED");
    if (result.decision !== "ALLOWED") throw new Error("expected ALLOWED");
    expect(result.evaluation.risk.floors.behavioralPattern).toBe(false);
  });

  it("behavioral floor -- scenario 8 (cross-agent isolation): another agent's repeated violations never floor THIS agent's dispatch", async () => {
    const OTHER_AGENT = "agent-fabric-other";
    const result = await dispatchAgentAction({
      actor: { kind: "AGENT", agentId: AGENT_ID, onBehalfOfUserId: USER_ID },
      entityType: "RECORD",
      action: "READ",
      routeLabel: "test.behavioral.cross-agent",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      projectId: PROJECT,
      recentOutcomes: Array.from({ length: 10 }, () => violationRecord(OTHER_AGENT, PROJECT)),
    });

    expect(result.decision).toBe("ALLOWED");
    if (result.decision !== "ALLOWED") throw new Error("expected ALLOWED");
    expect(result.evaluation.risk.floors.behavioralPattern).toBe(false);
  });

  it("behavioral floor -- scenario 9 (cross-project isolation): the same agent's repeated violations in a DIFFERENT project never floor this project's dispatch", async () => {
    const OTHER_PROJECT = "44444444-4444-4444-8444-444444444444";
    const result = await dispatchAgentAction({
      actor: { kind: "AGENT", agentId: AGENT_ID, onBehalfOfUserId: USER_ID },
      entityType: "RECORD",
      action: "READ",
      routeLabel: "test.behavioral.cross-project",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      projectId: PROJECT,
      recentOutcomes: Array.from({ length: 10 }, () => violationRecord(AGENT_ID, OTHER_PROJECT)),
    });

    expect(result.decision).toBe("ALLOWED");
    if (result.decision !== "ALLOWED") throw new Error("expected ALLOWED");
    expect(result.evaluation.risk.floors.behavioralPattern).toBe(false);
  });

  it("behavioral floor -- scenario 7 (fail-safe / backward compatibility): an explicitly empty recentOutcomes array behaves identically to omitting it entirely", async () => {
    const withEmpty = await dispatchAgentAction({
      actor: { kind: "AGENT", agentId: AGENT_ID, onBehalfOfUserId: USER_ID },
      entityType: "RECORD",
      action: "READ",
      routeLabel: "test.behavioral.empty-recent-outcomes",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      projectId: PROJECT,
      recentOutcomes: [],
    });

    expect(withEmpty.decision).toBe("ALLOWED");
    if (withEmpty.decision !== "ALLOWED") throw new Error("expected ALLOWED");
    expect(withEmpty.evaluation.risk.floors.behavioralPattern).toBe(false);

    // Never grants MORE authority either: a real, unrelated denial elsewhere
    // in the same options object cannot be papered over by this floor --
    // the untrusted-source floor above still fires independently regardless
    // of what recentOutcomes says.
    const untrustedStillFloors = await dispatchAgentAction({
      actor: { kind: "AGENT", agentId: AGENT_ID, onBehalfOfUserId: USER_ID },
      entityType: "RECORD",
      action: "READ",
      routeLabel: "test.behavioral.untrusted-still-floors",
      sourceContext: { origin: "external_ingested", trustLevel: "untrusted" },
      projectId: PROJECT,
      confidence: 1,
      evidenceCount: 10,
      recentOutcomes: Array.from({ length: 10 }, () => successRecord(AGENT_ID, PROJECT)),
    });
    expect(untrustedStillFloors.decision).toBe("APPROVAL_REQUIRED");
  });

  it("behavioral floor -- scenario 10 (tamper resistance via F-06): forging the recorded behavioralPattern finding breaks the real hash chain", async () => {
    const recentOutcomes = Array.from({ length: 6 }, () => violationRecord(AGENT_ID, PROJECT));

    const result = await dispatchAgentAction({
      actor: { kind: "AGENT", agentId: AGENT_ID, onBehalfOfUserId: USER_ID },
      entityType: "RECORD",
      action: "READ",
      routeLabel: "test.behavioral.tamper-resistance",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      projectId: PROJECT,
      confidence: 1,
      evidenceCount: 10,
      recentOutcomes,
    });
    expect(result.decision).toBe("APPROVAL_REQUIRED");

    // The behavioral finding is not a parallel, unlinked record -- it was
    // written into the SAME NDJSON file that appendAuditLogLine hash-chains
    // for every other F-01..F-06 audit entry (appendUnifiedAuditEntry is a
    // thin wrapper over appendAuditLogLine -- see audit-log.ts). So the same
    // F-06 tamper-evidence that protects e.g. a recorded execution result
    // protects this finding too, with no bespoke wiring required.
    expect(verifyAuditLogChain().ok).toBe(true);

    const logFile = join(dir, "audit.ndjson");
    const lines = readFileSync(logFile, "utf8").split("\n").filter((l) => l.trim());
    const lastIndex = lines.length - 1;
    const lastLine = lines[lastIndex];
    if (!lastLine) throw new Error("expected at least one real audit line");
    const parsed = JSON.parse(lastLine) as {
      payload: { output: { behavioralPattern?: { violationCount?: number } } };
    };
    expect(parsed.payload.output.behavioralPattern).toBeDefined();
    // Forge the recorded finding itself -- e.g. an attempt to quietly shrink
    // the violation count after the fact -- without touching the stored hash.
    parsed.payload.output.behavioralPattern = {
      ...parsed.payload.output.behavioralPattern,
      violationCount: 0,
    };
    lines[lastIndex] = JSON.stringify(parsed);
    writeFileSync(logFile, `${lines.join("\n")}\n`, "utf8");

    const verification = verifyAuditLogChain();
    expect(verification.ok).toBe(false);
    expect(verification.status).toBe("BROKEN");
  });
});

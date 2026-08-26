import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setAuditLogPathForTests, listUnifiedAuditEntries } from "./audit-log.js";
import { resetApprovalsForTests, getApprovalRequest, listApprovalRequests } from "./approvals.js";

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

  it("a real ALLOWED decision (real Policy Engine, no mocking) proceeds and logs a SUCCESS audit entry with the real agentId as actorId", () => {
    const result = dispatchAgentAction({
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

  it("a genuinely DENIED decision (real, unmocked authorizeEntityAction — unknown entity/action fail-safe) returns DENIED without throwing and logs a REJECTED/FAILURE entry", () => {
    // `DEFAULT_ENTITY_POLICIES` covers every valid BusinessEntityType x
    // EntityAction pair, so the only way `authorizeEntityAction` genuinely
    // returns DENIED for the fixed mode:"WRITE"/writeGateOpen:true call
    // shape this module always uses is its fail-safe "Unknown entity
    // action" branch (`getEntityPolicy` returning undefined) — see
    // `authorizeEntityAction` in entity-policies.ts. We reach that branch
    // deliberately (not via mocking) with an entity type that isn't in the
    // table, simulating a caller passing an unrecognized/misspelled value.
    const result = dispatchAgentAction({
      actor: { kind: "AGENT", agentId: AGENT_ID, onBehalfOfUserId: USER_ID },
      entityType: "NOT_A_REAL_ENTITY_TYPE" as never,
      action: "READ",
      routeLabel: "test.agent.unknown-entity",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
    });

    expect(result).toEqual({
      decision: "DENIED",
      reason: "Unknown entity action: NOT_A_REAL_ENTITY_TYPE.READ",
    });

    const [entry] = listUnifiedAuditEntries();
    expect(entry?.actorId).toBe(AGENT_ID);
    expect(entry?.actorKind).toBe("AGENT");
    expect(entry?.result).toBe("FAILURE");
    expect(entry?.approval).toBe("REJECTED");
    expect(entry?.risk).toBe("CRITICAL");
    expect(entry?.ownerId).toBe(USER_ID);
  });

  it("untrusted-source floor: never resolves to AUTO/AUTO_LOG across multiple normally-AUTO-eligible entity/action pairs, even with maximally favorable confidence/evidence", () => {
    for (const { entityType, action } of NORMALLY_AUTO_ELIGIBLE_PAIRS) {
      resetApprovalsForTests();
      const result = dispatchAgentAction({
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

  it("automation floor: AUTOMATION + CREATE never resolves ALLOWED with bucket AUTO/AUTO_LOG, even trusted with high confidence/evidence — always ends up APPROVAL_REQUIRED", () => {
    const result = dispatchAgentAction({
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

  it("automation floor does not apply to READ: AUTOMATION + READ can still reach ALLOWED/AUTO when the raw score justifies it", () => {
    const result = dispatchAgentAction({
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

  it("APPROVAL_REQUIRED creates a real, retrievable approval request via approvals.ts", () => {
    const result = dispatchAgentAction({
      actor: { kind: "AGENT", agentId: AGENT_ID, onBehalfOfUserId: USER_ID },
      entityType: "RECORD",
      action: "DELETE",
      routeLabel: "test.agent.record.delete",
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      projectId: PROJECT,
    });

    expect(result.decision).toBe("APPROVAL_REQUIRED");
    if (result.decision !== "APPROVAL_REQUIRED") throw new Error("expected APPROVAL_REQUIRED");

    const stored = getApprovalRequest(result.approvalRequestId);
    expect(stored).toBeDefined();
    expect(stored?.status).toBe("PENDING");
    expect(stored?.entityType).toBe("RECORD");
    expect(stored?.action).toBe("DELETE");
    expect(stored?.requestedBy).toBe(USER_ID);

    const pending = listApprovalRequests("PENDING");
    expect(pending.some((r) => r.id === result.approvalRequestId)).toBe(true);

    // `createApprovalRequest` writes its own "approval.requested" audit
    // entry first; ours (keyed by `routeLabel`) is appended after it.
    const entry = listUnifiedAuditEntries().find((e) => e.type === "test.agent.record.delete");
    expect(entry?.approval).toBe("PENDING");
    expect(entry?.result).toBe("PARTIAL");
    expect(entry?.actorId).toBe(AGENT_ID);
    expect(entry?.ownerId).toBe(USER_ID);
  });

  it("AUTOMATION with no human in the loop (onBehalfOfUserId null) uses the agentId as the approval request's requestedBy, never a fabricated user id", () => {
    const result = dispatchAgentAction({
      actor: { kind: "AUTOMATION", agentId: AGENT_ID, onBehalfOfUserId: null },
      entityType: "RECORD",
      action: "DELETE",
      routeLabel: "test.automation.record.delete",
      sourceContext: { origin: "system", trustLevel: "trusted" },
    });

    expect(result.decision).toBe("APPROVAL_REQUIRED");
    if (result.decision !== "APPROVAL_REQUIRED") throw new Error("expected APPROVAL_REQUIRED");

    const stored = getApprovalRequest(result.approvalRequestId);
    expect(stored?.requestedBy).toBe(AGENT_ID);

    const entry = listUnifiedAuditEntries().find((e) => e.type === "test.automation.record.delete");
    expect(entry?.ownerId ?? null).toBeNull();
  });

  it("denies a quarantined agent at dispatch time, not only at run start", () => {
    const result = dispatchAgentAction({
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

  it("floors agent-to-agent delegation to approval", () => {
    const result = dispatchAgentAction({
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
});

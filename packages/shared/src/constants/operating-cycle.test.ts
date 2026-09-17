import { describe, expect, it } from "vitest";
import {
  agentMayExecute,
  combineAgentRuntimeStatus,
  effectiveDelegationHopCount,
  evaluateOperatingCycle,
} from "./operating-cycle.js";

describe("evaluateOperatingCycle", () => {
  it("denies execution when the agent is quarantined", () => {
    const result = evaluateOperatingCycle({
      actorId: "owner",
      actorKind: "USER",
      applicationId: "def-000",
      operation: "request_agent_run",
      agentId: "CODE_ENGINEER",
      agentStatus: "QUARANTINED",
    });
    expect(result.decision).toBe("DENY");
    expect(result.blockedAt).toBe("AUTHORIZATION");
  });

  it("does not let delegation hops inherit unlimited authority", () => {
    const result = evaluateOperatingCycle({
      actorId: "agent-a",
      actorKind: "AGENT",
      applicationId: "app-1",
      operation: "request_agent_run",
      agentId: "CODE_ENGINEER",
      delegationHopCount: 2,
    });
    expect(result.decision).toBe("REQUIRE_APPROVAL");
    expect(result.reason).toMatch(/delegation/i);
  });

  it("allows read-only inspect without treating it as a repair", () => {
    const result = evaluateOperatingCycle({
      actorId: "owner",
      actorKind: "USER",
      applicationId: "def-000",
      operation: "inspect",
      readOnly: true,
      evidenceCount: 1,
    });
    expect(result.decision).toBe("ALLOW");
    expect(result.executed).toBe(false);
    expect(result.verificationRequired).toBe(false);
  });

  it("refuses approved mutation without a verification plan", () => {
    const result = evaluateOperatingCycle({
      actorId: "owner",
      actorKind: "USER",
      applicationId: "def-000",
      operation: "request_remediation",
      approved: true,
      verificationPlanPresent: false,
    });
    expect(result.decision).toBe("DENY");
    expect(result.blockedAt).toBe("VERIFY");
  });

  it("denies silent self-mutation", () => {
    expect(
      evaluateOperatingCycle({
        actorId: "atlas",
        actorKind: "SYSTEM",
        applicationId: "def-000",
        operation: "weaken_auth",
        forbiddenSelfMutation: true,
      }).decision,
    ).toBe("DENY");
  });

  it("halts a write when evidence conflicts — not a second path, same cycle", () => {
    const result = evaluateOperatingCycle({
      actorId: "owner",
      actorKind: "USER",
      applicationId: "def-000",
      operation: "request_remediation",
      approved: true,
      verificationPlanPresent: true,
      evidenceCount: 2,
      evidenceConflicting: true,
    });
    expect(result.decision).toBe("DENY");
    expect(result.blockedAt).toBe("EVIDENCE");
  });

  it("halts a write when conflicting claim ids are bound — count is not enough", () => {
    const result = evaluateOperatingCycle({
      actorId: "owner",
      actorKind: "USER",
      applicationId: "def-000",
      operation: "request_remediation",
      approved: true,
      verificationPlanPresent: true,
      conflictingClaimIds: ["claim-a"],
    });
    expect(result.decision).toBe("DENY");
    expect(result.blockedAt).toBe("EVIDENCE");
  });

  it("requires approval at RISK for an unapproved HIGH_RISK_WRITE", () => {
    const result = evaluateOperatingCycle({
      actorId: "owner",
      actorKind: "USER",
      applicationId: "def-000",
      operation: "request_agent_run",
      toolRisk: "HIGH_RISK_WRITE",
    });
    expect(result.decision).toBe("REQUIRE_APPROVAL");
    expect(result.blockedAt).toBe("RISK");
    expect(result.risk?.band).toBe("HIGH");
    expect(result.risk?.score).toBeGreaterThanOrEqual(70);
    expect(result.stagesPassed).toContain("POLICY");
    expect(result.stagesPassed).toContain("RISK");
  });

  it("requires approval at RISK for unapproved DESTRUCTIVE work", () => {
    const result = evaluateOperatingCycle({
      actorId: "owner",
      actorKind: "USER",
      applicationId: "def-000",
      operation: "request_remediation",
      toolRisk: "DESTRUCTIVE",
    });
    expect(result.decision).toBe("REQUIRE_APPROVAL");
    expect(result.blockedAt).toBe("RISK");
    expect(result.risk?.toolRisk).toBe("DESTRUCTIVE");
    expect(result.risk?.score).toBeGreaterThanOrEqual(90);
  });

  it("does not invent a HIGH-risk gate when toolRisk is omitted", () => {
    const result = evaluateOperatingCycle({
      actorId: "owner",
      actorKind: "USER",
      applicationId: "def-000",
      operation: "request_agent_run",
    });
    expect(result.decision).toBe("REQUIRE_APPROVAL");
    expect(result.blockedAt).toBe("APPROVAL");
    expect(result.risk?.toolRisk).toBe("UNSPECIFIED");
    expect(result.risk?.bucket).toBe("CONTINUE");
  });

  it("lets an approved HIGH_RISK_WRITE continue past RISK to VERIFY", () => {
    const result = evaluateOperatingCycle({
      actorId: "owner",
      actorKind: "USER",
      applicationId: "def-000",
      operation: "request_agent_run",
      toolRisk: "HIGH_RISK_WRITE",
      approved: true,
      verificationPlanPresent: false,
    });
    expect(result.blockedAt).toBe("VERIFY");
    expect(result.risk?.bucket).toBe("CONTINUE");
  });

  it("keeps read-only inspect at LOW risk and ALLOW", () => {
    const result = evaluateOperatingCycle({
      actorId: "owner",
      actorKind: "USER",
      applicationId: "def-000",
      operation: "inspect",
      readOnly: true,
      evidenceCount: 1,
      toolRisk: "READ_ONLY",
    });
    expect(result.decision).toBe("ALLOW");
    expect(result.risk?.band).toBe("LOW");
    expect(result.stagesPassed).toContain("RISK");
  });

  it("only ACTIVE and DEGRADED agents may execute", () => {
    expect(agentMayExecute("ACTIVE")).toBe(true);
    expect(agentMayExecute("DEGRADED")).toBe(true);
    expect(agentMayExecute("PAUSED")).toBe(false);
    expect(agentMayExecute("REVOKED")).toBe(false);
    expect(agentMayExecute("DISABLED")).toBe(false);
    expect(agentMayExecute("SUSPENDED")).toBe(false);
    expect(agentMayExecute("QUARANTINED")).toBe(false);
    // F-08 (lifecycle governance): a retired agent -- the lifecycle model's
    // final state beyond REVOKED -- must never be executable either.
    expect(agentMayExecute("RETIRED")).toBe(false);
    expect(agentMayExecute("UNKNOWN")).toBe(false);
  });
});

describe("combineAgentRuntimeStatus", () => {
  it("fail-closes to UNKNOWN when no status is supplied", () => {
    expect(combineAgentRuntimeStatus()).toBe("UNKNOWN");
    expect(combineAgentRuntimeStatus(undefined, undefined)).toBe("UNKNOWN");
  });

  it("lets a non-executable overlay win over a local ACTIVE default", () => {
    expect(combineAgentRuntimeStatus("ACTIVE", "QUARANTINED")).toBe("QUARANTINED");
    expect(combineAgentRuntimeStatus("SUSPENDED", "ACTIVE")).toBe("SUSPENDED");
  });
});

describe("effectiveDelegationHopCount", () => {
  it("treats omitted hops on a delegated path as one hop, not zero", () => {
    expect(effectiveDelegationHopCount({ trustLevel: "DELEGATED" })).toBe(1);
    expect(effectiveDelegationHopCount({ trustLevel: "FULL" })).toBe(0);
    expect(effectiveDelegationHopCount({ delegationHopCount: 2, trustLevel: "DELEGATED" })).toBe(
      2,
    );
  });
});

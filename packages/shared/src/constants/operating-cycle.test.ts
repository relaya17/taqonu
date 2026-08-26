import { describe, expect, it } from "vitest";
import { agentMayExecute, evaluateOperatingCycle } from "./operating-cycle.js";

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

  it("only ACTIVE and DEGRADED agents may execute", () => {
    expect(agentMayExecute("ACTIVE")).toBe(true);
    expect(agentMayExecute("DEGRADED")).toBe(true);
    expect(agentMayExecute("PAUSED")).toBe(false);
    expect(agentMayExecute("REVOKED")).toBe(false);
    expect(agentMayExecute("DISABLED")).toBe(false);
    expect(agentMayExecute("SUSPENDED")).toBe(false);
    expect(agentMayExecute("QUARANTINED")).toBe(false);
  });
});

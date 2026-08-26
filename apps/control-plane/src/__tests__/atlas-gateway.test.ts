import { describe, expect, it, beforeEach } from "vitest";
import {
  dispatchGatewayOperation,
  evaluateGatewayRequest,
  ingestGatewayEvent,
} from "../services/atlas-gateway.js";
import {
  getRegisteredApplication,
  resetApplicationRegistryForTests,
} from "../services/application-registry.js";
import {
  listApprovalRecords,
  resetGovernanceStateForTests,
} from "../services/governance-state.js";
import {
  resetAgentRuntimeForTests,
  setAgentRuntimeStatus,
} from "../services/agent-registry.js";

describe("Atlas Gateway", () => {
  beforeEach(() => {
    resetGovernanceStateForTests();
    resetApplicationRegistryForTests();
    resetAgentRuntimeForTests();
  });

  it("denies silent self-mutations", () => {
    const result = evaluateGatewayRequest({
      actorId: "owner",
      applicationId: "def-000",
      operation: "weaken_auth",
      reason: "incident response",
    });
    expect(result.decision).toBe("DENY");
    expect(result.executed).toBe(false);
  });

  it("allows inspect without turning Atlas into a filesystem console", () => {
    const result = evaluateGatewayRequest({
      actorId: "owner",
      applicationId: "def-000",
      operation: "inspect",
      reason: "owner review",
    });
    expect(result.decision).toBe("ALLOW");
  });

  it("requires approval for agent execution", () => {
    const result = dispatchGatewayOperation({
      actorId: "owner",
      applicationId: "def-000",
      operation: "request_agent_run",
      agentId: "CODE_ENGINEER",
      reason: "run diagnostic agent",
    });
    expect(result.decision).toBe("REQUIRE_APPROVAL");
  });

  it("ingests application events into the generic registry", () => {
    const accepted = ingestGatewayEvent({
      type: "application.registered",
      applicationId: "hotel-os",
      payload: { name: "HotelOS" },
    });
    expect(accepted.accepted).toBe(true);
    ingestGatewayEvent({
      type: "finding.created",
      applicationId: "hotel-os",
    });
    const app = getRegisteredApplication("hotel-os");
    expect(app?.name).toBe("HotelOS");
    expect(app?.findingCount).toBe(1);
    expect(app?.health).toBe("degraded");
  });

  it("rejects unknown event types", () => {
    expect(
      ingestGatewayEvent({
        type: "not.a.real.event",
        applicationId: "hotel-os",
      }).accepted,
    ).toBe(false);
  });

  it("refuses a quarantined agent at evaluation time", () => {
    setAgentRuntimeStatus("CODE_ENGINEER", "QUARANTINED");
    const result = evaluateGatewayRequest({
      actorId: "owner",
      applicationId: "def-000",
      operation: "request_agent_run",
      agentId: "CODE_ENGINEER",
      reason: "run after quarantine",
    });
    expect(result.decision).toBe("DENY");
    expect(result.reason).toMatch(/QUARANTINED/);
  });

  it("does not treat approval without a verification plan as a completed repair", () => {
    const result = evaluateGatewayRequest({
      actorId: "owner",
      applicationId: "def-000",
      operation: "request_remediation",
      agentId: "CODE_ENGINEER",
      reason: "apply fix",
      approved: true,
    });
    expect(result.decision).toBe("DENY");
    expect(result.blockedAt).toBe("VERIFY");
  });

  it("observes registered application state on inspect without running tools", () => {
    const result = dispatchGatewayOperation({
      actorId: "owner",
      applicationId: "def-000",
      operation: "inspect",
      reason: "owner review",
    });
    expect(result.decision).toBe("ALLOW");
    expect(result.receipt?.executionKind).toBe("OBSERVATION");
    expect(result.receipt?.verification.verdict).toBe("VERIFIED");
    expect(result.receipt?.governedHandoff).toBeNull();
  });

  it("does not enqueue a second Control Plane approval queue", () => {
    const result = dispatchGatewayOperation({
      actorId: "owner",
      applicationId: "def-000",
      operation: "request_agent_run",
      agentId: "CODE_ENGINEER",
      reason: "run diagnostic agent",
    });
    expect(result.decision).toBe("REQUIRE_APPROVAL");
    expect(listApprovalRecords()).toHaveLength(0);
  });

  it("hands ALLOW writes to executeGovernedAction using a fabric catalog tool", () => {
    const result = dispatchGatewayOperation({
      actorId: "owner",
      applicationId: "def-000",
      operation: "request_agent_run",
      agentId: "CODE_ENGINEER",
      reason: "approved diagnostic",
      approved: true,
      verificationPlanPresent: true,
    });
    expect(result.decision).toBe("ALLOW");
    expect(result.executed).toBe(false);
    expect(result.receipt?.executionKind).toBe("HANDED_OFF_GOVERNED");
    expect(result.receipt?.governedHandoff?.toolName).toBe("analyze_repo");
    expect(result.receipt?.governedHandoff?.toolName).not.toBe("fs.read_file");
    expect(result.receipt?.verification.verdict).toBe("INCONCLUSIVE");
  });

  it("denies an unknown application at IDENTITY", () => {
    const result = evaluateGatewayRequest({
      actorId: "owner",
      applicationId: "not-registered",
      operation: "inspect",
      reason: "probe",
    });
    expect(result.decision).toBe("DENY");
    expect(result.blockedAt).toBe("IDENTITY");
  });

  it("denies a missing principal — no implicit atlas-owner", () => {
    const result = evaluateGatewayRequest({
      actorId: "",
      applicationId: "def-000",
      operation: "inspect",
      reason: "anonymous inspect",
    });
    expect(result.decision).toBe("DENY");
    expect(result.blockedAt).toBe("IDENTITY");
  });
});

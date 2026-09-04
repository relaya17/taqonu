import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("requires approval for agent execution", async () => {
    const result = await dispatchGatewayOperation({
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

  it("does not treat body approved:true as independent Atlas-self approval", () => {
    const result = evaluateGatewayRequest({
      actorId: "owner",
      applicationId: "def-000",
      operation: "request_remediation",
      agentId: "CODE_ENGINEER",
      reason: "apply fix",
      approved: true,
      verificationPlanPresent: true,
    });
    expect(result.decision).toBe("REQUIRE_APPROVAL");
    expect(result.executed).toBe(false);
    expect(result.blockedAt).toBe("APPROVAL");
  });

  it("does not treat independent Atlas-self approval without a verification plan as a completed repair", () => {
    const result = evaluateGatewayRequest({
      actorId: "owner",
      applicationId: "def-000",
      operation: "request_remediation",
      agentId: "CODE_ENGINEER",
      reason: "apply fix",
      independentApprovalVerified: true,
    });
    expect(result.decision).toBe("DENY");
    expect(result.blockedAt).toBe("VERIFY");
    expect(result.executed).toBe(false);
  });

  it("observes registered application state on inspect without running tools", async () => {
    const result = await dispatchGatewayOperation({
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

  it("does not enqueue a second Control Plane approval queue", async () => {
    const result = await dispatchGatewayOperation({
      actorId: "owner",
      applicationId: "def-000",
      operation: "request_agent_run",
      agentId: "CODE_ENGINEER",
      reason: "run diagnostic agent",
    });
    expect(result.decision).toBe("REQUIRE_APPROVAL");
    expect(listApprovalRecords()).toHaveLength(0);
  });

  it("hands ALLOW writes to executeGovernedAction using a fabric catalog tool", async () => {
    const result = await dispatchGatewayOperation({
      actorId: "owner",
      applicationId: "def-000",
      operation: "request_agent_run",
      agentId: "CODE_ENGINEER",
      reason: "approved diagnostic",
      independentApprovalVerified: true,
      verificationPlanPresent: true,
    });
    expect(result.decision).toBe("ALLOW");
    expect(result.executed).toBe(false);
    expect(result.receipt?.executionKind).toBe("HANDED_OFF_GOVERNED");
    expect(result.receipt?.governedHandoff?.toolName).toBe("analyze_repo");
    expect(result.receipt?.governedHandoff?.toolName).not.toBe("fs.read_file");
    expect(result.receipt?.verification.verdict).toBe("FAILED");
    expect(result.receipt?.verification.detail).toMatch(/failed closed/i);
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

  it("halts conflicting-evidence writes on the same Gateway cycle", async () => {
    const result = await dispatchGatewayOperation({
      actorId: "owner",
      applicationId: "def-000",
      operation: "request_agent_run",
      agentId: "CODE_ENGINEER",
      reason: "apply fix",
      independentApprovalVerified: true,
      verificationPlanPresent: true,
      evidenceCount: 2,
      evidenceConflicting: true,
    });
    expect(result.decision).toBe("DENY");
    expect(result.blockedAt).toBe("EVIDENCE");
    expect(result.executed).toBe(false);
  });

  it("halts writes when conflicting claim ids are bound on the same Gateway cycle", async () => {
    const result = await dispatchGatewayOperation({
      actorId: "owner",
      applicationId: "def-000",
      operation: "request_agent_run",
      agentId: "CODE_ENGINEER",
      reason: "apply fix",
      independentApprovalVerified: true,
      verificationPlanPresent: true,
      conflictingClaimIds: ["claim-a"],
    });
    expect(result.decision).toBe("DENY");
    expect(result.blockedAt).toBe("EVIDENCE");
    expect(result.executed).toBe(false);
  });
});

describe("Atlas Gateway fulfill handoff (CP → API)", () => {
  const allowedWrite = {
    actorId: "owner",
    applicationId: "def-000",
    operation: "request_agent_run" as const,
    agentId: "CODE_ENGINEER",
    reason: "approved diagnostic",
    independentApprovalVerified: true,
    verificationPlanPresent: true,
  };

  beforeEach(() => {
    resetGovernanceStateForTests();
    resetApplicationRegistryForTests();
    resetAgentRuntimeForTests();
    delete process.env["ATLAS_API_URL"];
    delete process.env["ATLAS_CONTROL_PLANE_TOKEN"];
  });

  afterEach(() => {
    delete process.env["ATLAS_API_URL"];
    delete process.env["ATLAS_CONTROL_PLANE_TOKEN"];
    vi.unstubAllGlobals();
  });

  it("ALLOW posts to existing /api/v1/gateway/fulfill and does not execute tools locally", async () => {
    process.env["ATLAS_API_URL"] = "http://127.0.0.1:4000";
    process.env["ATLAS_CONTROL_PLANE_TOKEN"] = "cp-token";
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe("http://127.0.0.1:4000/api/v1/gateway/fulfill");
      expect((init?.headers as Record<string, string>).authorization).toBe(
        "Bearer cp-token",
      );
      const body = JSON.parse(String(init?.body)) as {
        applicationId: string;
        agentId: string;
        operation: string;
        toolName?: string;
        agentRuntimeStatus?: string;
      };
      expect(body.applicationId).toBe("def-000");
      expect(body.agentId).toBe("CODE_ENGINEER");
      expect(body.operation).toBe("request_agent_run");
      expect(body.toolName).toBeUndefined();
      expect(body.agentRuntimeStatus).toBe("ACTIVE");
      expect((init?.headers as Record<string, string>)["x-request-id"]).toBeTruthy();
      return new Response(
        JSON.stringify({
          executed: true,
          verificationVerdict: "INCONCLUSIVE",
          verificationDetail: "API executed via fulfillGatewayHandoff",
          observation: { output: "ok" },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await dispatchGatewayOperation(allowedWrite);
    expect(result.decision).toBe("ALLOW");
    expect(result.executed).toBe(true);
    expect(result.receipt?.executionKind).toBe("HANDED_OFF_GOVERNED");
    expect(result.receipt?.governedHandoff?.toolName).toBe("analyze_repo");
    expect(result.receipt?.verification.detail).toMatch(/fulfillGatewayHandoff/);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("DENY does not call the API fulfill hop", async () => {
    process.env["ATLAS_API_URL"] = "http://127.0.0.1:4000";
    process.env["ATLAS_CONTROL_PLANE_TOKEN"] = "cp-token";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await dispatchGatewayOperation({
      actorId: "owner",
      applicationId: "def-000",
      operation: "request_agent_run",
      agentId: "CODE_ENGINEER",
      reason: "apply fix",
      independentApprovalVerified: true,
      verificationPlanPresent: true,
      evidenceConflicting: true,
      evidenceCount: 2,
    });
    expect(result.decision).toBe("DENY");
    expect(result.executed).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("REQUIRE_APPROVAL does not call the API fulfill hop", async () => {
    process.env["ATLAS_API_URL"] = "http://127.0.0.1:4000";
    process.env["ATLAS_CONTROL_PLANE_TOKEN"] = "cp-token";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await dispatchGatewayOperation({
      actorId: "owner",
      applicationId: "def-000",
      operation: "request_agent_run",
      agentId: "CODE_ENGINEER",
      reason: "run diagnostic agent",
    });
    expect(result.decision).toBe("REQUIRE_APPROVAL");
    expect(result.executed).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("inspect ALLOW does not call the API fulfill hop", async () => {
    process.env["ATLAS_API_URL"] = "http://127.0.0.1:4000";
    process.env["ATLAS_CONTROL_PLANE_TOKEN"] = "cp-token";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await dispatchGatewayOperation({
      actorId: "owner",
      applicationId: "def-000",
      operation: "inspect",
      reason: "owner review",
    });
    expect(result.decision).toBe("ALLOW");
    expect(result.receipt?.executionKind).toBe("OBSERVATION");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("unreachable fulfill fails closed and does not execute locally", async () => {
    process.env["ATLAS_API_URL"] = "http://127.0.0.1:3999";
    process.env["ATLAS_CONTROL_PLANE_TOKEN"] = "cp-token";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect ECONNREFUSED");
      }),
    );
    const result = await dispatchGatewayOperation(allowedWrite);
    expect(result.decision).toBe("ALLOW");
    expect(result.executed).toBe(false);
    expect(result.receipt?.executionKind).toBe("HANDED_OFF_GOVERNED");
    expect(result.receipt?.verification.verdict).toBe("FAILED");
    expect(result.receipt?.verification.detail).toMatch(/failed closed/i);
  });

  it("missing API config fails closed and does not execute locally", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await dispatchGatewayOperation(allowedWrite);
    expect(result.executed).toBe(false);
    expect(result.receipt?.verification.verdict).toBe("FAILED");
    expect(result.receipt?.verification.detail).toMatch(/ATLAS_API_URL|ATLAS_CONTROL_PLANE_TOKEN/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dispatchGatewayOperation,
  evaluateGatewayRequest,
  ingestGatewayEvent,
} from "../services/atlas-gateway.js";
import {
  getRegisteredApplication,
  resetApplicationRegistryForTests,
  decideApplicationTrust,
} from "../services/application-registry.js";
import {
  listApprovalRecords,
  resetGovernanceStateForTests,
} from "../services/governance-state.js";
import {
  resetAgentRuntimeForTests,
  setAgentRuntimeStatus,
} from "../services/agent-registry.js";
import { setAtlasApiFetchForTests } from "../services/lifecycle-handoff.js";

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
    expect(app?.trustStatus).toBe("PENDING");
  });

  it("does not make a self-registered application usable until an operator approves it", () => {
    ingestGatewayEvent({
      type: "application.registered",
      applicationId: "civio",
      payload: { name: "Civio" },
    });
    expect(getRegisteredApplication("civio")?.trustStatus).toBe("PENDING");
    const inspect = evaluateGatewayRequest({
      actorId: "operator",
      applicationId: "civio",
      operation: "inspect",
      reason: "review pending registration",
    });
    expect(inspect.decision).toBe("ALLOW");
    const write = evaluateGatewayRequest({
      actorId: "operator",
      applicationId: "civio",
      operation: "request_agent_run",
      agentId: "CODE_ENGINEER",
      reason: "run before approval",
    });
    expect(write.decision).toBe("DENY");
    expect(write.reason).toMatch(/PENDING/);
    const rejected = decideApplicationTrust({
      applicationId: "civio",
      approve: false,
      decidedBy: "operator",
      reason: "unsigned connector",
    });
    expect(rejected.ok).toBe(true);
    if (rejected.ok) expect(rejected.application.trustStatus).toBe("REJECTED");
    const approved = decideApplicationTrust({
      applicationId: "civio",
      approve: true,
      decidedBy: "operator",
      reason: "connector HMAC reviewed",
    });
    expect(approved.ok).toBe(true);
    expect(getRegisteredApplication("civio")?.trustStatus).toBe("APPROVED");
    expect(
      decideApplicationTrust({
        applicationId: "def-000",
        approve: false,
        decidedBy: "operator",
        reason: "cannot reject atlas self",
      }).ok,
    ).toBe(false);
  });

  it("rejects unknown event types", () => {
    expect(
      ingestGatewayEvent({
        type: "not.a.real.event",
        applicationId: "hotel-os",
      }).accepted,
    ).toBe(false);
  });

  it("accepts mapped HotelOS observational events and preserves Agent identity", () => {
    const accepted = ingestGatewayEvent({
      type: "autonomy.act",
      applicationId: "hotelos",
      agentId: "agent.cio",
      occurredAt: "2026-09-23T00:00:00.000Z",
      riskLevel: "urgent",
      payload: { agentId: "agent.cio", riskLevel: "urgent", occurredAt: "2026-09-23T00:00:00.000Z" },
    });
    expect(accepted.accepted).toBe(true);
    expect(accepted.reason).toBe("recorded");
    const app = getRegisteredApplication("hotelos");
    expect(app?.lastEventType).toBe("tool.executed");

    const invoke = ingestGatewayEvent({
      type: "ai.gateway.invoke",
      applicationId: "hotelos",
      payload: {
        agentId: "agent.cio",
        occurredAt: "2026-09-23T00:01:00.000Z",
        riskLevel: "high",
      },
    });
    expect(invoke.accepted).toBe(true);
    expect(getRegisteredApplication("hotelos")?.lastEventType).toBe("agent.completed");
  });

  it("rejects HotelOS HITL/domain audit actions rather than inventing Control approval state", () => {
    expect(
      ingestGatewayEvent({
        type: "ai.approval.approved",
        applicationId: "hotelos",
        agentId: "agent.cio",
      }).accepted,
    ).toBe(false);
    expect(
      ingestGatewayEvent({
        type: "payment.intent.created",
        applicationId: "hotelos",
      }).accepted,
    ).toBe(false);
    expect(
      ingestGatewayEvent({
        type: "hr.document.approved",
        applicationId: "hotelos",
      }).accepted,
    ).toBe(false);
  });

  it("does not treat telemetry ingest as an execution gate", () => {
    const accepted = ingestGatewayEvent({
      type: "agent.started",
      applicationId: "hotelos",
      agentId: "agent.cio",
    });
    expect(accepted.accepted).toBe(true);
    const denied = ingestGatewayEvent({
      type: "prompt.leaked",
      applicationId: "hotelos",
      payload: { prompt: "should not be stored" },
    });
    expect(denied.accepted).toBe(false);
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
    expect(result.blockedAt).toBe("RISK");
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
    // Step 3 addendum fix: request_agent_run is real execution, RECORD.EXECUTE
    // (matching the same cell ci.run_tests/ci.run_typecheck/ci.run_lint use in
    // DEFAULT_TOOL_POLICIES for "trigger a run") -- it must never fall through
    // to the DOCUMENT.READ/analyze_repo default.
    expect(result.receipt?.governedHandoff?.entityType).toBe("RECORD");
    expect(result.receipt?.governedHandoff?.action).toBe("EXECUTE");
    expect(result.receipt?.governedHandoff?.toolName).toBe("request_agent_run");
    expect(result.receipt?.governedHandoff?.toolName).not.toBe("analyze_repo");
    expect(result.receipt?.governedHandoff?.toolName).not.toBe("fs.read_file");
    expect(result.receipt?.verification.verdict).toBe("FAILED");
    expect(result.receipt?.verification.detail).toMatch(/failed closed/i);
  });

  it("Step 3 addendum: request_test no longer falls through to DOCUMENT.READ -- it is an explicit RECORD.READ classification matching QA_ENGINEER's own \"test.read\" capability", async () => {
    const result = await dispatchGatewayOperation({
      actorId: "owner",
      applicationId: "def-000",
      operation: "request_test",
      agentId: "QA_ENGINEER",
      reason: "approved test run",
      independentApprovalVerified: true,
      verificationPlanPresent: true,
    });
    expect(result.decision).toBe("ALLOW");
    expect(result.receipt?.executionKind).toBe("HANDED_OFF_GOVERNED");
    expect(result.receipt?.governedHandoff?.entityType).toBe("RECORD");
    expect(result.receipt?.governedHandoff?.action).toBe("READ");
    expect(result.receipt?.governedHandoff?.toolName).toBe("request_test");
    expect(result.receipt?.governedHandoff?.toolName).not.toBe("analyze_repo");
  });

  it("Step 3 addendum: request_verify no longer falls through to DOCUMENT.READ -- it is an explicit RECORD.CREATE classification matching QA_ENGINEER's own \"finding.create\" capability", async () => {
    const result = await dispatchGatewayOperation({
      actorId: "owner",
      applicationId: "def-000",
      operation: "request_verify",
      agentId: "QA_ENGINEER",
      reason: "approved verification",
      independentApprovalVerified: true,
      verificationPlanPresent: true,
    });
    expect(result.decision).toBe("ALLOW");
    expect(result.receipt?.executionKind).toBe("HANDED_OFF_GOVERNED");
    expect(result.receipt?.governedHandoff?.entityType).toBe("RECORD");
    expect(result.receipt?.governedHandoff?.action).toBe("CREATE");
    expect(result.receipt?.governedHandoff?.toolName).toBe("request_verify");
    expect(result.receipt?.governedHandoff?.toolName).not.toBe("analyze_repo");
  });

  it("Step 3 addendum: enforcement remains fail-closed -- an unknown operation is still denied before any governedHandoff classification is reached (no new bypass)", () => {
    const result = evaluateGatewayRequest({
      actorId: "owner",
      applicationId: "def-000",
      operation: "not_a_real_operation",
      reason: "probe",
    });
    expect(result.decision).toBe("DENY");
    expect(result.executed).toBe(false);
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
    setAtlasApiFetchForTests(null);
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
    setAtlasApiFetchForTests(fetchMock);

    const result = await dispatchGatewayOperation(allowedWrite);
    expect(result.decision).toBe("ALLOW");
    expect(result.executed).toBe(true);
    expect(result.receipt?.executionKind).toBe("HANDED_OFF_GOVERNED");
    // Same Step 3 addendum fix: allowedWrite's operation is request_agent_run.
    expect(result.receipt?.governedHandoff?.entityType).toBe("RECORD");
    expect(result.receipt?.governedHandoff?.action).toBe("EXECUTE");
    expect(result.receipt?.governedHandoff?.toolName).toBe("request_agent_run");
    expect(result.receipt?.verification.detail).toMatch(/fulfillGatewayHandoff/);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("forwards the Control Plane request id on X-Request-Id and the overlay status", async () => {
    process.env["ATLAS_API_URL"] = "http://127.0.0.1:4000";
    process.env["ATLAS_CONTROL_PLANE_TOKEN"] = "cp-token";
    const requestId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)["x-request-id"]).toBe(requestId);
      const body = JSON.parse(String(init?.body)) as { agentRuntimeStatus?: string };
      expect(body.agentRuntimeStatus).toBe("ACTIVE");
      return new Response(JSON.stringify({ executed: false }), { status: 200 });
    });
    setAtlasApiFetchForTests(fetchMock);
    const result = await dispatchGatewayOperation({ ...allowedWrite, requestId });
    expect(result.receipt?.requestId).toBe(requestId);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("DENY does not call the API fulfill hop", async () => {
    process.env["ATLAS_API_URL"] = "http://127.0.0.1:4000";
    process.env["ATLAS_CONTROL_PLANE_TOKEN"] = "cp-token";
    const fetchMock = vi.fn();
    setAtlasApiFetchForTests(fetchMock);

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
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/internal/approvals/mint")) {
        return new Response(
          JSON.stringify({
            id: "11111111-1111-4111-8111-111111111111",
            status: "PENDING",
          }),
          { status: 201 },
        );
      }
      return new Response("unexpected", { status: 500 });
    });
    setAtlasApiFetchForTests(fetchMock);
    const result = await dispatchGatewayOperation({
      actorId: "owner",
      applicationId: "def-000",
      operation: "request_agent_run",
      agentId: "CODE_ENGINEER",
      reason: "run diagnostic agent",
    });
    expect(result.decision).toBe("REQUIRE_APPROVAL");
    expect(result.executed).toBe(false);
    expect(result.approvalRequestId).toBe("11111111-1111-4111-8111-111111111111");
    expect(listApprovalRecords()).toHaveLength(0);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/gateway/fulfill"))).toBe(
      false,
    );
  });

  it("does not HTTP-fulfill a non-def-000 sibling even on ALLOW write", async () => {
    ingestGatewayEvent({
      type: "application.registered",
      applicationId: "hotel-os",
      payload: { name: "HotelOS" },
    });
    const pending = await dispatchGatewayOperation({
      actorId: "owner",
      applicationId: "hotel-os",
      operation: "request_agent_run",
      agentId: "CODE_ENGINEER",
      reason: "sibling write while pending",
      approved: true,
      independentApprovalVerified: true,
      verificationPlanPresent: true,
    });
    expect(pending.decision).toBe("DENY");
    expect(pending.reason).toMatch(/PENDING/i);
    expect(pending.executed).toBe(false);

    const decided = decideApplicationTrust({
      applicationId: "hotel-os",
      approve: true,
      decidedBy: "operator-1",
      reason: "reviewed sibling registration",
    });
    expect(decided.ok).toBe(true);

    process.env["ATLAS_API_URL"] = "http://127.0.0.1:4000";
    process.env["ATLAS_CONTROL_PLANE_TOKEN"] = "cp-token";
    const fetchMock = vi.fn();
    setAtlasApiFetchForTests(fetchMock);
    const result = await dispatchGatewayOperation({
      actorId: "owner",
      applicationId: "hotel-os",
      operation: "request_agent_run",
      agentId: "CODE_ENGINEER",
      reason: "sibling write",
      approved: true,
      independentApprovalVerified: true,
      verificationPlanPresent: true,
    });
    expect(result.executed).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.receipt?.verification.detail ?? result.reason).toMatch(
      /Atlas-self only|Unknown application/i,
    );
  });

  it("inspect ALLOW does not call the API fulfill hop", async () => {
    process.env["ATLAS_API_URL"] = "http://127.0.0.1:4000";
    process.env["ATLAS_CONTROL_PLANE_TOKEN"] = "cp-token";
    const fetchMock = vi.fn();
    setAtlasApiFetchForTests(fetchMock);
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
    setAtlasApiFetchForTests(
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
    setAtlasApiFetchForTests(fetchMock);
    const result = await dispatchGatewayOperation(allowedWrite);
    expect(result.executed).toBe(false);
    expect(result.receipt?.verification.verdict).toBe("FAILED");
    expect(result.receipt?.verification.detail).toMatch(/ATLAS_API_URL|ATLAS_CONTROL_PLANE_TOKEN/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

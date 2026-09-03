import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ATLAS_SELF_APPLICATION_ID } from "@atlas/shared";
import {
  applyAtlasSelfAgentControl,
  evaluateAtlasSelfAgentControl,
  setAtlasSelfControlApprovalVerifier,
  verifyAtlasSelfControlApprovalViaApi,
  verifyIndependentAtlasSelfControlApproval,
} from "./atlas-self-agent-control.js";
import {
  getRegisteredAgent,
  resetAgentRuntimeForTests,
} from "./agent-registry.js";
import { resetGovernanceStateForTests } from "./governance-state.js";

describe("Atlas-self agent control", () => {
  beforeEach(() => {
    resetAgentRuntimeForTests();
    resetGovernanceStateForTests();
    setAtlasSelfControlApprovalVerifier(null);
  });

  it("requires independent approval and does not execute without it", () => {
    const cycle = evaluateAtlasSelfAgentControl({
      actorId: "cp:service",
      agentId: "CODE_ENGINEER",
      action: "pause",
      reauthenticated: true,
      independentApprovalVerified: false,
    });
    expect(cycle.decision).toBe("REQUIRE_APPROVAL");
    expect(cycle.executed).toBe(false);

    const applied = applyAtlasSelfAgentControl({
      actorId: "cp:service",
      agentId: "CODE_ENGINEER",
      action: "pause",
      reason: "pause without approval",
      reauthenticated: true,
      independentApprovalVerified: false,
    });
    expect(applied.decision).toBe("REQUIRE_APPROVAL");
    expect(applied.executed).toBe(false);
    expect(applied.applicationId).toBe(ATLAS_SELF_APPLICATION_ID);
    expect(getRegisteredAgent("CODE_ENGINEER")?.status).toBe("ACTIVE");
  });

  it("denies unauthenticated privileged control", () => {
    const cycle = evaluateAtlasSelfAgentControl({
      actorId: "cp:service",
      agentId: "CODE_ENGINEER",
      action: "quarantine",
      reauthenticated: false,
      independentApprovalVerified: true,
    });
    expect(cycle.decision).toBe("DENY");
    expect(cycle.executed).toBe(false);
  });

  it("does not treat a self-asserted approved flag as independent approval", () => {
    const applied = applyAtlasSelfAgentControl({
      actorId: "cp:service",
      agentId: "CODE_ENGINEER",
      action: "revoke",
      reason: "self approved",
      reauthenticated: true,
      independentApprovalVerified: false,
    });
    expect(applied.decision).toBe("REQUIRE_APPROVAL");
    expect(applied.executed).toBe(false);
    expect(getRegisteredAgent("CODE_ENGINEER")?.status).not.toBe("REVOKED");
  });

  it("applies the overlay only after independently verified approval", () => {
    const applied = applyAtlasSelfAgentControl({
      actorId: "cp:service",
      agentId: "CODE_ENGINEER",
      action: "pause",
      reason: "independent review",
      reauthenticated: true,
      independentApprovalVerified: true,
      approvalId: "11111111-1111-4111-8111-111111111111",
    });
    expect(applied.decision).toBe("ALLOW");
    expect(applied.executed).toBe(true);
    expect(applied.verified).toBe(false);
    expect(applied.applicationId).toBe("def-000");
    expect(getRegisteredAgent("CODE_ENGINEER")?.status).toBe("PAUSED");
  });
});

describe("Atlas-self control production verifier (CP → API)", () => {
  afterEach(() => {
    delete process.env["ATLAS_API_URL"];
    delete process.env["ATLAS_CONTROL_PLANE_TOKEN"];
    vi.unstubAllGlobals();
    setAtlasSelfControlApprovalVerifier(null);
  });

  function stubVerify(body: unknown, status = 200): void {
    process.env["ATLAS_API_URL"] = "http://127.0.0.1:4000";
    process.env["ATLAS_CONTROL_PLANE_TOKEN"] = "cp-token";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status })),
    );
  }

  it("fail-closes when the API is unavailable", async () => {
    process.env["ATLAS_API_URL"] = "http://127.0.0.1:4000";
    process.env["ATLAS_CONTROL_PLANE_TOKEN"] = "cp-token";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect ECONNREFUSED");
      }),
    );
    await expect(
      verifyAtlasSelfControlApprovalViaApi({
        approvalId: "11111111-1111-4111-8111-111111111111",
        agentId: "CODE_ENGINEER",
        action: "pause",
      }),
    ).resolves.toBe(false);
  });

  it("fail-closes on API authentication failure", async () => {
    stubVerify({ error: { message: "unauthorized" } }, 401);
    await expect(
      verifyAtlasSelfControlApprovalViaApi({
        approvalId: "11111111-1111-4111-8111-111111111111",
        agentId: "CODE_ENGINEER",
        action: "pause",
      }),
    ).resolves.toBe(false);
  });

  it("fail-closes for missing/PENDING/DENIED/EXPIRED/REVOKED and mismatch reasons", async () => {
    for (const reason of [
      "approval missing",
      "PENDING",
      "DENIED",
      "EXPIRED",
      "REVOKED",
      "target mismatch",
      "operation mismatch",
    ]) {
      stubVerify({ verified: false, reason, approvalId: null });
      await expect(
        verifyIndependentAtlasSelfControlApproval({
          approvalId: "11111111-1111-4111-8111-111111111111",
          agentId: "CODE_ENGINEER",
          action: "pause",
        }),
      ).resolves.toBe(false);
    }
  });

  it("accepts only verified: true from the API body", async () => {
    stubVerify({
      verified: true,
      reason: "independent Atlas-self approval verified",
      approvalId: "11111111-1111-4111-8111-111111111111",
    });
    await expect(
      verifyIndependentAtlasSelfControlApproval({
        approvalId: "11111111-1111-4111-8111-111111111111",
        agentId: "CODE_ENGINEER",
        action: "pause",
      }),
    ).resolves.toBe(true);
  });

  it("does not treat a 200 body without verified:true as approval", async () => {
    stubVerify({ ok: true, approved: true });
    await expect(
      verifyAtlasSelfControlApprovalViaApi({
        approvalId: "11111111-1111-4111-8111-111111111111",
        agentId: "CODE_ENGINEER",
        action: "pause",
      }),
    ).resolves.toBe(false);
  });
});

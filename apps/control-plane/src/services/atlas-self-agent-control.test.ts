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
import {
  listAuditEntries,
  resetGovernanceStateForTests,
} from "./governance-state.js";

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

  /**
   * F-08 (lifecycle governance). REVOKED/RETIRED must be terminal: a
   * revoked or retired agent must not regain authority merely by a later
   * status-changing action, even one carrying a freshly, independently
   * verified approval.
   */
  it("test 7 / test 6: revocation invalidates execution, and REVOKED is terminal -- a later, independently-approved resume does not resurrect it", () => {
    const revoked = applyAtlasSelfAgentControl({
      actorId: "cp:service",
      agentId: "RESEARCHER",
      action: "revoke",
      reason: "compromised credentials",
      reauthenticated: true,
      independentApprovalVerified: true,
      approvalId: "22222222-2222-4222-8222-222222222222",
    });
    expect(revoked.decision).toBe("ALLOW");
    expect(revoked.executed).toBe(true);
    expect(getRegisteredAgent("RESEARCHER")?.status).toBe("REVOKED");

    // A second, independently-approved request -- not a replay of the first,
    // a fresh approval -- still cannot move a REVOKED agent anywhere.
    const resurrection = applyAtlasSelfAgentControl({
      actorId: "cp:service",
      agentId: "RESEARCHER",
      action: "resume",
      reason: "attempted resurrection",
      reauthenticated: true,
      independentApprovalVerified: true,
      approvalId: "33333333-3333-4333-8333-333333333333",
    });
    expect(resurrection.decision).toBe("DENY");
    expect(resurrection.executed).toBe(false);
    expect(getRegisteredAgent("RESEARCHER")?.status).toBe("REVOKED");

    // Test 9/10 (evidence): the refusal itself is durably recorded.
    const entries = listAuditEntries({ actorId: "cp:service" });
    const refusal = entries.find((e) =>
      e.reason.includes('Action "resume" was refused'),
    );
    expect(refusal).toBeDefined();
    expect(refusal?.result).toBe("FAILURE");
  });

  it("test 8: retirement prevents further governed execution and is itself terminal", () => {
    const retired = applyAtlasSelfAgentControl({
      actorId: "cp:service",
      agentId: "ARCHITECT",
      action: "retire",
      reason: "end of life",
      reauthenticated: true,
      independentApprovalVerified: true,
      approvalId: "44444444-4444-4444-8444-444444444444",
    });
    expect(retired.decision).toBe("ALLOW");
    expect(retired.executed).toBe(true);
    expect(getRegisteredAgent("ARCHITECT")?.status).toBe("RETIRED");

    const reactivate = applyAtlasSelfAgentControl({
      actorId: "cp:service",
      agentId: "ARCHITECT",
      action: "resume",
      reason: "attempted reactivation of a retired agent",
      reauthenticated: true,
      independentApprovalVerified: true,
      approvalId: "55555555-5555-4555-8555-555555555555",
    });
    expect(reactivate.decision).toBe("DENY");
    expect(getRegisteredAgent("ARCHITECT")?.status).toBe("RETIRED");
  });

  it("test 11: cross-agent isolation -- revoking one agent never changes another agent's status", () => {
    applyAtlasSelfAgentControl({
      actorId: "cp:service",
      agentId: "SECURITY",
      action: "revoke",
      reason: "isolation check",
      reauthenticated: true,
      independentApprovalVerified: true,
      approvalId: "66666666-6666-4666-8666-666666666666",
    });
    expect(getRegisteredAgent("SECURITY")?.status).toBe("REVOKED");
    expect(getRegisteredAgent("CODE_ENGINEER")?.status).toBe("ACTIVE");
    expect(getRegisteredAgent("DEVOPS")?.status).toBe("ACTIVE");
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

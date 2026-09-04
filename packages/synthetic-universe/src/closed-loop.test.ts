import { describe, expect, it } from "vitest";
import { runClosedLoop } from "./closed-loop.js";
import {
  ATLAS_SELF_TEST_UNAUTHORIZED,
  REAL_ESTATE_DEAL_COMPLETION,
  REAL_ESTATE_DEAL_INCOMPLETE_PAYMENT,
  SANDBOX_CONTAINMENT_PAYMENT,
  failureScenario,
} from "./catalog.js";

describe("synthetic closed loop", () => {
  it("skips remediation when the original process is already VERIFIED", () => {
    const result = runClosedLoop({ scenario: REAL_ESTATE_DEAL_COMPLETION });
    expect(result.loopVerdict).toBe("ALREADY_VERIFIED");
    expect(result.diagnosis.detected).toBe(false);
    expect(result.plan).toBeNull();
    expect(result.recoveryRun).toBeNull();
    expect(result.recovery.recovered).toBe(true);
  });

  it("detects a missing payment, plans replay, governs, and recovers", () => {
    const result = runClosedLoop({
      scenario: { ...REAL_ESTATE_DEAL_INCOMPLETE_PAYMENT, tenantId: "TEST-REALTY-LOOP" },
    });
    expect(result.failureRun.verdict).toBe("PROCESS_FAILURE");
    expect(result.diagnosis.detected).toBe(true);
    expect(result.diagnosis.failureClass).toBe("MISSING_PROCESS_TRANSITION");
    expect(result.plan?.recoverable).toBe(true);
    expect(result.plan?.remediatingScenarioId).toBe("real-estate-deal-completion");
    expect(result.plan?.steps.some((step) => step.action === "complete_missing_payment")).toBe(
      true,
    );
    expect(result.governance?.decision).toBe("ALLOW");
    expect(result.governance?.path).toBe("synthetic.authorizeEntityAction");
    expect(result.governance?.entityType).toBe("FINANCIAL_TRANSACTION");
    expect(result.recoveryRun?.verdict).toBe("VERIFIED");
    expect(result.recovery.recovered).toBe(true);
    expect(result.loopVerdict).toBe("RECOVERED");
    expect(result.recoveryRun?.evidence.process.failed).toBe(false);
    expect(result.recoveryRun?.evidence.assertions.every((row) => row.passed)).toBe(true);
  });

  it("recovers injected failures TEST-001 through TEST-010 via the healthy process", () => {
    const ids = [
      "TEST-001",
      "TEST-002",
      "TEST-003",
      "TEST-004",
      "TEST-005",
      "TEST-006",
      "TEST-007",
      "TEST-008",
      "TEST-009",
      "TEST-010",
    ] as const;
    for (const id of ids) {
      const result = runClosedLoop({ scenario: failureScenario(id) });
      expect(result.diagnosis.detected).toBe(true);
      expect(result.diagnosis.injectionId).toBe(id);
      expect(["INJECTED_FAILURE_DETECTED", "DENIED", "CONTAINED"]).toContain(
        result.failureRun.verdict,
      );
      expect(result.loopVerdict).toBe("RECOVERED");
      expect(result.recoveryRun?.verdict).toBe("VERIFIED");
    }
  });

  it("recovers unauthorized self-test by switching to SYNTHETIC_OPERATOR", () => {
    const result = runClosedLoop({
      scenario: { ...ATLAS_SELF_TEST_UNAUTHORIZED, tenantId: "TEST-CRM-LOOP" },
    });
    expect(result.failureRun.verdict).toBe("DENIED");
    expect(result.diagnosis.failureClass).toBe("UNAUTHORIZED_ACTOR");
    expect(result.plan?.steps.some((s) => s.action === "switch_actor_synthetic_operator")).toBe(
      true,
    );
    expect(result.loopVerdict).toBe("RECOVERED");
    expect(result.recoveryRun?.evidence.scenarioId).toBe("crm-lead-to-deal");
  });

  it("blocks remediation when the remediating actor is unauthorized", () => {
    const result = runClosedLoop({
      scenario: REAL_ESTATE_DEAL_INCOMPLETE_PAYMENT,
      remediatingActorId: "UNAUTHORIZED_AGENT",
    });
    expect(result.governance?.decision).toBe("DENY");
    expect(result.recoveryRun).toBeNull();
    expect(result.loopVerdict).toBe("BLOCKED");
    expect(result.recovery.recovered).toBe(false);
  });

  it("keeps containment and never executes a real external during recovery", () => {
    const result = runClosedLoop({ scenario: SANDBOX_CONTAINMENT_PAYMENT });
    expect(result.diagnosis.failureClass).toBe("EXTERNAL_WRITE_CONTAINED");
    expect(result.failureRun.evidence.events.some((e) => e.name === "ExternalWriteDenied")).toBe(
      true,
    );
    expect(result.loopVerdict).toBe("RECOVERED");
    expect(result.recoveryRun?.verdict).toBe("VERIFIED");
    expect(
      result.recoveryRun?.evidence.simulations.every((row) => /simulated/i.test(row)) ?? false,
    ).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { SandboxPolicyError } from "./policy.js";
import {
  resolveRegisteredScenario,
  resolveRemediatingScenario,
  remediatingScenarioId,
  REAL_ESTATE_DEAL_COMPLETION,
  REAL_ESTATE_DEAL_INCOMPLETE_PAYMENT,
  ATLAS_SELF_TEST_UNAUTHORIZED,
} from "./catalog.js";

describe("resolveRegisteredScenario", () => {
  it("binds a registered scenario to a matching TEST-* tenant", () => {
    const bound = resolveRegisteredScenario(
      "real-estate-deal-completion",
      "TEST-REALTY-001",
    );
    expect(bound.id).toBe(REAL_ESTATE_DEAL_COMPLETION.id);
    expect(bound.tenantId).toBe("TEST-REALTY-001");
    expect(bound.steps).toEqual(REAL_ESTATE_DEAL_COMPLETION.steps);
  });

  it("binds the incomplete-payment process-failure scenario", () => {
    const bound = resolveRegisteredScenario(
      "real-estate-deal-incomplete-payment",
      "TEST-REALTY-002",
    );
    expect(bound.steps).not.toContain("simulate_payment");
    expect(bound.domain).toBe("REALTY");
  });

  it("maps a failed process to the healthy domain counterpart", () => {
    expect(remediatingScenarioId(REAL_ESTATE_DEAL_INCOMPLETE_PAYMENT)).toBe(
      REAL_ESTATE_DEAL_COMPLETION.id,
    );
    expect(remediatingScenarioId(ATLAS_SELF_TEST_UNAUTHORIZED)).toBe("crm-lead-to-deal");
    const remediating = resolveRemediatingScenario({
      ...REAL_ESTATE_DEAL_INCOMPLETE_PAYMENT,
      tenantId: "TEST-REALTY-002",
    });
    expect(remediating.id).toBe(REAL_ESTATE_DEAL_COMPLETION.id);
    expect(remediating.tenantId).toBe("TEST-REALTY-002");
    expect(remediating.failureInjection).toBeUndefined();
    expect(remediating.steps).toContain("simulate_payment");
  });

  it("rejects production tenants and unknown scenarios", () => {
    expect(() =>
      resolveRegisteredScenario("real-estate-deal-completion", "def-000"),
    ).toThrow(SandboxPolicyError);
    expect(() =>
      resolveRegisteredScenario("not-a-scenario", "TEST-REALTY"),
    ).toThrow(/not a registered/);
  });
});

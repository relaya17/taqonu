import { describe, expect, it } from "vitest";
import { SANDBOX_CONTROLS, SandboxPolicyError } from "./policy.js";
import { SyntheticUniverse } from "./runner.js";
import { looksSyntheticId } from "./ids.js";
import {
  ATLAS_SELF_TEST_UNAUTHORIZED,
  CRM_LEAD_DEAL,
  HOTEL_RESERVATION,
  PROPERTY_MAINTENANCE,
  REAL_ESTATE_DEAL_COMPLETION,
  SANDBOX_CONTAINMENT_PAYMENT,
  failureScenario,
} from "./catalog.js";
import { attemptRealExternal, simulateExternal } from "./simulation.js";
import { SyntheticEventStream } from "./events.js";

describe("synthetic tenant foundation", () => {
  it("creates isolated synthetic tenants with sandbox controls", () => {
    const universe = new SyntheticUniverse();
    const realty = universe.tenants.create("TEST-REALTY");
    expect(realty.realBusiness).toBe(false);
    expect(realty.environment).toBe("sandbox");
    expect(realty.companyType).toBe("synthetic");
    expect(realty.realPayments).toBe(false);
    expect(realty.externalWrites).toBe(false);
    expect(realty.controls).toEqual(SANDBOX_CONTROLS);
    expect(SANDBOX_CONTROLS.REAL_PAYMENTS).toBe(false);
    expect(SANDBOX_CONTROLS.REAL_EMAIL).toBe(false);
    expect(SANDBOX_CONTROLS.EXTERNAL_WRITE).toBe(false);
  });

  it("refuses production tenant identities", () => {
    const universe = new SyntheticUniverse();
    expect(() => universe.tenants.create("atlas")).toThrow(SandboxPolicyError);
    expect(() => universe.tenants.create("def-000")).toThrow(/production|TEST-/i);
    expect(() => universe.tenants.create("prod-hotel")).toThrow();
  });
});

describe("synthetic data generator", () => {
  it("emits deterministic TEST-* identifiers", () => {
    const a = new SyntheticUniverse();
    const b = new SyntheticUniverse();
    a.tenants.create("TEST-REALTY");
    b.tenants.create("TEST-REALTY");
    const first = a.generator.entity({ tenantId: "TEST-REALTY", kind: "CUSTOMER" });
    const second = b.generator.entity({ tenantId: "TEST-REALTY", kind: "CUSTOMER" });
    expect(first.id).toBe("TEST-CUSTOMER-0001");
    expect(second.id).toBe("TEST-CUSTOMER-0001");
    expect(looksSyntheticId(first.id)).toBe(true);
  });
});

describe("happy-path domain scenarios", () => {
  it("completes the real-estate deal workflow", () => {
    const universe = new SyntheticUniverse();
    const result = universe.run(REAL_ESTATE_DEAL_COMPLETION);
    expect(result.verdict).toBe("VERIFIED");
    expect(result.evidence.assertions.every((row) => row.passed)).toBe(true);
    expect(result.evidence.process.failed).toBe(false);
    expect(result.evidence.events.map((e) => e.name)).toContain("DealCompleted");
    expect(result.evidence.audit.length).toBeGreaterThan(0);
  });

  it("is reproducible across two universe instances", () => {
    const first = new SyntheticUniverse().run(REAL_ESTATE_DEAL_COMPLETION);
    const second = new SyntheticUniverse().run(REAL_ESTATE_DEAL_COMPLETION);
    expect(first.evidence.runId).toBe(second.evidence.runId);
    expect(first.evidence.events.map((e) => e.name)).toEqual(
      second.evidence.events.map((e) => e.name),
    );
    expect(Object.keys(first.evidence.finalState)).toEqual(
      Object.keys(second.evidence.finalState),
    );
  });

  it("runs hotel, property, and CRM domains on shared infrastructure", () => {
    expect(new SyntheticUniverse().run(HOTEL_RESERVATION).verdict).toBe("VERIFIED");
    expect(new SyntheticUniverse().run(PROPERTY_MAINTENANCE).verdict).toBe("VERIFIED");
    expect(new SyntheticUniverse().run(CRM_LEAD_DEAL).verdict).toBe("VERIFIED");
  });
});

describe("process verification", () => {
  it("detects a missing payment transition", () => {
    const universe = new SyntheticUniverse();
    const result = universe.run({
      ...REAL_ESTATE_DEAL_COMPLETION,
      id: "deal-without-payment",
      steps: REAL_ESTATE_DEAL_COMPLETION.steps.filter(
        (s) => s !== "simulate_payment" && s !== "complete_deal",
      ),
    });
    expect(result.verdict).toBe("PROCESS_FAILURE");
    expect(result.evidence.process.failed).toBe(true);
    expect(result.evidence.process.explanation).toMatch(/Process failure/i);
    expect(result.evidence.assertions.find((a) => a.name === "invoice_paid")?.passed).toBe(
      false,
    );
  });
});

describe("failure injection TEST-001 through TEST-010", () => {
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
    it(`detects ${id}`, () => {
      const result = new SyntheticUniverse().run(failureScenario(id));
      expect(["INJECTED_FAILURE_DETECTED", "DENIED", "CONTAINED"]).toContain(
        result.verdict,
      );
      expect(result.evidence.failures.length + result.evidence.audit.length).toBeGreaterThan(
        0,
      );
    });
  }
});

describe("sandbox containment", () => {
  it("denies real payment and still records a synthetic payment", () => {
    const result = new SyntheticUniverse().run(SANDBOX_CONTAINMENT_PAYMENT);
    expect(result.verdict).toBe("CONTAINED");
    expect(result.evidence.events.some((e) => e.name === "ExternalWriteDenied")).toBe(true);
    expect(result.evidence.events.some((e) => e.name === "PaymentStateUpdated")).toBe(true);
    expect(result.evidence.simulations.some((m) => /Payment simulated/i.test(m))).toBe(true);
    expect(
      result.evidence.audit.some((e) => e.type === "synthetic.security.external_write_denied"),
    ).toBe(true);
    const invoice = Object.values(result.evidence.finalState).find((e) => e.kind === "INVOICE");
    expect(invoice?.status).toBe("paid");
  });

  it("never reaches a real external adapter", () => {
    expect(() => attemptRealExternal("whatsapp")).toThrow(/REAL_WHATSAPP|forbidden/i);
    expect(() => attemptRealExternal("email")).toThrow(/REAL_EMAIL|forbidden/i);
    expect(() => attemptRealExternal("payment")).toThrow(/REAL_PAYMENTS|forbidden/i);
  });
});

describe("production-safety containment", () => {
  it("rejects tenant = prod", () => {
    expect(() => new SyntheticUniverse().tenants.create("prod")).toThrow(SandboxPolicyError);
  });

  it("rejects Atlas production identity tenant = def-000", () => {
    expect(() => new SyntheticUniverse().tenants.create("def-000")).toThrow(SandboxPolicyError);
  });

  it("denies realPayment / realWhatsApp / real email / externalWrite", () => {
    expect(() => attemptRealExternal("payment")).toThrow(/REAL_PAYMENTS/);
    expect(() => attemptRealExternal("whatsapp")).toThrow(/REAL_WHATSAPP/);
    expect(() => attemptRealExternal("email")).toThrow(/REAL_EMAIL/);
    expect(() => attemptRealExternal("sms")).toThrow(/REAL_SMS/);
    expect(() => attemptRealExternal("external_write")).toThrow(/EXTERNAL_WRITE/);
  });

  it("simulates synthetic WhatsApp without a network side effect", () => {
    const events = new SyntheticEventStream();
    const result = simulateExternal({
      channel: "whatsapp",
      tenantId: "TEST-CRM",
      runId: "00000000-0000-4000-8000-000000000001",
      events,
    });
    expect(result.simulated).toBe(true);
    expect(result.realExecuted).toBe(false);
    expect(events.list().some((event) => event.name === "WhatsAppSimulated")).toBe(true);
  });
});

describe("Atlas self-test", () => {
  it("denies an unauthorized agent on a protected financial execute", () => {
    const result = new SyntheticUniverse().run(ATLAS_SELF_TEST_UNAUTHORIZED);
    expect(result.verdict).toBe("DENIED");
    expect(result.evidence.authorizationDecisions.some((d) => d.endsWith(":DENIED"))).toBe(
      true,
    );
    expect(result.evidence.assertions.find((a) => a.name === "authorization_denied")?.passed).toBe(
      true,
    );
  });
});

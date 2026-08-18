import { describe, expect, it } from "vitest";
import {
  DEFAULT_ENTITY_POLICIES,
  authorizeEntityAction,
  getEntityPolicy,
} from "./entity-policies.js";

describe("entity policies", () => {
  it("finds a known low-risk read policy", () => {
    const policy = getEntityPolicy("CUSTOMER", "READ");
    expect(policy?.risk).toBe("READ_ONLY");
    expect(policy?.requiresApproval).toBe(false);
  });

  it("returns undefined for an unmapped entity/action combination", () => {
    // TypeScript's Record type says every combination is present, but we
    // still verify the runtime lookup helper degrades safely for any
    // value that could slip through at a JS boundary (e.g. from an
    // upstream tool call that isn't type-checked).
    const unmapped = "NOT_A_REAL_ENTITY" as unknown as Parameters<
      typeof getEntityPolicy
    >[0];
    expect(getEntityPolicy(unmapped, "READ")).toBeUndefined();
  });

  it("every DESTRUCTIVE-tier entity action requires approval (least privilege)", () => {
    for (const actions of Object.values(DEFAULT_ENTITY_POLICIES)) {
      for (const policy of Object.values(actions)) {
        if (policy.risk === "DESTRUCTIVE" || policy.risk === "HIGH_RISK_WRITE") {
          expect(policy.requiresApproval).toBe(true);
        }
      }
    }
  });

  it("DELETE is never silently allowed for any entity type", () => {
    for (const actions of Object.values(DEFAULT_ENTITY_POLICIES)) {
      expect(actions.DELETE.risk).toBe("DESTRUCTIVE");
      expect(actions.DELETE.requiresApproval).toBe(true);
    }
  });

  it("has no duplicate (entityType, action) pairs and covers every declared entity type", () => {
    const pairs = Object.values(DEFAULT_ENTITY_POLICIES).flatMap((actions) =>
      Object.values(actions).map((p) => `${p.entityType}.${p.action}`),
    );
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(Object.keys(DEFAULT_ENTITY_POLICIES).sort()).toEqual(
      [
        "CASE",
        "COMMUNICATION",
        "CONFIGURATION",
        "CUSTOMER",
        "DOCUMENT",
        "FINANCIAL_TRANSACTION",
        "RECORD",
      ].sort(),
    );
  });
});

describe("authorizeEntityAction", () => {
  it("allows a low-risk read in READ mode", () => {
    const result = authorizeEntityAction("CUSTOMER", "READ", {
      mode: "READ",
    });
    expect(result.decision).toBe("ALLOWED");
  });

  it("does not silently allow deleting a customer record", () => {
    const result = authorizeEntityAction("CUSTOMER", "DELETE", {
      mode: "WRITE",
      writeGateOpen: true,
    });
    // Deletion is DESTRUCTIVE and requires explicit human approval; with
    // no `approved` flag passed in, it must never resolve to ALLOWED.
    expect(["DENIED", "APPROVAL_REQUIRED"]).toContain(result.decision);
  });

  it("denies deletion outright when the write gate is closed", () => {
    const result = authorizeEntityAction("CUSTOMER", "DELETE", {
      mode: "WRITE",
      approved: true,
      writeGateOpen: false,
    });
    expect(result.decision).toBe("DENIED");
  });

  it("fails safe (DENIED, not a thrown exception, not ALLOWED) for an unknown entity/action combination", () => {
    const bogusEntity = "NOT_A_REAL_ENTITY" as unknown as Parameters<
      typeof authorizeEntityAction
    >[0];
    const bogusAction = "NOT_A_REAL_ACTION" as unknown as Parameters<
      typeof authorizeEntityAction
    >[1];

    let result;
    expect(() => {
      result = authorizeEntityAction(bogusEntity, bogusAction, {
        mode: "READ",
      });
    }).not.toThrow();

    expect(result!.decision).toBe("DENIED");
    expect(result!.decision).not.toBe("ALLOWED");
  });

  it("denies write-tier entity actions attempted in a read-like mode", () => {
    const result = authorizeEntityAction("CUSTOMER", "UPDATE", {
      mode: "ANALYZE",
      approved: true,
      writeGateOpen: true,
    });
    expect(result.decision).toBe("DENIED");
  });

  it("treats non-read actions in PLAN mode as proposals requiring approval", () => {
    const result = authorizeEntityAction("RECORD", "CREATE", {
      mode: "PLAN",
    });
    expect(result.decision).toBe("APPROVAL_REQUIRED");
  });

  it("denies everything in APPROVE mode, which is a human gate", () => {
    const result = authorizeEntityAction("CUSTOMER", "READ", {
      mode: "APPROVE",
    });
    expect(result.decision).toBe("DENIED");
  });

  it("requires approval for a financial transaction execution even with the write gate open", () => {
    const result = authorizeEntityAction("FINANCIAL_TRANSACTION", "EXECUTE", {
      mode: "WRITE",
      writeGateOpen: true,
    });
    expect(result.decision).toBe("APPROVAL_REQUIRED");
  });

  it("decision policy risk matches the declared default table", () => {
    const result = authorizeEntityAction("CUSTOMER", "READ", {
      mode: "READ",
    });
    expect(result.decision).toBe("ALLOWED");
    if (result.decision === "ALLOWED") {
      expect(result.policy.risk).toBe(
        DEFAULT_ENTITY_POLICIES.CUSTOMER.READ.risk,
      );
    }
  });
});

import { describe, expect, it } from "vitest";
import { unifiedAuditEntrySchema } from "./unified-audit-entry.schema.js";

const base = {
  type: "patch.applied",
  actorId: "agent:ARCHITECT",
  actorKind: "AGENT" as const,
  reason: "auto-remediation of a LOW severity constitution finding",
  risk: "LOW" as const,
  approval: "APPROVED" as const,
  result: "SUCCESS" as const,
};

describe("unifiedAuditEntrySchema", () => {
  it("accepts a minimal well-formed entry and defaults input/output/policy", () => {
    const parsed = unifiedAuditEntrySchema.parse(base);
    expect(parsed.input).toEqual({});
    expect(parsed.output).toEqual({});
    expect(parsed.policy).toBeNull();
  });

  it("accepts a null actorId (system-initiated action with no resolvable actor)", () => {
    expect(() =>
      unifiedAuditEntrySchema.parse({ ...base, actorId: null, actorKind: "SYSTEM" }),
    ).not.toThrow();
  });

  it("rejects an empty reason — WHY is mandatory, not optional", () => {
    expect(() => unifiedAuditEntrySchema.parse({ ...base, reason: "" })).toThrow();
  });

  it("rejects a risk/approval/result value outside the documented enums", () => {
    expect(() => unifiedAuditEntrySchema.parse({ ...base, risk: "EXTREME" })).toThrow();
    expect(() =>
      unifiedAuditEntrySchema.parse({ ...base, approval: "MAYBE" }),
    ).toThrow();
    expect(() => unifiedAuditEntrySchema.parse({ ...base, result: "UNKNOWN" })).toThrow();
  });

  it("rejects an actorKind outside USER/AGENT/SYSTEM", () => {
    expect(() =>
      unifiedAuditEntrySchema.parse({ ...base, actorKind: "ROBOT" }),
    ).toThrow();
  });

  it("carries structured input/output payloads through untouched", () => {
    const parsed = unifiedAuditEntrySchema.parse({
      ...base,
      input: { patchId: "p1" },
      output: { filesChanged: 3 },
    });
    expect(parsed.input).toEqual({ patchId: "p1" });
    expect(parsed.output).toEqual({ filesChanged: 3 });
  });
});

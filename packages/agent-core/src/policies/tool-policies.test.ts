import { describe, expect, it } from "vitest";
import { getEntityPolicy } from "./entity-policies.js";
import { bucketForRiskScore, computeActionRiskScore } from "./risk-score.js";
import {
  DEFAULT_TOOL_POLICIES,
  getToolPolicy,
  resolveCanonicalToolOperation,
  resolveCanonicalToolOperationForRequest,
} from "./tool-policies.js";

describe("tool policies", () => {
  it("finds a known read-only tool policy", () => {
    const policy = getToolPolicy("github.getRepository");
    expect(policy?.risk).toBe("READ_ONLY");
    expect(policy?.requiresApproval).toBe(false);
  });

  it("returns undefined for an unknown tool", () => {
    expect(getToolPolicy("not.a.real.tool")).toBeUndefined();
  });

  it("every non-READ_ONLY tool requires approval (least privilege)", () => {
    for (const policy of DEFAULT_TOOL_POLICIES) {
      if (policy.risk !== "READ_ONLY") {
        expect(policy.requiresApproval).toBe(true);
      }
    }
  });

  it("destructive tools (terminal.execute) deny secret values", () => {
    const policy = getToolPolicy("terminal.execute");
    expect(policy?.risk).toBe("DESTRUCTIVE");
    expect(policy?.secretsAccess).toBe("DENY_VALUES");
  });

  it("has no duplicate tool names in the default policy table", () => {
    const names = DEFAULT_TOOL_POLICIES.map((p) => p.toolName);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every tool has a canonical pair that exists in DEFAULT_ENTITY_POLICIES with matching risk", () => {
    for (const policy of DEFAULT_TOOL_POLICIES) {
      const entity = getEntityPolicy(policy.entityType, policy.action);
      expect(entity, `${policy.toolName} ${policy.entityType}.${policy.action}`).toBeDefined();
      expect(entity?.risk).toBe(policy.risk);
    }
  });

  it("resolves fs.read_file to DOCUMENT.READ (tool-execute production join)", () => {
    expect(resolveCanonicalToolOperation("fs.read_file")).toEqual({
      entityType: "DOCUMENT",
      action: "READ",
    });
  });

  it("uses the canonical pair when the client omits an assertion", () => {
    const result = resolveCanonicalToolOperationForRequest("fs.read_file");
    expect(result).toEqual({
      ok: true,
      entityType: "DOCUMENT",
      action: "READ",
    });
  });

  it("accepts a client assertion that matches the canonical pair", () => {
    const result = resolveCanonicalToolOperationForRequest("fs.read_file", {
      entityType: "DOCUMENT",
      action: "READ",
    });
    expect(result.ok).toBe(true);
  });

  it("denies a client assertion that picks another valid entity-policy cell", () => {
    const result = resolveCanonicalToolOperationForRequest("fs.read_file", {
      entityType: "FINANCIAL_TRANSACTION",
      action: "EXECUTE",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("DOCUMENT.READ");
      expect(result.reason).toContain("FINANCIAL_TRANSACTION.EXECUTE");
    }
  });

  it("fails closed when the tool has no ToolPolicy", () => {
    expect(resolveCanonicalToolOperation("not.a.real.tool")).toBeUndefined();
    const result = resolveCanonicalToolOperationForRequest("not.a.real.tool");
    expect(result.ok).toBe(false);
  });

  it("canonical DESTRUCTIVE pair still buckets HUMAN_ONLY under default risk inputs", () => {
    const policy = getToolPolicy("terminal.execute");
    expect(policy?.entityType).toBe("CONFIGURATION");
    expect(policy?.action).toBe("EXECUTE");
    const score = computeActionRiskScore({
      baseTier: policy!.risk,
      requiresApproval: policy!.requiresApproval,
    });
    expect(bucketForRiskScore(score)).toBe("HUMAN_ONLY");
  });
});

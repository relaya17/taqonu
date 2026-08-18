import { describe, expect, it } from "vitest";
import { DEFAULT_TOOL_POLICIES, getToolPolicy } from "./tool-policies.js";

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
});

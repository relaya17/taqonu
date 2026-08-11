import { describe, expect, it } from "vitest";
import { planQaRun } from "./plan.js";

describe("planQaRun", () => {
  it("excludes destructive domains in PRODUCTION_SAFE", () => {
    const plan = planQaRun({
      scope: "SINGLE_PROJECT",
      profile: "DEEP",
      environment: "PRODUCTION_SAFE",
      projectIds: ["00000000-0000-4000-8000-000000000001"],
    });
    expect(plan.domains.every((d) =>
      ["DEPLOYMENT", "API", "FUNCTIONAL"].includes(d),
    )).toBe(true);
  });

  it("adds PORTFOLIO domain for entire portfolio scope", () => {
    const plan = planQaRun({
      scope: "ENTIRE_PORTFOLIO",
      profile: "STANDARD",
      environment: "LOCAL",
      projectIds: [],
    });
    expect(plan.domains).toContain("PORTFOLIO");
  });
});

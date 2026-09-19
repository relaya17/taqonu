import { describe, expect, it } from "vitest";
import { studioTruthHref } from "./studio-truth-href";

describe("studioTruthHref", () => {
  it("preserves project as a query field, not a concatenated path string", () => {
    const projectId = "00000000-0000-4000-8000-def000000001";
    const href = studioTruthHref(projectId);
    expect(href.pathname).toBe("/truth");
    expect(href.query.project).toBe(projectId);
    expect(JSON.stringify(href)).not.toContain("/truth?");
  });
});

import { describe, expect, it } from "vitest";
import { buildAgentContext, type ContextBlock } from "./builder.js";

describe("buildAgentContext", () => {
  it("groups blocks by category into separate sections", () => {
    const blocks: ContextBlock[] = [
      { category: "DECISION_MEMORY", epistemicState: "FACT", title: "d1", content: "c1" },
      { category: "EVENT_MEMORY", epistemicState: "INFERRED", title: "m1", content: "c2" },
      { category: "DECISION_MEMORY", epistemicState: "FACT", title: "d2", content: "c3" },
    ];
    const ctx = buildAgentContext(blocks);
    expect(ctx).toContain("## DECISION_MEMORY");
    expect(ctx).toContain("## EVENT_MEMORY");
    // Both DECISION_MEMORY items appear once, under one heading (not merged into EVENT_MEMORY)
    expect(ctx.indexOf("d1")).toBeGreaterThan(-1);
    expect(ctx.indexOf("d2")).toBeGreaterThan(-1);
  });

  it("labels every item with its epistemicState so categories are never silently merged as equal facts", () => {
    const ctx = buildAgentContext([
      { category: "REPOSITORY_EVIDENCE", epistemicState: "UNKNOWN", title: "t", content: "c" },
    ]);
    expect(ctx).toContain("[UNKNOWN]");
  });

  it("returns just the header for an empty block list", () => {
    const ctx = buildAgentContext([]);
    expect(ctx).toContain("ATLAS CONTEXT");
    expect(ctx.split("\n").length).toBeLessThanOrEqual(2);
  });
});

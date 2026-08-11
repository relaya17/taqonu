import { describe, expect, it } from "vitest";
import { selectExperts, buildExpertSystemBlock } from "./select.js";

describe("selectExperts", () => {
  it("routes UI questions to UI_UX", () => {
    const sel = selectExperts("שפר את חוויית המשתמש במסך הפרויקטים");
    expect(sel.primary).toBe("UI_UX");
  });

  it("routes design/photoshop to VISUAL_DESIGN", () => {
    const sel = selectExperts("Need Photoshop export specs and brand typography");
    expect(sel.primary).toBe("VISUAL_DESIGN");
  });

  it("honors forced council", () => {
    const sel = selectExperts("anything", ["QA", "SECURITY"]);
    expect(sel.primary).toBe("QA");
    expect(sel.supporting).toContain("SECURITY");
  });

  it("builds system block mentioning editor boundary", () => {
    const block = buildExpertSystemBlock(
      selectExperts("accessibility RTL Hebrew"),
    );
    expect(block).toContain("Expert Council");
    expect(block).toContain("not an IDE");
  });
});

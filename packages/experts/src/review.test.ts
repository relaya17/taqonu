import { describe, expect, it } from "vitest";
import { runExpertReview } from "./review.js";

describe("runExpertReview", () => {
  it("returns checklist findings for UI_UX", () => {
    const review = runExpertReview({
      expertId: "UI_UX",
      userRequest: "תבדוק UX של מסך הפרויקטים ומצבי ריק",
      projectId: null,
    });
    expect(review.expertId).toBe("UI_UX");
    expect(review.findings.length).toBeGreaterThan(3);
    expect(review.recommendations.length).toBeGreaterThan(0);
  });

  it("flags photoshop handoff for visual design", () => {
    const review = runExpertReview({
      expertId: "VISUAL_DESIGN",
      userRequest: "Need Photoshop export specs and style direction",
      projectId: "00000000-0000-4000-8000-000000000099",
    });
    const handoff = review.findings.find((f) =>
      /photoshop|figma|export/i.test(f.checklistItem),
    );
    expect(handoff?.status).toBe("WARN");
  });
});

import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLegalMediaReview } from "./legal-media-review.js";

describe("runLegalMediaReview", () => {
  it("returns INSUFFICIENT_EVIDENCE without workspace root", () => {
    const review = runLegalMediaReview({ projectId: null, workspaceRoot: null });
    expect(review.notALawyer).toBe(true);
    expect(review.lawyerReadiness).toBe("INSUFFICIENT_EVIDENCE");
    expect(review.disclaimerHe).toMatch(/ייעוץ משפטי/);
    expect(review.verifiedSources.length).toBeGreaterThan(3);
  });

  it("flags missing privacy/terms as NEEDS_FIXES on thin app", () => {
    const dir = mkdtempSync(join(tmpdir(), "atlas-legal-"));
    writeFileSync(join(dir, "app.tsx"), "export const App = () => null;\n");
    const review = runLegalMediaReview({
      projectId: "11111111-1111-4111-8111-111111111111",
      workspaceRoot: dir,
    });
    expect(review.notALawyer).toBe(true);
    expect(review.findings.some((f) => f.id === "privacy-terms" && f.status === "FAIL")).toBe(
      true,
    );
    expect(review.lawyerReadiness).toBe("NEEDS_FIXES");
  });

  it("reaches READY_FOR_COUNSEL when core surfaces exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "atlas-legal-ok-"));
    writeFileSync(
      join(dir, "legal.md"),
      [
        "Privacy Policy and Terms of Service",
        "cookie consent banner GDPR",
        "delete account and export data",
        "content moderation takedown report content",
        "sponsored advertising disclosure",
        "copyright license attribution",
        "age gate under 18",
        "company בע״מ legal@example.com",
      ].join("\n"),
    );
    const review = runLegalMediaReview({
      projectId: "11111111-1111-4111-8111-111111111111",
      workspaceRoot: dir,
    });
    expect(review.lawyerReadiness).toBe("READY_FOR_COUNSEL");
    expect(review.findings.every((f) => f.status === "PASS" || f.status === "UNKNOWN")).toBe(
      true,
    );
  });
});

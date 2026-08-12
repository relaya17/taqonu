import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { engineeringIssueSchema } from "@atlas/shared";
import {
  draftAutoRemediations,
  isAutoApplyEligibleIssue,
  isAutoApplyEligiblePatch,
  isAutoRemediationEligibleIssue,
  remediationNotePath,
  verifyRemediationApply,
} from "./auto-remediation.js";

function issue(
  partial: Partial<ReturnType<typeof engineeringIssueSchema.parse>> & {
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    remediationPolicy: "AUTO_FIX" | "PR_REVIEW" | "RECOMMENDATION_ONLY" | "HUMAN_APPROVAL";
  },
) {
  return engineeringIssueSchema.parse({
    id: crypto.randomUUID(),
    category: "DOCUMENTATION",
    title: partial.title ?? "Constitution · Architecture decisions recorded",
    affectedComponents: [],
    rootCause: "Missing ADR folder",
    evidence: [
      {
        ref: "docs/adr",
        note: "not found",
        epistemicState: "OBSERVED",
      },
    ],
    confidence: 0.75,
    recommendedFix: "Record key ADRs — high signal only",
    proposedPatchHint: null,
    testsSuggested: ["Constitution check docs.adr"],
    regressionResult: "NOT_RUN",
    approvalStatus: "OPEN",
    architectureViolation: false,
    constitutionDomain: "DOCUMENTATION",
    omission: false,
    ...partial,
  });
}

describe("auto-remediation draft + policy", () => {
  it("drafts AUTO_FIX for LOW and MEDIUM only", () => {
    const low = issue({ severity: "LOW", remediationPolicy: "AUTO_FIX" });
    const med = issue({
      severity: "MEDIUM",
      remediationPolicy: "AUTO_FIX",
      title: "Medium auto-fixable",
    });
    const high = issue({
      severity: "HIGH",
      remediationPolicy: "RECOMMENDATION_ONLY",
      title: "High finding",
    });
    const crit = issue({
      severity: "CRITICAL",
      remediationPolicy: "HUMAN_APPROVAL",
      title: "Critical finding",
    });

    expect(isAutoRemediationEligibleIssue(low)).toBe(true);
    expect(isAutoRemediationEligibleIssue(med)).toBe(true);
    expect(isAutoRemediationEligibleIssue(high)).toBe(false);
    expect(isAutoRemediationEligibleIssue(crit)).toBe(false);

    expect(isAutoApplyEligibleIssue(low)).toBe(true);
    expect(isAutoApplyEligibleIssue(med)).toBe(false);
    expect(isAutoApplyEligibleIssue(high)).toBe(false);

    const drafts = draftAutoRemediations({
      projectId: null,
      issues: [low, med, high, crit],
      workspaceRoot: "/tmp/ws",
    });
    expect(drafts).toHaveLength(2);
    expect(drafts.every((d) => d.patch.title.startsWith("AUTO_FIX:"))).toBe(
      true,
    );
    expect(drafts.find((d) => d.issueId === low.id)?.autoApplyEligible).toBe(
      true,
    );
    expect(drafts.find((d) => d.issueId === med.id)?.autoApplyEligible).toBe(
      false,
    );
    expect(drafts[0]!.patch.filesChanged[0]!.path).toBe(
      remediationNotePath(drafts[0]!.issueId),
    );
  });

  it("skips issues that already have drafts", () => {
    const low = issue({ severity: "LOW", remediationPolicy: "AUTO_FIX" });
    const drafts = draftAutoRemediations({
      projectId: null,
      issues: [low],
      workspaceRoot: "/tmp/ws",
      existingSourceIssueIds: new Set([low.id]),
    });
    expect(drafts).toHaveLength(0);
  });

  it("marks only LOW auto-remediation patches as auto-apply eligible", () => {
    const [draft] = draftAutoRemediations({
      projectId: null,
      issues: [issue({ severity: "LOW", remediationPolicy: "AUTO_FIX" })],
      workspaceRoot: "/tmp/ws",
    });
    expect(isAutoApplyEligiblePatch(draft!.patch)).toBe(true);
    expect(
      isAutoApplyEligiblePatch({ ...draft!.patch, risk: "HIGH" }),
    ).toBe(false);
  });
});

describe("verifyRemediationApply", () => {
  it("passes smoke checks when note file exists with markers", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-remediation-"));
    const low = issue({ severity: "LOW", remediationPolicy: "AUTO_FIX" });
    const [draft] = draftAutoRemediations({
      projectId: null,
      issues: [low],
      workspaceRoot: root,
    });
    const rel = draft!.patch.filesChanged[0]!.path;
    const full = join(root, rel);
    mkdirSync(join(root, ".atlas", "remediation"), { recursive: true });
    writeFileSync(full, draft!.patch.filesChanged[0]!.afterContent!, "utf8");
    expect(existsSync(full)).toBe(true);

    const result = verifyRemediationApply({
      workspaceRoot: root,
      patch: draft!.patch,
      appliedPaths: [rel],
    });
    expect(result.ok).toBe(true);
    expect(result.summary).toMatch(/PASS/);
  });

  it("fails when applied file is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-remediation-miss-"));
    const [draft] = draftAutoRemediations({
      projectId: null,
      issues: [issue({ severity: "LOW", remediationPolicy: "AUTO_FIX" })],
      workspaceRoot: root,
    });
    const result = verifyRemediationApply({
      workspaceRoot: root,
      patch: draft!.patch,
      appliedPaths: [draft!.patch.filesChanged[0]!.path],
    });
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/FAIL/);
  });
});

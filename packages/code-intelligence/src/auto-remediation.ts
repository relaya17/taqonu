/**
 * Auto-remediation for LOW / AUTO_FIX constitution+audit issues.
 * Does not apply production mutations without approval — proposes patch drafts.
 */
import type { EngineeringIssue, PatchArtifact } from "@atlas/shared";
import { patchArtifactSchema } from "@atlas/shared";

export interface AutoRemediationDraft {
  readonly issueId: string;
  readonly title: string;
  readonly remediationPolicy: string;
  readonly patch: PatchArtifact;
  readonly note: string;
}

export function draftAutoRemediations(input: {
  readonly projectId: string | null;
  readonly issues: readonly EngineeringIssue[];
  readonly workspaceRoot: string;
}): AutoRemediationDraft[] {
  const now = new Date().toISOString();
  const eligible = input.issues.filter(
    (i) =>
      i.remediationPolicy === "AUTO_FIX" &&
      (i.severity === "LOW" || i.severity === "MEDIUM") &&
      i.approvalStatus === "OPEN",
  );

  return eligible.slice(0, 8).map((issue) => {
    const hint =
      issue.recommendedFix ||
      issue.proposedPatchHint ||
      "Add missing config/docs per Constitution remediation hint.";
    const afterContent = [
      `# Auto-remediation draft`,
      "",
      `Issue: ${issue.title}`,
      `Severity: ${issue.severity}`,
      `Policy: ${issue.remediationPolicy}`,
      `Workspace: ${input.workspaceRoot}`,
      "",
      `## Recommended fix`,
      hint,
      "",
      `## Evidence`,
      ...issue.evidence.map((e) => `- ${e.ref}: ${e.note}`),
      "",
      `_Generated ${now}. Requires human approve before apply._`,
    ].join("\n");

    const patch = patchArtifactSchema.parse({
      id: crypto.randomUUID(),
      projectId: input.projectId,
      title: `AUTO_FIX: ${issue.title}`.slice(0, 200),
      reason: hint.slice(0, 4000),
      mode: "generate",
      status: "AWAITING_APPROVAL",
      risk: issue.severity === "MEDIUM" ? "MEDIUM" : "LOW",
      baseCommit: null,
      targetBranch: null,
      filesChanged: [
        {
          path: ".atlas/remediation-notes.md",
          action: "add",
          summary: `Remediation for ${issue.id}`,
          afterContent,
        },
      ],
      evidenceIds: [],
      claimIds: [],
      expectedImpact: `Address Constitution/audit issue: ${issue.title}`.slice(
        0,
        2000,
      ),
      tests: issue.testsSuggested.slice(0, 10),
      evaluationSummary: `AUTO_FIX draft linked to finding ${issue.id}. Approval required before apply.`,
      sourceIssueId: issue.id,
      approvals: [],
      appliedAt: null,
      verifiedAt: null,
      rollbackRef: null,
      rollbackSnapshot: [],
      createdAt: now,
      updatedAt: now,
      createdBy: "atlas-auto-remediation",
      epistemicState: "PROPOSED",
      confidence: 0.45,
      authorityHint: "LLM_INFERENCE",
    });

    return {
      issueId: issue.id,
      title: issue.title,
      remediationPolicy: issue.remediationPolicy,
      patch,
      note: "Draft only — WRITE stays approval-gated",
    };
  });
}

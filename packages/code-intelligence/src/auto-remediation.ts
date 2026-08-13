/**
 * Auto-remediation for LOW / AUTO_FIX constitution+audit issues.
 *
 * Closed loop (MVP):
 *   detect → draft AUTO_FIX patch → (LOW auto-approve or queue) → apply under WRITE → verify → evidence
 *
 * Does not mutate production without gates. Note-file applies stay path-safe under `.atlas/`.
 * HIGH / CRITICAL never auto-apply.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { EngineeringIssue, PatchArtifact } from "@atlas/shared";
import { patchArtifactSchema } from "@atlas/shared";

export interface AutoRemediationDraft {
  readonly issueId: string;
  readonly title: string;
  readonly remediationPolicy: string;
  readonly severity: EngineeringIssue["severity"];
  readonly patch: PatchArtifact;
  readonly note: string;
  readonly autoApplyEligible: boolean;
}

export interface RemediationVerifyResult {
  readonly ok: boolean;
  readonly checks: readonly {
    readonly id: string;
    readonly passed: boolean;
    readonly detail: string;
  }[];
  readonly summary: string;
}

/** Relative path under workspaceRoot for a note-file remediation. */
export function remediationNotePath(issueId: string): string {
  const short = issueId.replace(/-/g, "").slice(0, 12);
  return `.atlas/remediation/${short}.md`;
}

export function isAutoRemediationEligibleIssue(
  issue: EngineeringIssue,
): boolean {
  return (
    issue.remediationPolicy === "AUTO_FIX" &&
    (issue.severity === "LOW" || issue.severity === "MEDIUM") &&
    issue.approvalStatus === "OPEN"
  );
}

/**
 * LOW AUTO_FIX only. MEDIUM still drafts but stays human-gated.
 * HIGH/CRITICAL never eligible.
 */
export function isAutoApplyEligibleIssue(issue: EngineeringIssue): boolean {
  return (
    isAutoRemediationEligibleIssue(issue) &&
    issue.severity === "LOW" &&
    issue.remediationPolicy === "AUTO_FIX"
  );
}

export function isAutoApplyEligiblePatch(patch: PatchArtifact): boolean {
  return (
    patch.risk === "LOW" &&
    (patch.createdBy === "atlas-auto-remediation" ||
      patch.createdBy === "atlas-truth-remediation" ||
      Boolean(patch.sourceIssueId) ||
      patch.title.startsWith("AUTO_FIX:") ||
      patch.title.startsWith("TRUTH_FIX:")) &&
    patch.status !== "APPLIED" &&
    patch.status !== "ROLLED_BACK" &&
    patch.status !== "REJECTED"
  );
}

function noteBody(input: {
  readonly issue: EngineeringIssue;
  readonly workspaceRoot: string;
  readonly now: string;
  readonly autoApplyEligible: boolean;
}): string {
  const hint =
    input.issue.recommendedFix ||
    input.issue.proposedPatchHint ||
    "Add missing config/docs per Constitution remediation hint.";
  return [
    `# Auto-remediation draft`,
    "",
    `Issue: ${input.issue.title}`,
    `Issue ID: ${input.issue.id}`,
    `Severity: ${input.issue.severity}`,
    `Policy: ${input.issue.remediationPolicy}`,
    `Domain: ${input.issue.constitutionDomain ?? "n/a"}`,
    `Workspace: ${input.workspaceRoot}`,
    `Auto-apply eligible (LOW only): ${input.autoApplyEligible ? "yes" : "no"}`,
    "",
    `## Recommended fix`,
    hint,
    "",
    `## Evidence`,
    ...input.issue.evidence.map((e) => `- ${e.ref}: ${e.note}`),
    "",
    input.autoApplyEligible
      ? `_LOW AUTO_FIX — may auto-apply only when ATLAS_AUTO_APPLY_LOW or explicit flag + WRITE session._`
      : `_Requires human approve before apply. HIGH/CRITICAL never auto-apply._`,
    `_Generated ${input.now}._`,
  ].join("\n");
}

export function draftAutoRemediations(input: {
  readonly projectId: string | null;
  readonly issues: readonly EngineeringIssue[];
  readonly workspaceRoot: string;
  /** Skip issues that already have an open remediation draft. */
  readonly existingSourceIssueIds?: ReadonlySet<string>;
}): AutoRemediationDraft[] {
  const now = new Date().toISOString();
  const skip = input.existingSourceIssueIds ?? new Set<string>();
  const eligible = input.issues.filter(
    (i) => isAutoRemediationEligibleIssue(i) && !skip.has(i.id),
  );

  return eligible.slice(0, 8).map((issue) => {
    const autoApplyEligible = isAutoApplyEligibleIssue(issue);
    const hint =
      issue.recommendedFix ||
      issue.proposedPatchHint ||
      "Add missing config/docs per Constitution remediation hint.";
    const notePath = remediationNotePath(issue.id);
    const afterContent = noteBody({
      issue,
      workspaceRoot: input.workspaceRoot,
      now,
      autoApplyEligible,
    });

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
          path: notePath,
          action: "add",
          summary: `Remediation note for ${issue.id}`,
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
      evaluationSummary: autoApplyEligible
        ? `AUTO_FIX draft linked to finding ${issue.id}. LOW — eligible for gated auto-apply when policy allows.`
        : `AUTO_FIX draft linked to finding ${issue.id}. Human approve required before apply.`,
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
      severity: issue.severity,
      patch,
      note: autoApplyEligible
        ? "LOW draft — auto-apply only with ATLAS_AUTO_APPLY_LOW or explicit flag + WRITE"
        : "Draft only — WRITE stays approval-gated",
      autoApplyEligible,
    };
  });
}

/**
 * Post-apply smoke verify for note-file (and general) remediations.
 * Confirms applied paths exist under workspaceRoot and contain issue markers.
 */
export function verifyRemediationApply(input: {
  readonly workspaceRoot: string;
  readonly patch: PatchArtifact;
  readonly appliedPaths?: readonly string[];
}): RemediationVerifyResult {
  const root = resolve(input.workspaceRoot);
  const checks: Array<{
    id: string;
    passed: boolean;
    detail: string;
  }> = [];

  const paths =
    input.appliedPaths && input.appliedPaths.length > 0
      ? input.appliedPaths
      : input.patch.filesChanged.map((f) => f.path);

  for (const rel of paths) {
    if (rel.includes("..") || rel.startsWith("/") || /^[A-Za-z]:/.test(rel)) {
      checks.push({
        id: `path-safe:${rel}`,
        passed: false,
        detail: "Path failed traversal safety check",
      });
      continue;
    }
    const full = join(root, rel);
    const exists = existsSync(full);
    checks.push({
      id: `exists:${rel}`,
      passed: exists,
      detail: exists
        ? `Applied file present: ${rel}`
        : `Missing after apply: ${rel}`,
    });

    if (exists && input.patch.sourceIssueId) {
      try {
        const text = readFileSync(full, "utf8");
        const hasIssue = text.includes(input.patch.sourceIssueId);
        const hasAutoFix =
          text.includes("Auto-remediation") || text.includes("AUTO_FIX");
        checks.push({
          id: `marker:${rel}`,
          passed: hasIssue || hasAutoFix,
          detail:
            hasIssue || hasAutoFix
              ? "Remediation markers found in applied file"
              : "Applied file missing issue/AUTO_FIX markers",
        });
      } catch {
        checks.push({
          id: `marker:${rel}`,
          passed: false,
          detail: "Could not read applied file for marker check",
        });
      }
    }
  }

  if (paths.length === 0) {
    checks.push({
      id: "applied-paths",
      passed: false,
      detail: "No applied paths to verify",
    });
  }

  const ok = checks.length > 0 && checks.every((c) => c.passed);
  const summary = ok
    ? `Verify PASS — ${checks.length} smoke check(s) for patch ${input.patch.id}`
    : `Verify FAIL — ${checks.filter((c) => !c.passed).length}/${checks.length} check(s) failed for patch ${input.patch.id}`;

  return { ok, checks, summary };
}

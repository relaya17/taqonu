/**
 * Closed remediation loop orchestration (detect drafts → optional LOW auto-apply → verify).
 * Reuses approve/apply WRITE gates — never bypasses them for HIGH/CRITICAL.
 */
import {
  draftAutoRemediations,
  isAutoApplyEligiblePatch,
  verifyRemediationApply,
  type AutoRemediationDraft,
  type RemediationVerifyResult,
} from "@atlas/code-intelligence";
import {
  AtlasError,
  type AuthUser,
  type EngineeringIssue,
  type PatchArtifact,
} from "@atlas/shared";
import { osStore } from "../store/os-store.js";
import { appendDomainEvent } from "./memory-pipeline.js";
import {
  approvePatchArtifact,
  applyApprovedPatch,
  isAutoRemediationDraft,
  recordRemediationVerification,
  resolveApplyWorkspaceRoot,
} from "./patch-write.js";

export function openRemediationSourceIssueIds(
  projectId: string | null,
): Set<string> {
  const open = new Set<string>();
  for (const p of osStore.listPatches(projectId)) {
    if (
      isAutoRemediationDraft(p) &&
      p.sourceIssueId &&
      p.status !== "ROLLED_BACK" &&
      p.status !== "REJECTED"
    ) {
      open.add(p.sourceIssueId);
    }
  }
  return open;
}

export function persistAutoRemediationDrafts(input: {
  readonly projectId: string | null;
  readonly issues: readonly EngineeringIssue[];
  readonly workspaceRoot: string;
}): AutoRemediationDraft[] {
  const drafts = draftAutoRemediations({
    projectId: input.projectId,
    issues: input.issues,
    workspaceRoot: input.workspaceRoot,
    existingSourceIssueIds: openRemediationSourceIssueIds(input.projectId),
  });
  for (const d of drafts) {
    osStore.upsertPatch(d.patch);
    appendDomainEvent({
      type: "patch.proposed",
      projectId: d.patch.projectId,
      epistemicState: "PROPOSED",
      payload: {
        kind: "auto-remediation",
        patchId: d.patch.id,
        issueId: d.issueId,
        remediationPolicy: d.remediationPolicy,
        severity: d.severity,
        autoApplyEligible: d.autoApplyEligible,
        title: d.title,
      },
    });
  }
  return drafts;
}

export function shouldAutoApplyLow(input: {
  readonly envFlag: boolean;
  readonly requestFlag: boolean;
  readonly user: AuthUser | null;
}): boolean {
  if (!input.user) return false;
  return input.envFlag || input.requestFlag;
}

export function verifyAppliedRemediation(input: {
  readonly patch: PatchArtifact;
  readonly workspaceRoot?: string | null;
  readonly appliedPaths?: readonly string[];
  readonly userId: string;
}): { patch: PatchArtifact; verify: RemediationVerifyResult } {
  if (input.patch.status !== "APPLIED" && input.patch.status !== "VERIFIED") {
    throw new AtlasError(
      "VALIDATION_ERROR",
      `Cannot verify patch in status ${input.patch.status} — apply first`,
      { statusCode: 400 },
    );
  }
  const workspaceRoot = resolveApplyWorkspaceRoot({
    projectId: input.patch.projectId,
    bodyWorkspaceRoot: input.workspaceRoot ?? null,
    requireProjectRoot: Boolean(input.patch.projectId),
  });
  const verify = verifyRemediationApply({
    workspaceRoot,
    patch: input.patch,
    ...(input.appliedPaths ? { appliedPaths: input.appliedPaths } : {}),
  });
  const patch = recordRemediationVerification({
    patch: input.patch,
    workspaceRoot,
    verify,
    userId: input.userId,
  });
  return { patch, verify };
}

export type AutoApplyOutcome = {
  readonly patchId: string;
  readonly issueId: string | null;
  readonly status: "skipped" | "applied" | "failed";
  readonly reason?: string;
  readonly verified?: boolean;
  readonly patch?: PatchArtifact;
};

/**
 * Auto-approve + apply + verify LOW AUTO_FIX drafts only.
 * Requires signed-in WRITE user and env/request flag (checked by caller).
 */
export function autoApplyLowRemediations(input: {
  readonly drafts: readonly AutoRemediationDraft[];
  readonly user: AuthUser;
  readonly bodyWorkspaceRoot?: string | null;
}): AutoApplyOutcome[] {
  const outcomes: AutoApplyOutcome[] = [];

  for (const d of input.drafts) {
    if (!d.autoApplyEligible || !isAutoApplyEligiblePatch(d.patch)) {
      outcomes.push({
        patchId: d.patch.id,
        issueId: d.issueId,
        status: "skipped",
        reason: "Not LOW auto-apply eligible (MEDIUM+ stay human-gated)",
      });
      continue;
    }

    try {
      const approved = approvePatchArtifact(d.patch, {
        approvedBy: `atlas-auto-apply:${input.user.email}`,
        note: "LOW AUTO_FIX auto-approved under ATLAS_AUTO_APPLY_LOW / explicit flag + WRITE session",
        userId: input.user.id,
      });
      const { patch, apply } = applyApprovedPatch({
        existing: approved,
        user: input.user,
        bodyWorkspaceRoot: input.bodyWorkspaceRoot ?? null,
        requireProjectRoot: Boolean(approved.projectId),
        skipVerify: true,
      });
      const verified = verifyAppliedRemediation({
        patch,
        workspaceRoot: input.bodyWorkspaceRoot ?? null,
        appliedPaths: apply.applied,
        userId: input.user.id,
      });
      outcomes.push({
        patchId: verified.patch.id,
        issueId: d.issueId,
        status: "applied",
        verified: verified.verify.ok,
        patch: verified.patch,
      });
    } catch (err) {
      outcomes.push({
        patchId: d.patch.id,
        issueId: d.issueId,
        status: "failed",
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return outcomes;
}

export function summarizeDrafts(drafts: readonly AutoRemediationDraft[]) {
  return drafts.map((d) => ({
    issueId: d.issueId,
    patchId: d.patch.id,
    title: d.title,
    note: d.note,
    remediationPolicy: d.remediationPolicy,
    severity: d.severity,
    autoApplyEligible: d.autoApplyEligible,
    status: d.patch.status,
  }));
}

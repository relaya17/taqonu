import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  AtlasError,
  STUB_OWNER_ID,
  parseEvidenceRecord,
  patchArtifactSchema,
  type AuthUser,
  type PatchArtifact,
} from "@atlas/shared";
import {
  applyPatchFiles,
  verifyRemediationApply,
  type RemediationVerifyResult,
} from "@atlas/code-intelligence";
import { osStore } from "../store/os-store.js";
import { appendDomainEvent } from "./memory-pipeline.js";
import { atlasMetrics } from "../routes/metrics.js";

export function isAutoRemediationDraft(patch: PatchArtifact): boolean {
  return (
    patch.createdBy === "atlas-auto-remediation" ||
    patch.createdBy === "atlas-truth-remediation" ||
    Boolean(patch.sourceIssueId) ||
    patch.title.startsWith("AUTO_FIX:") ||
    patch.title.startsWith("TRUTH_FIX:")
  );
}

/**
 * Apply writes only under an explicit root — never scans the whole disk.
 * Prefer the project's osStore workspaceRoot when projectId is set.
 */
export function resolveApplyWorkspaceRoot(input: {
  readonly projectId: string | null;
  readonly bodyWorkspaceRoot?: string | null | undefined;
  readonly requireProjectRoot?: boolean | undefined;
}): string {
  if (input.projectId) {
    const stored = osStore.getWorkspaceRoot(input.projectId);
    if (!stored) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        "Project has no explicit workspaceRoot — set PUT /api/v1/projects/:id/workspace-root first",
        { statusCode: 400 },
      );
    }
    const root = resolve(stored);
    if (!existsSync(root)) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        `workspaceRoot not found on disk: ${root}`,
        { statusCode: 400 },
      );
    }
    if (input.bodyWorkspaceRoot?.trim()) {
      const bodyRoot = resolve(input.bodyWorkspaceRoot);
      if (bodyRoot !== root) {
        throw new AtlasError(
          "FORBIDDEN",
          "Apply workspaceRoot must match the project's explicit workspaceRoot",
          { statusCode: 403 },
        );
      }
    }
    return root;
  }

  if (input.requireProjectRoot) {
    throw new AtlasError(
      "VALIDATION_ERROR",
      "AUTO_FIX apply requires a patch with projectId and an explicit workspaceRoot",
      { statusCode: 400 },
    );
  }

  if (!input.bodyWorkspaceRoot?.trim()) {
    throw new AtlasError(
      "VALIDATION_ERROR",
      "workspaceRoot is required when the patch has no projectId",
      { statusCode: 400 },
    );
  }
  const root = resolve(input.bodyWorkspaceRoot);
  if (!existsSync(root)) {
    throw new AtlasError(
      "VALIDATION_ERROR",
      `workspaceRoot not found on disk: ${root}`,
      { statusCode: 400 },
    );
  }
  return root;
}

export function assertPatchApprovedForApply(existing: PatchArtifact): void {
  if (existing.status !== "APPROVED") {
    throw new AtlasError(
      "FORBIDDEN",
      `Patch status ${existing.status} cannot apply — approve first`,
      { statusCode: 403 },
    );
  }
  if (existing.approvals.length === 0) {
    throw new AtlasError(
      "FORBIDDEN",
      "Prior approval record required before Apply (no auto-approve)",
      { statusCode: 403 },
    );
  }
}

export function approvePatchArtifact(
  existing: PatchArtifact,
  input: {
    readonly approvedBy: string;
    readonly note?: string;
    readonly userId: string;
  },
): PatchArtifact {
  if (
    existing.status === "APPLIED" ||
    existing.status === "VERIFIED" ||
    existing.status === "ROLLED_BACK"
  ) {
    throw new AtlasError(
      "VALIDATION_ERROR",
      `Cannot approve patch in status ${existing.status}`,
    );
  }
  const now = new Date().toISOString();
  const approval: { by: string; at: string; note?: string } = {
    by: input.approvedBy,
    at: now,
  };
  if (input.note !== undefined) approval.note = input.note;
  const patch = patchArtifactSchema.parse({
    ...existing,
    status: "APPROVED",
    approvals: [...existing.approvals, approval],
    updatedAt: now,
  });
  osStore.upsertPatch(patch);
  osStore.appendAudit({
    type: "code.patch.approved",
    patchId: existing.id,
    at: now,
    by: input.userId,
    sourceIssueId: existing.sourceIssueId ?? null,
  });
  return patch;
}

export function recordRemediationVerification(input: {
  readonly patch: PatchArtifact;
  readonly workspaceRoot: string;
  readonly verify: RemediationVerifyResult;
  readonly userId: string;
}): PatchArtifact {
  const now = new Date().toISOString();
  const evidenceIds = [...input.patch.evidenceIds];
  let evidenceId: string | null = null;

  if (input.patch.projectId) {
    evidenceId = crypto.randomUUID();
    const evidence = parseEvidenceRecord({
      id: evidenceId,
      ownerId: STUB_OWNER_ID,
      projectId: input.patch.projectId,
      source: `remediation-verify:${input.patch.id}`,
      sourceType: "SYSTEM",
      sourceId: input.patch.id,
      uri: null,
      excerpt: input.verify.summary,
      version: null,
      observedAt: now,
      createdAt: now,
      confidence: input.verify.ok ? 0.85 : 0.55,
      epistemicState: input.verify.ok ? "OBSERVED" : "CONFLICTED",
      classification: "INTERNAL",
      authorityRank: "REPOSITORY_CODE",
      category: "CODE",
      metadata: {
        patchId: input.patch.id,
        sourceIssueId: input.patch.sourceIssueId ?? null,
        ok: input.verify.ok,
        checks: input.verify.checks
          .map((c) => `${c.id}:${c.passed ? "pass" : "fail"}`)
          .join("; "),
        workspaceRoot: input.workspaceRoot,
      },
    });
    osStore.addEvidence(input.patch.projectId, [evidence]);
    evidenceIds.push(evidenceId);
  }

  const patch = patchArtifactSchema.parse({
    ...input.patch,
    status: input.verify.ok ? "VERIFIED" : input.patch.status,
    verifiedAt: input.verify.ok ? now : input.patch.verifiedAt,
    evidenceIds,
    updatedAt: now,
    evaluationSummary: [
      input.patch.evaluationSummary ?? "",
      input.verify.summary,
    ]
      .filter(Boolean)
      .join(" "),
    epistemicState: input.verify.ok ? "OBSERVED" : input.patch.epistemicState,
  });
  osStore.upsertPatch(patch);
  osStore.appendAudit({
    type: "code.patch.verified",
    patchId: patch.id,
    ok: input.verify.ok,
    sourceIssueId: patch.sourceIssueId ?? null,
    at: now,
    by: input.userId,
  });
  appendDomainEvent({
    type: "evaluation.completed",
    projectId: patch.projectId,
    epistemicState: input.verify.ok ? "OBSERVED" : "CONFLICTED",
    payload: {
      kind: "auto-remediation-verify",
      patchId: patch.id,
      sourceIssueId: patch.sourceIssueId ?? null,
      ok: input.verify.ok,
      evidenceId,
      checks: input.verify.checks,
    },
  });
  return patch;
}

export function applyApprovedPatch(input: {
  readonly existing: PatchArtifact;
  readonly user: AuthUser;
  readonly bodyWorkspaceRoot?: string | null | undefined;
  readonly requireProjectRoot?: boolean | undefined;
  /** When true, caller runs verify separately (auto-apply loop). */
  readonly skipVerify?: boolean | undefined;
}): {
  patch: PatchArtifact;
  apply: ReturnType<typeof applyPatchFiles>;
  verify: RemediationVerifyResult | null;
} {
  assertPatchApprovedForApply(input.existing);

  const workspaceRoot = resolveApplyWorkspaceRoot({
    projectId: input.existing.projectId,
    bodyWorkspaceRoot: input.bodyWorkspaceRoot ?? null,
    ...(input.requireProjectRoot !== undefined
      ? { requireProjectRoot: input.requireProjectRoot }
      : {}),
  });

  const now = new Date().toISOString();
  const result = applyPatchFiles(
    workspaceRoot,
    input.existing.filesChanged.map((f) => {
      const change: {
        path: string;
        action: "add" | "modify" | "delete";
        summary: string;
        afterContent?: string;
        unifiedDiff?: string;
      } = {
        path: f.path,
        action: f.action,
        summary: f.summary,
      };
      if (f.afterContent !== undefined) change.afterContent = f.afterContent;
      if (f.unifiedDiff !== undefined) change.unifiedDiff = f.unifiedDiff;
      return change;
    }),
  );

  const evidenceIds = [...input.existing.evidenceIds];
  let evidenceId: string | null = null;
  if (input.existing.projectId) {
    evidenceId = crypto.randomUUID();
    const evidence = parseEvidenceRecord({
      id: evidenceId,
      ownerId: STUB_OWNER_ID,
      projectId: input.existing.projectId,
      source: `patch:${input.existing.id}`,
      sourceType: "SYSTEM",
      sourceId: input.existing.id,
      uri: null,
      excerpt: `Applied patch ${input.existing.id} under ${workspaceRoot}: ${result.applied.join(", ") || "none"}`,
      version: null,
      observedAt: now,
      createdAt: now,
      confidence: 0.9,
      epistemicState: "OBSERVED",
      classification: "INTERNAL",
      authorityRank: "REPOSITORY_CODE",
      category: "CODE",
      metadata: {
        patchId: input.existing.id,
        sourceIssueId: input.existing.sourceIssueId ?? null,
        appliedCount: result.applied.length,
        workspaceRoot,
      },
    });
    osStore.addEvidence(input.existing.projectId, [evidence]);
    evidenceIds.push(evidenceId);
    appendDomainEvent({
      type: "evidence.recorded",
      projectId: input.existing.projectId,
      epistemicState: "OBSERVED",
      payload: {
        evidenceId,
        patchId: input.existing.id,
        sourceIssueId: input.existing.sourceIssueId ?? null,
      },
    });
  }

  let patch = patchArtifactSchema.parse({
    ...input.existing,
    status: "APPLIED",
    appliedAt: now,
    updatedAt: now,
    evidenceIds,
    rollbackRef: `local:${input.existing.id}`,
    rollbackSnapshot: result.rollbackSnapshot,
    evaluationSummary: [
      input.existing.evaluationSummary ?? "",
      `Applied ${result.applied.length} file(s) under ${workspaceRoot}. Skipped: ${result.skipped.join(", ") || "none"}.`,
    ]
      .filter(Boolean)
      .join(" "),
  });
  osStore.upsertPatch(patch);
  osStore.appendAudit({
    type: "code.patch.applied",
    patchId: input.existing.id,
    applied: result.applied,
    workspaceRoot,
    sourceIssueId: input.existing.sourceIssueId ?? null,
    at: now,
    by: input.user.id,
  });
  appendDomainEvent({
    type: "patch.applied",
    projectId: input.existing.projectId,
    epistemicState: "OBSERVED",
    payload: {
      patchId: input.existing.id,
      sourceIssueId: input.existing.sourceIssueId ?? null,
      applied: result.applied,
      skipped: result.skipped,
      workspaceRoot,
      evidenceId,
      autoRemediation: isAutoRemediationDraft(input.existing),
    },
  });
  atlasMetrics.record("patch_apply_rate", 1, {
    risk: input.existing.risk,
    autoRemediation: isAutoRemediationDraft(input.existing) ? "true" : "false",
  });

  let verify: RemediationVerifyResult | null = null;
  if (!input.skipVerify && isAutoRemediationDraft(input.existing)) {
    verify = verifyRemediationApply({
      workspaceRoot,
      patch,
      appliedPaths: result.applied,
    });
    patch = recordRemediationVerification({
      patch,
      workspaceRoot,
      verify,
      userId: input.user.id,
    });
  }

  return { patch, apply: result, verify };
}

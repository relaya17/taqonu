import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  AtlasError,
  memorySchema,
  parseEvidenceRecord,
  patchArtifactSchema,
  type AuthUser,
  type FindingRemediationVerdict,
  type PatchArtifact,
} from "@atlas/shared";
import { redactSecrets } from "@atlas/agent-core";
import type { MemoryStoreEnv } from "@atlas/database";
import {
  applyPatchFiles,
  verifyRemediationApply,
  type RemediationVerifyResult,
} from "@atlas/code-intelligence";
import { osStore } from "../store/os-store.js";
import { appendDomainEvent, commitMemory } from "./memory-pipeline.js";
import { learnFromVerifiedPatch } from "./bug-fix-learning.js";
import { atlasMetrics } from "../routes/metrics.js";
import { appendOracleAudit } from "./admin-oracle-digest.js";
import { computeArtifactHash } from "./governed-execution.js";
import { evaluateFindingRemediation } from "./patch-remediation-truth.js";

/**
 * Step 4 Decision A. Moved here (from `routes/code.ts`, which still
 * re-exports it via this same import) so `approvePatchArtifact` and
 * `code.ts`'s apply route bind the exact same hash for the same patch --
 * one definition, not two independently-maintained copies. Preimage
 * intentionally excludes everything but identity/content: title, reason,
 * risk, etc. can be edited without invalidating an already-decided
 * approval's artifact binding, matching the sibling rollback route's
 * existing use of this same function.
 */
export function patchArtifactHash(patch: PatchArtifact): string {
  return computeArtifactHash(
    JSON.stringify({
      id: patch.id,
      files: patch.filesChanged.map((file) => ({
        path: file.path,
        action: file.action,
        afterContent: file.afterContent ?? null,
      })),
    }),
  );
}

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

  // Step 4 regression fix: this used to also mint a live `ApprovalRequest`
  // here and immediately decide it with `decidedBy === requestedBy ===
  // input.userId` -- a self-approval, unconditionally forbidden by
  // `live-approval-requests.*`'s separation-of-duties check (see
  // supabase/migrations/20260905230000_atlas_universal_self_approval_
  // prevention.sql) for every approval request, not only Atlas's own.
  // There is no existing mechanism that lets this route's own PatchArtifact
  // sign-off (status/approvals[] below) honestly satisfy that invariant --
  // manufacturing one here was the bug, not a missing feature. Approving a
  // patch is, once again, exactly what it was before Step 4: a
  // PatchArtifact-local decision (status + approvals[]), nothing more. A
  // real `ApprovalRequest`/claim, decided by a different identity, is
  // obtained at apply time instead -- see `code.ts`'s apply route.
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
  appendOracleAudit({
    type: "remediation.approve",
    summary: `Approved patch ${existing.id}: ${existing.title}`,
    actor: input.userId,
    meta: {
      patchId: existing.id,
      sourceIssueId: existing.sourceIssueId ?? null,
      projectId: existing.projectId,
      risk: existing.risk,
    },
  });
  return patch;
}

export function recordRemediationVerification(input: {
  readonly patch: PatchArtifact;
  readonly workspaceRoot: string;
  readonly verify: RemediationVerifyResult;
  readonly userId: string;
  /** Distinguishes auto-remediation smoke verify from governed CODE_ENGINEER verify. */
  readonly kind?: "auto-remediation-verify" | "governed-patch-verify";
  readonly findingRemediation?: FindingRemediationVerdict;
}): PatchArtifact {
  const now = new Date().toISOString();
  const evidenceIds = [...input.patch.evidenceIds];
  let evidenceId: string | null = null;
  const combinedSummary = [
    `PATCH_VERIFY: ${input.verify.ok ? "PASS" : "FAIL"} — ${input.verify.summary}`,
    input.findingRemediation
      ? `REMEDIATION: ${input.findingRemediation.result} · FINDING: ${input.findingRemediation.findingPresence} — ${input.findingRemediation.summary}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  if (input.patch.projectId) {
    evidenceId = crypto.randomUUID();
    const evidence = parseEvidenceRecord({
      id: evidenceId,
      ownerId: input.userId,
      projectId: input.patch.projectId,
      source: `${input.kind === "governed-patch-verify" ? "governed-patch-verify" : "remediation-verify"}:${input.patch.id}`,
      sourceType: "SYSTEM",
      sourceId: input.patch.id,
      uri: null,
      excerpt: combinedSummary.slice(0, 8000),
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
        patchVerifyStatus: input.verify.ok ? "PASS" : "FAIL",
        remediationResult: input.findingRemediation?.result ?? null,
        findingPresence: input.findingRemediation?.findingPresence ?? null,
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
      combinedSummary,
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 4000),
    epistemicState: input.verify.ok ? "OBSERVED" : input.patch.epistemicState,
  });
  osStore.upsertPatch(patch);
  osStore.appendAudit({
    type: "code.patch.verified",
    patchId: patch.id,
    ok: input.verify.ok,
    patchVerifyStatus: input.verify.ok ? "PASS" : "FAIL",
    remediationResult: input.findingRemediation?.result ?? null,
    remediationVerifyStatus: input.findingRemediation?.verifyStatus ?? null,
    findingPresence: input.findingRemediation?.findingPresence ?? null,
    findingId: input.findingRemediation?.findingId ?? patch.remediationTarget?.findingId ?? null,
    sourceIssueId: patch.sourceIssueId ?? null,
    at: now,
    by: input.userId,
  });
  appendDomainEvent({
    type: "evaluation.completed",
    projectId: patch.projectId,
    ownerId: input.userId,
    epistemicState: input.verify.ok ? "OBSERVED" : "CONFLICTED",
    payload: {
      kind: input.kind ?? "auto-remediation-verify",
      patchId: patch.id,
      sourceIssueId: patch.sourceIssueId ?? null,
      ok: input.verify.ok,
      patchVerifyStatus: input.verify.ok ? "PASS" : "FAIL",
      remediationResult: input.findingRemediation?.result ?? null,
      findingPresence: input.findingRemediation?.findingPresence ?? null,
      evidenceId,
      checks: input.verify.checks,
    },
  });
  if (
    input.verify.ok &&
    patch.sourceIssueId &&
    (input.kind ?? "auto-remediation-verify") !== "governed-patch-verify"
  ) {
    learnFromVerifiedPatch({
      ownerId: input.userId,
      projectId: patch.projectId,
      bugId: patch.sourceIssueId,
      bugTitle: patch.title,
      bugDetail: patch.reason,
      patchId: patch.id,
      evidenceId,
      verifySummary: input.verify.summary,
      workspaceRoot: input.workspaceRoot,
    });
  }
  return patch;
}

/**
 * Disk/content checks for an already-applied CODE_ENGINEER governed patch.
 * Does not use AUTO_FIX/issue-marker heuristics — those belong to auto-remediation.
 */
export function verifyGovernedPatchApply(input: {
  readonly workspaceRoot: string;
  readonly patch: PatchArtifact;
}): RemediationVerifyResult {
  const root = resolve(input.workspaceRoot);
  const checks: Array<{ id: string; passed: boolean; detail: string }> = [];

  for (const file of input.patch.filesChanged) {
    const rel = file.path;
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
    if (file.action === "delete") {
      checks.push({
        id: `deleted:${rel}`,
        passed: !exists,
        detail: exists
          ? `Deleted path still present: ${rel}`
          : `Deleted path absent: ${rel}`,
      });
      continue;
    }
    checks.push({
      id: `exists:${rel}`,
      passed: exists,
      detail: exists
        ? `Applied file present: ${rel}`
        : `Missing after apply: ${rel}`,
    });
    if (exists && file.afterContent !== undefined) {
      try {
        const text = readFileSync(full, "utf8");
        const matched = text === file.afterContent;
        checks.push({
          id: `content:${rel}`,
          passed: matched,
          detail: matched
            ? `Applied content matches patch for ${rel}`
            : `Applied content does not match patch for ${rel}`,
        });
      } catch {
        checks.push({
          id: `content:${rel}`,
          passed: false,
          detail: `Could not read applied file ${rel}`,
        });
      }
    }
  }

  if (input.patch.filesChanged.length === 0) {
    checks.push({
      id: "applied-paths",
      passed: false,
      detail: "No applied paths to verify",
    });
  }

  const ok = checks.length > 0 && checks.every((c) => c.passed);
  const summary = ok
    ? `Verify PASS — ${checks.length} governed check(s) for patch ${input.patch.id}`
    : `Verify FAIL — ${checks.filter((c) => !c.passed).length}/${checks.length} check(s) failed for patch ${input.patch.id}`;
  return { ok, checks, summary };
}

export function verifyGovernedCodePatch(input: {
  readonly existing: PatchArtifact;
  readonly user: AuthUser;
  readonly bodyWorkspaceRoot?: string | null;
  readonly projectId?: string | null;
}): { patch: PatchArtifact; verify: RemediationVerifyResult; findingRemediation: FindingRemediationVerdict; patchVerifyStatus: "PASS" | "FAIL" } {
  if (isAutoRemediationDraft(input.existing)) {
    throw new AtlasError(
      "CONFLICT",
      "Auto-remediation drafts must be verified via /api/v1/remediation/drafts/:id/verify",
      { statusCode: 409 },
    );
  }
  if (
    input.projectId &&
    input.existing.projectId &&
    input.projectId !== input.existing.projectId
  ) {
    throw new AtlasError(
      "FORBIDDEN",
      "Patch does not belong to this project",
      { statusCode: 403 },
    );
  }
  if (input.existing.status !== "APPLIED" && input.existing.status !== "VERIFIED") {
    throw new AtlasError(
      "VALIDATION_ERROR",
      `Cannot verify patch in status ${input.existing.status} — apply first`,
      { statusCode: 400 },
    );
  }

  const workspaceRoot = resolveApplyWorkspaceRoot({
    projectId: input.existing.projectId,
    bodyWorkspaceRoot: input.bodyWorkspaceRoot ?? null,
    requireProjectRoot: Boolean(input.existing.projectId),
  });
  const verify = verifyGovernedPatchApply({
    workspaceRoot,
    patch: input.existing,
  });
  const findingRemediation = evaluateFindingRemediation({
    workspaceRoot,
    executionOk: verify.ok,
    ...(input.existing.remediationTarget
      ? { target: input.existing.remediationTarget }
      : {}),
  });
  const patch = recordRemediationVerification({
    patch: input.existing,
    workspaceRoot,
    verify,
    userId: input.user.id,
    kind: "governed-patch-verify",
    findingRemediation,
  });
  return {
    patch,
    verify,
    findingRemediation,
    patchVerifyStatus: verify.ok ? "PASS" : "FAIL",
  };
}

function recordGovernedPatchApplyMemory(input: {
  readonly patch: PatchArtifact;
  readonly user: AuthUser;
  readonly applied: readonly string[];
  readonly env?: MemoryStoreEnv | null;
}): void {
  if (isAutoRemediationDraft(input.patch)) return;
  if (!input.patch.projectId) return;
  if (input.applied.length === 0) return;

  const now = new Date().toISOString();
  const files = input.applied.join(", ");
  const statement = redactSecrets(
    `Applied governed patch ${input.patch.id} (${input.patch.title}): ${files}.`,
  ).slice(0, 4000);
  const memory = memorySchema.parse({
    id: crypto.randomUUID(),
    ownerId: input.user.id,
    type: "PROJECT_STATE",
    projectId: input.patch.projectId,
    statement,
    reason: ["code-patch-applied", `patchId:${input.patch.id}`],
    status: "ACTIVE",
    confidence: 0.85,
    category: "EVENT_MEMORY",
    epistemicState: "OBSERVED",
    observationMode: "OBSERVED",
    source: "code.patch.apply",
    sourceType: "SYSTEM",
    sourceId: input.patch.id,
    evidence: [],
    supersededBy: null,
    validFrom: now,
    validUntil: null,
    observedAt: now,
    createdAt: now,
    updatedAt: now,
    createdBy: input.user.email,
    agentId: "CODE_ENGINEER",
    scope: "PROJECT",
    priority: "MEDIUM",
  });
  void commitMemory({ memory, env: input.env ?? null });
  appendDomainEvent({
    type: "memory.created",
    projectId: input.patch.projectId,
    ownerId: input.user.id,
    epistemicState: "OBSERVED",
    payload: {
      memoryId: memory.id,
      kind: "code-patch-applied",
      patchId: input.patch.id,
      applied: input.applied,
    },
  });
}

export function applyApprovedPatch(input: {
  readonly existing: PatchArtifact;
  readonly user: AuthUser;
  readonly bodyWorkspaceRoot?: string | null | undefined;
  readonly requireProjectRoot?: boolean | undefined;
  /** When true, caller runs verify separately (auto-apply loop). */
  readonly skipVerify?: boolean | undefined;
  readonly env?: MemoryStoreEnv | null;
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
      ownerId: input.user.id,
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
      ownerId: input.user.id,
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
    ownerId: input.user.id,
    epistemicState: "OBSERVED",
    payload: {
      patchId: input.existing.id,
      sourceIssueId: input.existing.sourceIssueId ?? null,
      applied: result.applied,
      skipped: result.skipped,
      workspaceRoot,
      evidenceId,
      autoRemediation: isAutoRemediationDraft(input.existing),
      // The human actor who triggered this apply — `applyApprovedPatch`
      // always receives an authenticated `AuthUser` from its caller (see
      // apps/api/src/routes/code.ts's requireSignedInForWrite/
      // assertPatchWrite, apps/api/src/routes/remediation.ts, and
      // apps/api/src/services/remediation-pipeline.ts's auto-apply loop,
      // which still carries the human whose WRITE session enabled
      // auto-apply). Threaded through `payload.actorId` — DomainEvent's
      // payload is freeform (see domain-event.schema.ts) — rather than a
      // new field on DomainEvent itself, so
      // apps/api/src/services/event-rules.ts's onPatchApplied can attribute
      // the resulting unified audit entry to a real actor instead of a
      // hardcoded null.
      actorId: input.user.id,
    },
  });
  atlasMetrics.record("patch_apply_rate", 1, {
    risk: input.existing.risk,
    autoRemediation: isAutoRemediationDraft(input.existing) ? "true" : "false",
  });
  recordGovernedPatchApplyMemory({
    patch,
    user: input.user,
    applied: result.applied,
    env: input.env ?? null,
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

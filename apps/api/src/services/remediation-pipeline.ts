/**
 * Closed remediation loop orchestration (detect drafts → optional LOW auto-apply → verify).
 * Reuses approve/apply WRITE gates — never bypasses them for HIGH/CRITICAL.
 */
import {
  draftAutoRemediations,
  draftTruthFindingRemediation,
  isAutoApplyEligiblePatch,
  verifyRemediationApply,
  type AutoRemediationDraft,
  type RemediationVerifyResult,
  type TruthFindingProposeInput,
  type TruthRemediationDraft,
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
import { executeObserveCycle } from "./observe-cycle.js";
import { appendOracleAudit } from "./admin-oracle-digest.js";
import { projectHasProductionTarget } from "./observe-system-facets.js";
import { getManagedSystem } from "./managed-systems.js";

/** Auto-apply never hits production unless ATLAS_ALLOW_PROD_AUTO_APPLY=true. */
export function productionAutoApplyBlocked(input: {
  projectId: string | null;
  allowProd: boolean;
}): { blocked: boolean; reason?: string } {
  if (input.allowProd) return { blocked: false };
  if (process.env.NODE_ENV === "production") {
    return {
      blocked: true,
      reason:
        "Auto-apply is blocked in production (set ATLAS_ALLOW_PROD_AUTO_APPLY=true to override)",
    };
  }
  if (input.projectId && projectHasProductionTarget(input.projectId)) {
    return {
      blocked: true,
      reason:
        "Auto-apply blocked: project has a production deploy target — human approval required",
    };
  }
  return { blocked: false };
}

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
  /** When set, re-run Observer and require finding id cleared (Truth verify engine). */
  readonly reobserveFindingId?: string | null;
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
  let verify = verifyRemediationApply({
    workspaceRoot,
    patch: input.patch,
    ...(input.appliedPaths ? { appliedPaths: input.appliedPaths } : {}),
  });

  const findingKey =
    input.reobserveFindingId?.trim() ||
    (input.patch.title.startsWith("TRUTH_FIX:")
      ? input.patch.sourceIssueId
      : null);

  if (findingKey && input.patch.projectId) {
    try {
      const observed = executeObserveCycle({
        body: {
          projectId: input.patch.projectId,
          workspaceRoot,
          persist: true,
          trigger: "remediation_verify",
        },
      });
      const stillPresent = observed.findings.some(
        (f) =>
          f.id === findingKey ||
          f.id.includes(findingKey) ||
          (input.patch.sourceIssueId
            ? f.id.includes(input.patch.sourceIssueId)
            : false),
      );
      const checks = [
        ...verify.checks,
        {
          id: "reobserve-finding-cleared",
          passed: !stillPresent,
          detail: stillPresent
            ? `Re-observe still reports finding related to ${findingKey} (cycle ${observed.id})`
            : `Re-observe cleared finding ${findingKey} (cycle ${observed.id})`,
        },
      ];
      const ok = checks.every((c) => c.passed);
      verify = {
        ok,
        checks,
        summary: ok
          ? `Verify PASS — smoke + re-observe cycle ${observed.id}`
          : `Verify FAIL — ${checks.filter((c) => !c.passed).length} check(s) failed (cycle ${observed.id})`,
      };
    } catch (err) {
      const detail =
        err instanceof Error ? err.message : "re-observe failed";
      const checks = [
        ...verify.checks,
        {
          id: "reobserve-finding-cleared",
          passed: false,
          detail: `Re-observe unavailable: ${detail}`,
        },
      ];
      verify = {
        ok: false,
        checks,
        summary: `Verify FAIL — re-observe error for patch ${input.patch.id}`,
      };
    }
  }

  const patch = recordRemediationVerification({
    patch: input.patch,
    workspaceRoot,
    verify,
    userId: input.userId,
  });
  try {
    appendOracleAudit({
      type: "remediation.verify",
      summary: verify.summary,
      actor: input.userId,
      meta: {
        patchId: patch.id,
        ok: verify.ok,
        findingId: findingKey ?? null,
        projectId: patch.projectId,
      },
    });
  } catch {
    /* audit best-effort */
  }
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
    if (d.patch.projectId) {
      const system = getManagedSystem(d.patch.projectId);
      if (system?.posture === "BLOCKED") {
        outcomes.push({
          patchId: d.patch.id,
          issueId: d.issueId,
          status: "skipped",
          reason:
            "Auto-apply blocked: system posture is BLOCKED — human ACT required",
        });
        continue;
      }
    }
    const prodGate = productionAutoApplyBlocked({
      projectId: d.patch.projectId,
      allowProd: process.env.ATLAS_ALLOW_PROD_AUTO_APPLY === "true",
    });
    if (prodGate.blocked) {
      const skipped: AutoApplyOutcome = {
        patchId: d.patch.id,
        issueId: d.issueId,
        status: "skipped",
        ...(prodGate.reason ? { reason: prodGate.reason } : {}),
      };
      outcomes.push(skipped);
      continue;
    }
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

/** TRUTH-10 · 1.1 — propose→approve→apply→verify entry from Truth findings. */
export function proposeTruthFindingRemediation(input: {
  readonly projectId: string;
  readonly finding: TruthFindingProposeInput;
  readonly envGoldenRoot?: string | null;
}): TruthRemediationDraft {
  const linked = osStore.getWorkspaceRoot(input.projectId);
  if (!linked) {
    throw new AtlasError(
      "VALIDATION_ERROR",
      "Link a local workspaceRoot on this project before proposing Truth remediations",
      { statusCode: 400 },
    );
  }
  const draft = draftTruthFindingRemediation({
    projectId: input.projectId,
    workspaceRoot: linked,
    finding: input.finding,
    existingSourceIssueIds: openRemediationSourceIssueIds(input.projectId),
  });
  if (!draft) {
    throw new AtlasError(
      "CONFLICT",
      "A remediation draft already exists for this Truth finding",
      { statusCode: 409 },
    );
  }
  osStore.upsertPatch(draft.patch);
  appendDomainEvent({
    type: "patch.proposed",
    projectId: draft.patch.projectId,
    epistemicState: "PROPOSED",
    payload: {
      kind: "truth-remediation",
      patchId: draft.patch.id,
      findingId: draft.findingId,
      risk: draft.patch.risk,
      applyBlocked: draft.applyBlocked,
      title: draft.patch.title,
    },
  });
  return draft;
}

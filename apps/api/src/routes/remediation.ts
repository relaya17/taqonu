import type { FastifyInstance } from "fastify";
import {
  AtlasError,
  applyPatchSchema,
  approvePatchSchema,
  uuidSchema,
} from "@atlas/shared";
import { firstActiveKillSwitch } from "@atlas/agent-core";
import { z } from "zod";
import { osStore } from "../store/os-store.js";
import { requireSignedInForWrite } from "../middleware/auth-guards.js";
import { assertProjectWriteAccess } from "../services/project-access.js";
import { enforceEntityWrite } from "../services/risk-audit.js";
import { appendUnifiedAuditEntry } from "../services/audit-log.js";
import {
  approvePatchArtifact,
  applyApprovedPatch,
  assertPatchApprovedForApply,
  isAutoRemediationDraft,
} from "../services/patch-write.js";
import {
  autoApplyLowRemediations,
  proposeTruthFindingRemediation,
  shouldAutoApplyLow,
  verifyAppliedRemediation,
} from "../services/remediation-pipeline.js";
import { isAutoApplyEligiblePatch } from "@atlas/code-intelligence";

/**
 * F-03 remediation (P3 governance-boundary audit): `/drafts/:id/apply` and
 * `/auto-apply-low` used to call `authorizeEntityAction` directly, which
 * bypassed `firstActiveKillSwitch` (the operator emergency stop every other
 * governed write path checks), the canonical Unified Audit Log entry for
 * the *authorization decision* itself (only the execution outcome was ever
 * audited, via `patch-write.ts`'s `osStore.appendAudit` + domain event),
 * and the numeric risk-engine scoring `enforceEntityWrite` also provides.
 *
 * This restores that coverage using only existing, proven primitives — no
 * new governance abstraction:
 *  - `firstActiveKillSwitch()` is the exact function `dispatchAgentAction`
 *    (`agent-dispatch-guard.ts`) checks first, before any policy/risk
 *    evaluation. Called with no extra categories, it still always checks
 *    the `"agentDispatch"` master switch (see `kill-switches.ts`'s own
 *    doc comment on `firstActiveKillSwitch`).
 *  - `enforceEntityWrite` (`risk-audit.ts`) is the correct helper for this
 *    actor shape — not `dispatchAgentAction`, which is built for AGENT/
 *    AUTOMATION actors whose approval comes from a claimed `ApprovalRequest`
 *    record. Both remediation routes are signed-in-human-initiated writes
 *    (`requireSignedInForWrite`) whose approval signal is the caller's own
 *    prior action (`assertPatchApprovedForApply`'s check that a human
 *    already approved this exact patch via `/approve`, or the `enabled
 *    flag for auto-apply-low) — exactly `enforceEntityWrite`'s documented
 *    "self-approved write" contract, and exactly what `approved: true` /
 *    `approved: enabled` already meant at both removed call sites (by the
 *    time `/auto-apply-low` reaches this point, `enabled` is always `true`
 *    — the route already threw 403 above otherwise — so `enforceEntityWrite`
 *    hardcoding `approved: true` internally changes nothing observable).
 *
 * Kill-switch denials are audited here in the same DENIED shape
 * `enforceEntityWrite` itself uses for a policy denial, so both failure
 * modes land in the canonical hash-chained log with a consistent shape.
 */
function assertRemediationNotKillSwitched(input: {
  readonly entityType: "DOCUMENT";
  readonly action: "EXECUTE";
  readonly routeLabel: string;
  readonly actorId: string;
  readonly projectId: string | null;
  readonly input: Record<string, unknown>;
}): void {
  const killSwitch = firstActiveKillSwitch();
  if (killSwitch === null) return;
  const reason = `Kill switch "${killSwitch.category}" is active -- agent/automation dispatch is denied`;
  appendUnifiedAuditEntry({
    type: input.routeLabel,
    actorId: input.actorId,
    actorKind: "USER",
    reason,
    input: input.input,
    output: { killSwitchCategory: killSwitch.category },
    policy: `${input.entityType}.${input.action}`,
    risk: "CRITICAL",
    approval: "REJECTED",
    result: "FAILURE",
    projectId: input.projectId,
    ownerId: input.actorId,
  });
  throw new AtlasError("FORBIDDEN", reason, { statusCode: 403 });
}

/**
 * Approval-gated AUTO_FIX remediation path — reuses the patch pipeline.
 * Never applies without prior Approve + explicit project workspaceRoot
 * (unless LOW auto-apply under ATLAS_AUTO_APPLY_LOW / explicit flag + WRITE).
 */
export async function registerRemediationRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/api/v1/remediation/drafts", async (request) => {
    const q = z
      .object({
        projectId: uuidSchema.optional(),
        status: z.string().max(40).optional(),
      })
      .parse(request.query ?? {});
    let items = osStore
      .listPatches(q.projectId)
      .filter(isAutoRemediationDraft);
    if (q.status) {
      items = items.filter((p) => p.status === q.status);
    }
    return {
      items,
      page: 1,
      pageSize: items.length,
      total: items.length,
      note: "AUTO_FIX drafts — Approve then Apply (or LOW auto-apply when gated). WRITE stays gated.",
      autoApplyLowEnv: Boolean(app.atlasEnv.ATLAS_AUTO_APPLY_LOW),
    };
  });

  app.get("/api/v1/remediation/drafts/:id", async (request, reply) => {
    const id = z.object({ id: uuidSchema }).parse(request.params).id;
    const patch = osStore.getPatch(id);
    if (!patch || !isAutoRemediationDraft(patch)) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: "Remediation draft not found" },
      });
    }
    return patch;
  });

  app.post(
    "/api/v1/remediation/drafts/:id/approve",
    async (request, reply) => {
      const user = await requireSignedInForWrite(app, request);
      const id = z.object({ id: uuidSchema }).parse(request.params).id;
      const body = approvePatchSchema.parse(request.body ?? {});
      const existing = osStore.getPatch(id);
      if (!existing || !isAutoRemediationDraft(existing)) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Remediation draft not found" },
        });
      }
      return approvePatchArtifact(existing, {
        approvedBy: body.approvedBy?.trim() || user.email,
        ...(body.note !== undefined ? { note: body.note } : {}),
        userId: user.id,
      });
    },
  );

  app.post("/api/v1/remediation/drafts/:id/apply", async (request, reply) => {
    const user = await requireSignedInForWrite(app, request);
    const id = z.object({ id: uuidSchema }).parse(request.params).id;
    const body = applyPatchSchema.parse(request.body ?? {});
    const existing = osStore.getPatch(id);
    if (!existing || !isAutoRemediationDraft(existing)) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: "Remediation draft not found" },
      });
    }
    if (existing.risk === "HIGH" || existing.risk === "CRITICAL") {
      throw new AtlasError(
        "FORBIDDEN",
        "AUTO_FIX apply path is limited to LOW/MEDIUM drafts",
        { statusCode: 403 },
      );
    }

    // ENTITY-LEVEL gate, independent of the WRITE-role check above:
    // `assertPatchApprovedForApply` is the same pre-existing "a human
    // already approved this exact patch" signal used by
    // `apps/api/src/routes/code.ts`'s `/code/patches/:id/apply`, so
    // `approved: true` reflects a real, already-established sign-off
    // rather than being manufactured here. Safe/idempotent to call before
    // `applyApprovedPatch` also calls it internally.
    assertPatchApprovedForApply(existing);
    assertRemediationNotKillSwitched({
      entityType: "DOCUMENT",
      action: "EXECUTE",
      routeLabel: "remediation.drafts.apply",
      actorId: user.id,
      projectId: existing.projectId,
      input: { patchId: existing.id },
    });
    enforceEntityWrite({
      entityType: "DOCUMENT",
      action: "EXECUTE",
      routeLabel: "remediation.drafts.apply",
      actorId: user.id,
      projectId: existing.projectId,
      input: { patchId: existing.id },
    });

    return applyApprovedPatch({
      existing,
      user,
      bodyWorkspaceRoot: body.workspaceRoot ?? null,
      requireProjectRoot: true,
    });
  });

  app.post("/api/v1/remediation/drafts/:id/verify", async (request, reply) => {
    const user = await requireSignedInForWrite(app, request);
    const id = z.object({ id: uuidSchema }).parse(request.params).id;
    const body = z
      .object({ workspaceRoot: z.string().min(1).max(1000).optional() })
      .parse(request.body ?? {});
    const existing = osStore.getPatch(id);
    if (!existing || !isAutoRemediationDraft(existing)) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: "Remediation draft not found" },
      });
    }
    return verifyAppliedRemediation({
      patch: existing,
      workspaceRoot: body.workspaceRoot ?? null,
      userId: user.id,
    });
  });

  app.post("/api/v1/remediation/from-truth", async (request, reply) => {
    const body = z
      .object({
        projectId: uuidSchema,
        finding: z.object({
          id: z.string().min(1).max(200),
          title: z.string().min(1).max(300),
          detail: z.string().max(8000).default(""),
          riskBand: z.string().min(1).max(40),
          claim: z.string().max(80).optional(),
          epistemicState: z.string().max(80).optional(),
          evidenceRefs: z.array(z.string().max(500)).max(40).optional(),
          category: z.string().max(80).optional(),
        }),
      })
      .parse(request.body ?? {});
    await assertProjectWriteAccess(app, request, body.projectId);
    const draft = proposeTruthFindingRemediation({
      projectId: body.projectId,
      finding: {
        id: body.finding.id,
        title: body.finding.title,
        detail: body.finding.detail,
        riskBand: body.finding.riskBand,
        ...(body.finding.claim !== undefined ? { claim: body.finding.claim } : {}),
        ...(body.finding.epistemicState !== undefined
          ? { epistemicState: body.finding.epistemicState }
          : {}),
        ...(body.finding.evidenceRefs !== undefined
          ? { evidenceRefs: body.finding.evidenceRefs }
          : {}),
        ...(body.finding.category !== undefined
          ? { category: body.finding.category }
          : {}),
      },
    });
    return reply.status(201).send({
      draft,
      note: draft.applyBlocked
        ? "HIGH/CRITICAL recommendation only — apply stays blocked"
        : "Draft ready — Approve then Apply (or LOW gated auto-apply)",
      next: "/patches",
    });
  });

  /**
   * Explicit LOW auto-apply for queued drafts (requires WRITE + flag/env).
   * HIGH/CRITICAL never included.
   */
  app.post("/api/v1/remediation/auto-apply-low", async (request, reply) => {
    const user = await requireSignedInForWrite(app, request);
    const body = z
      .object({
        projectId: uuidSchema.nullable().optional(),
        workspaceRoot: z.string().min(1).max(1000).optional(),
        patchIds: z.array(uuidSchema).max(20).optional(),
        force: z.boolean().optional(),
      })
      .parse(request.body ?? {});

    const enabled = shouldAutoApplyLow({
      envFlag: Boolean(app.atlasEnv.ATLAS_AUTO_APPLY_LOW),
      requestFlag: Boolean(body.force),
      user,
    });
    if (!enabled) {
      throw new AtlasError(
        "FORBIDDEN",
        "LOW auto-apply requires ATLAS_AUTO_APPLY_LOW=true or body.force=true plus WRITE session",
        { statusCode: 403 },
      );
    }

    // ENTITY-LEVEL gate: `enabled` above is exactly the "a human already
    // established explicit authorization for LOW auto-apply" signal
    // (ATLAS_AUTO_APPLY_LOW env flag or an explicit body.force + WRITE
    // session) -- auto-apply is irreversible and agent-triggered, exactly
    // what the entity-policy layer exists to gate. `enabled` is always
    // `true` by this point (the route already threw 403 above otherwise),
    // exactly matching `enforceEntityWrite`'s hardcoded `approved: true`
    // "self-approved write" contract -- see `assertRemediationNotKillSwitched`'s
    // doc comment above for why this, not `dispatchAgentAction`, is correct.
    assertRemediationNotKillSwitched({
      entityType: "DOCUMENT",
      action: "EXECUTE",
      routeLabel: "remediation.auto-apply-low",
      actorId: user.id,
      projectId: body.projectId ?? null,
      input: {
        projectId: body.projectId ?? null,
        force: Boolean(body.force),
        patchIds: body.patchIds ?? null,
      },
    });
    enforceEntityWrite({
      entityType: "DOCUMENT",
      action: "EXECUTE",
      routeLabel: "remediation.auto-apply-low",
      actorId: user.id,
      projectId: body.projectId ?? null,
      input: {
        projectId: body.projectId ?? null,
        force: Boolean(body.force),
        patchIds: body.patchIds ?? null,
      },
    });

    let patches = osStore
      .listPatches(body.projectId ?? undefined)
      .filter(isAutoRemediationDraft)
      .filter(isAutoApplyEligiblePatch)
      .filter(
        (p) =>
          p.status === "AWAITING_APPROVAL" ||
          p.status === "PROPOSED" ||
          p.status === "DRAFT" ||
          p.status === "EVALUATED",
      );

    if (body.patchIds?.length) {
      const allow = new Set(body.patchIds);
      patches = patches.filter((p) => allow.has(p.id));
    }

    const drafts = patches.map((patch) => ({
      issueId: patch.sourceIssueId ?? patch.id,
      title: patch.title,
      remediationPolicy: "AUTO_FIX",
      severity: "LOW" as const,
      patch,
      note: "Queued LOW auto-apply",
      autoApplyEligible: true,
    }));

    const outcomes = autoApplyLowRemediations({
      drafts,
      user,
      bodyWorkspaceRoot: body.workspaceRoot ?? null,
    });

    return reply.status(200).send({
      applied: outcomes.filter((o) => o.status === "applied").length,
      skipped: outcomes.filter((o) => o.status === "skipped").length,
      failed: outcomes.filter((o) => o.status === "failed").length,
      outcomes,
    });
  });
}

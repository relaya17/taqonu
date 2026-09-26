import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  AtlasError,
  applyPatchSchema,
  approvePatchSchema,
  isControlPlaneRole,
  uuidSchema,
  type AuthUser,
  type PatchArtifact,
} from "@atlas/shared";
import { z } from "zod";
import { osStore } from "../store/os-store.js";
import { firstActiveEffectiveKillSwitch } from "../services/kill-switch-runtime.js";
import { requireSignedInForWrite, requireUser } from "../middleware/auth-guards.js";
import {
  assertEntityReadAccess,
  assertProjectWriteAccess,
  canReadProjectScoped,
  getProjectOwnerId,
} from "../services/project-access.js";
import { governedPatchApply } from "../services/patch-governance.js";
import { enforceEntityWrite } from "../services/risk-audit.js";
import { appendUnifiedAuditEntry } from "../services/audit-log.js";
import {
  approvePatchArtifact,
  assertPatchApprovedForApply,
  isAutoRemediationDraft,
} from "../services/patch-write.js";

/**
 * Stage 5 (G-1): every remediation draft route uses the same project scope
 * as the governed Studio patch routes (`/code/patches/*`). A draft in another
 * owner's project is reported as not found, so its existence is not
 * revealed.
 */
async function loadDraftForRead(
  app: FastifyInstance,
  request: FastifyRequest,
  id: string,
): Promise<{ draft: PatchArtifact; user: AuthUser } | null> {
  const user = await requireUser(app, request);
  const draft = osStore.getPatch(id);
  if (!draft || !isAutoRemediationDraft(draft)) return null;
  if (!canReadProjectScoped(user, draft.projectId)) return null;
  await assertEntityReadAccess(app, request, draft.projectId);
  return { draft, user };
}

async function loadDraftForWrite(
  app: FastifyInstance,
  request: FastifyRequest,
  id: string,
): Promise<{ draft: PatchArtifact; user: AuthUser } | null> {
  const signedIn = await requireSignedInForWrite(app, request);
  const draft = osStore.getPatch(id);
  if (!draft || !isAutoRemediationDraft(draft)) return null;
  if (!canReadProjectScoped(signedIn, draft.projectId)) return null;
  const user = draft.projectId
    ? await assertProjectWriteAccess(app, request, draft.projectId)
    : signedIn;
  return { draft, user };
}

function draftNotFound(reply: { status: (code: number) => { send: (body: unknown) => unknown } }) {
  return reply.status(404).send({
    error: { code: "NOT_FOUND", message: "Remediation draft not found" },
  });
}

/** Drafts the caller may write: own projects, unowned projects, or any as a Control Plane role. */
function canWriteDraftProject(user: AuthUser, projectId: string | null): boolean {
  if (!projectId) return isControlPlaneRole(user.role);
  if (user.role === "admin" || isControlPlaneRole(user.role)) return true;
  const owner = getProjectOwnerId(projectId);
  return owner === user.id;
}
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
  // Resolved against the EFFECTIVE state (env baseline UNION durable
  // runtime override -- Task 7), same seam `agent-dispatch-guard.ts` uses.
  const killSwitch = firstActiveEffectiveKillSwitch();
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
    const user = await requireUser(app, request);
    const q = z
      .object({
        projectId: uuidSchema.optional(),
        status: z.string().max(40).optional(),
      })
      .parse(request.query ?? {});
    if (q.projectId) {
      await assertEntityReadAccess(app, request, q.projectId);
    }
    let items = osStore
      .listPatches(q.projectId)
      .filter(isAutoRemediationDraft)
      .filter((p) => canReadProjectScoped(user, p.projectId));
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
    const loaded = await loadDraftForRead(app, request, id);
    if (!loaded) return draftNotFound(reply);
    return loaded.draft;
  });

  app.post(
    "/api/v1/remediation/drafts/:id/approve",
    async (request, reply) => {
      const id = z.object({ id: uuidSchema }).parse(request.params).id;
      const body = approvePatchSchema.parse(request.body ?? {});
      const loaded = await loadDraftForWrite(app, request, id);
      if (!loaded) return draftNotFound(reply);
      // Stage 5 (G-7): approver identity comes from the session only.
      return approvePatchArtifact(loaded.draft, {
        approvedBy: loaded.user.email,
        ...(body.note !== undefined ? { note: body.note } : {}),
        userId: loaded.user.id,
      });
    },
  );

  /**
   * Stage 5 (G-1/G-2/SoD): a remediation draft applies through the same
   * governed Apply as a Studio patch (`governedPatchApply`): 202 with a live
   * approval request first, then `?approvalId=` once a different identity
   * decided it. The route keeps its own draft-only checks (LOW/MEDIUM only,
   * kill switch, entity policy).
   */
  app.post("/api/v1/remediation/drafts/:id/apply", async (request, reply) => {
    const id = z.object({ id: uuidSchema }).parse(request.params).id;
    const body = applyPatchSchema.parse(request.body ?? {});
    const query = z
      .object({ approvalId: z.string().uuid().optional() })
      .parse(request.query ?? {});
    const loaded = await loadDraftForWrite(app, request, id);
    if (!loaded) return draftNotFound(reply);
    const { draft: existing, user } = loaded;
    if (existing.risk === "HIGH" || existing.risk === "CRITICAL") {
      throw new AtlasError(
        "FORBIDDEN",
        "AUTO_FIX apply path is limited to LOW/MEDIUM drafts",
        { statusCode: 403 },
      );
    }
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
    if (!existing.projectId) {
      throw new AtlasError(
        "VALIDATION_ERROR",
        "AUTO_FIX apply requires a patch with projectId and an explicit workspaceRoot",
        { statusCode: 400 },
      );
    }
    return governedPatchApply({
      reply,
      existing,
      user,
      requestId: request.id,
      bodyWorkspaceRoot: body.workspaceRoot ?? null,
      approvalId: query.approvalId ?? null,
      env: app.atlasEnv,
      routeLabel: "remediation.drafts.apply.gate",
    });
  });

  app.post("/api/v1/remediation/drafts/:id/verify", async (request, reply) => {
    const id = z.object({ id: uuidSchema }).parse(request.params).id;
    const body = z
      .object({ workspaceRoot: z.string().min(1).max(1000).optional() })
      .parse(request.body ?? {});
    const loaded = await loadDraftForWrite(app, request, id);
    if (!loaded) return draftNotFound(reply);
    return verifyAppliedRemediation({
      patch: loaded.draft,
      workspaceRoot: body.workspaceRoot ?? null,
      userId: loaded.user.id,
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

    if (body.projectId) {
      await assertProjectWriteAccess(app, request, body.projectId);
    }
    // Stage 5 (G-1): only drafts in projects the caller may write.
    let patches = osStore
      .listPatches(body.projectId ?? undefined)
      .filter(isAutoRemediationDraft)
      .filter((p) => canWriteDraftProject(user, p.projectId))
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
      env: app.atlasEnv,
    });

    return reply.status(200).send({
      applied: outcomes.filter((o) => o.status === "applied").length,
      skipped: outcomes.filter((o) => o.status === "skipped").length,
      failed: outcomes.filter((o) => o.status === "failed").length,
      outcomes,
    });
  });
}

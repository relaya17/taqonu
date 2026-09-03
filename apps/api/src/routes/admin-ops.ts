import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  AtlasError,
  PLATFORM_CODENAME,
  PLATFORM_NAME,
  PLATFORM_VERSION,
  STORAGE_POLICY_VERSION,
} from "@atlas/shared";
import { z } from "zod";
import { requireOperator } from "../middleware/auth-guards.js";
import { resolveCloudIdentity } from "../services/cloud-identity.js";
import { resolveOwnerId, resolveTier } from "../services/plan-quota.js";
import {
  runPlatformWatchdog,
  type WatchdogReport,
} from "../services/platform-watchdog.js";
import { createApprovalRequest } from "../services/approvals.js";
import {
  runGovernedClaimedExecution,
  type GovernedExecuteOnceResult,
  type HelperResult,
} from "../services/governed-claimed-execution.js";
import { runLiveHumanDecisionExecution } from "../services/live-human-execution.js";
import { buildAdminOracleShell } from "../services/admin-oracle.js";
import { buildOracleActionQueue } from "../services/admin-oracle-queue.js";
import {
  appendOracleAudit,
  buildOracleMorningDigest,
  listOracleAudit,
} from "../services/admin-oracle-digest.js";
import { osStore } from "../store/os-store.js";

/**
 * Shared by both the approval-token-replay route and the live-human
 * decide-and-execute route below -- the underlying automation action being
 * gated is identical; only how the approval authority was established
 * differs.
 */
function buildWatchdogExecuteOnce(
  app: FastifyInstance,
  request: FastifyRequest,
): () => Promise<GovernedExecuteOnceResult<{
  ok: true;
  report: WatchdogReport;
  message: string;
}>> {
  return async () => {
    const identity = await resolveCloudIdentity(app, request);
    const ownerId = resolveOwnerId(app.atlasEnv, identity.ownerId);
    const { tier } = resolveTier(app.atlasEnv, ownerId);
    const report: WatchdogReport = runPlatformWatchdog({ tier, ownerId });

    osStore.recordEvent({
      type: "admin.watchdog.completed",
      score: report.score,
      alertCount: report.alertCount,
      criticalCount: report.criticalCount,
      at: report.generatedAt,
    });

    const value = {
      ok: true as const,
      report,
      message:
        report.criticalCount > 0
          ? "Watchdog found critical issues — remediate before they become user-facing failures."
          : report.highCount > 0
            ? "Watchdog found high-priority risks — review remediation steps."
            : "Watchdog clean — no critical/high alerts.",
    };
    return {
      kind: "SUCCESS" as const,
      value,
      outputEvidence: JSON.stringify({
        score: report.score,
        alertCount: report.alertCount,
        criticalCount: report.criticalCount,
      }),
    };
  };
}

/** Shared HelperResult -> HTTP response mapping for both run-checks routes. */
function respondToWatchdogHelperResult(
  reply: FastifyReply,
  helper: HelperResult<{ ok: true; report: WatchdogReport; message: string }>,
): unknown {
  if (helper.status === "EXECUTED") {
    // Terminal FULFILLED replay has no gate. Do not report a second
    // success and do not run the watchdog again.
    if (helper.gate === undefined) {
      throw new AtlasError(
        "FORBIDDEN",
        helper.approval
          ? `Approval request ${helper.approval.id} is already finalized`
          : "approval already finalized",
        { statusCode: 403 },
      );
    }
    return helper.value;
  }

  if (helper.status === "APPROVAL_REQUIRED") {
    return reply.status(202).send({
      status: "APPROVAL_REQUIRED" as const,
      approvalId: helper.approvalRequestId,
      message:
        "Submit POST /api/v1/approvals/:id/decide to approve, then retry this " +
        `request with ?approvalId=${helper.approvalRequestId}.`,
    });
  }

  const reason = "reason" in helper ? helper.reason : "governed execution failed";
  if (helper.status === "DENIED" && /not found/i.test(helper.reason)) {
    throw new AtlasError("NOT_FOUND", helper.reason, { statusCode: 404 });
  }
  if (helper.status === "OUTCOME_UNKNOWN" || helper.status === "FINALIZE_INCOMPLETE") {
    throw new AtlasError("CONFLICT", reason, { statusCode: 409 });
  }
  throw new AtlasError("FORBIDDEN", reason, { statusCode: 403 });
}

export async function registerAdminOpsRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/api/v1/admin/command-center", async (request) => {
    await requireOperator(app, request);
    const identity = await resolveCloudIdentity(app, request);
    const ownerId = resolveOwnerId(app.atlasEnv, identity.ownerId);
    const { tier } = resolveTier(app.atlasEnv, ownerId);
    const watchdog = runPlatformWatchdog({ tier, ownerId });
    const oracle = buildAdminOracleShell({ locale: "he" });
    const queue = buildOracleActionQueue(watchdog);
    const { digest } = buildOracleMorningDigest({ queue });

    return {
      platform: {
        name: PLATFORM_NAME,
        codename: PLATFORM_CODENAME,
        version: PLATFORM_VERSION,
        storagePolicyVersion: STORAGE_POLICY_VERSION,
      },
      tier,
      watchdog,
      oracle,
      queue,
      digest,
      generatedAt: watchdog.generatedAt,
    };
  });

  app.get("/api/v1/admin/oracle", async (request) => {
    await requireOperator(app, request);
    const identity = await resolveCloudIdentity(app, request);
    const ownerId = resolveOwnerId(app.atlasEnv, identity.ownerId);
    const { tier } = resolveTier(app.atlasEnv, ownerId);
    const watchdog = runPlatformWatchdog({ tier, ownerId });
    const oracle = buildAdminOracleShell({ locale: "he" });
    const queue = buildOracleActionQueue(watchdog);
    const { digest, versions, cyber } = buildOracleMorningDigest({ queue });
    return {
      oracle: {
        ...oracle,
        dailyBrief: digest.brief,
      },
      queue,
      digest,
      versions,
      cyber,
      audit: listOracleAudit(20),
      watchdogScore: watchdog.score,
      generatedAt: new Date().toISOString(),
      note: "TRUTH-10 A1 — queue + versions + defensive advisories + digest + audit.",
    };
  });

  app.get("/api/v1/admin/oracle/digest", async (request) => {
    await requireOperator(app, request);
    const identity = await resolveCloudIdentity(app, request);
    const ownerId = resolveOwnerId(app.atlasEnv, identity.ownerId);
    const { tier } = resolveTier(app.atlasEnv, ownerId);
    const watchdog = runPlatformWatchdog({ tier, ownerId });
    const queue = buildOracleActionQueue(watchdog);
    const { digest, versions, cyber } = buildOracleMorningDigest({ queue });
    return { digest, versions, cyber, generatedAt: new Date().toISOString() };
  });

  app.get("/api/v1/admin/oracle/audit", async (request) => {
    await requireOperator(app, request);
    return {
      items: listOracleAudit(50),
      total: listOracleAudit(50).length,
      note: "Oracle automation audit trail — who refreshed / what was ranked.",
    };
  });

  app.post("/api/v1/admin/oracle/refresh-queue", async (request) => {
    await requireOperator(app, request);
    const identity = await resolveCloudIdentity(app, request);
    const ownerId = resolveOwnerId(app.atlasEnv, identity.ownerId);
    const { tier } = resolveTier(app.atlasEnv, ownerId);
    const watchdog = runPlatformWatchdog({ tier, ownerId });
    const queue = buildOracleActionQueue(watchdog);
    const { digest } = buildOracleMorningDigest({ queue });
    appendOracleAudit({
      type: "oracle.queue.refresh",
      summary: `Ranked ${queue.total} actions · digest top3=${digest.top3.length}`,
      actor: identity.ownerId || "admin",
      meta: {
        total: queue.total,
        critical: queue.counts.critical,
        high: queue.counts.high,
      },
    });
    osStore.recordEvent({
      type: "admin.oracle.queue.refresh",
      total: queue.total,
      critical: queue.counts.critical,
      high: queue.counts.high,
      at: queue.generatedAt,
    });
    return {
      ok: true as const,
      queue,
      digest,
      watchdogScore: watchdog.score,
      message:
        queue.counts.critical > 0
          ? "Critical actions in queue — investigate before users hit failures."
          : queue.total === 0
            ? "Queue empty — Oracle has nothing urgent."
            : `Ranked ${queue.total} action(s) · morning digest ready.`,
    };
  });

  app.post("/api/v1/admin/automation/run-checks", async (request, reply) => {
    const user = await requireOperator(app, request);

    // SECOND, INDEPENDENT authorization axis: `requireOperator` above only
    // proves the caller holds the admin *role* — it says nothing about
    // whether this particular *class* of action (triggering platform-wide
    // automation checks/remediation) has been approved. Role authority and
    // action risk are orthogonal in this design, so execution is routed
    // through the same claim-based governed-execution gate `code.ts` uses
    // (`runGovernedClaimedExecution` -> `dispatchAgentAction` ->
    // `authorizeEntityAction`), not a hand-rolled consume + hardcoded
    // `approved: true`. `CONFIGURATION.EXECUTE` is the highest-risk tier in
    // `DEFAULT_ENTITY_POLICIES` (`DESTRUCTIVE`, `requiresApproval: true`),
    // matching "apply/execute a control-plane automation action" — an admin
    // is not automatically entitled to trigger irreversible/high-blast-
    // radius automation without a trace.
    //
    // The approval workflow lives in `../services/approvals.js` +
    // `./approvals.js` (`POST /api/v1/approvals/:id/decide`):
    //   1. No `?approvalId=` given -> we create a PENDING approval request
    //      (a distinct, auditable record of who requested what and why)
    //      and respond 202 with the approval id instead of throwing. This
    //      is a route-level UX shortcut only — it does not authorize
    //      execution by itself.
    //   2. Caller (or another admin) decides it via
    //      `POST /api/v1/approvals/:id/decide`.
    //   3. Caller retries this endpoint with `?approvalId=<id>`. The real
    //      authority check happens inside `runGovernedClaimedExecution`: it
    //      claims the APPROVED record (failing closed on any mismatch or
    //      non-APPROVED status), re-derives `approved` from that claimed
    //      record — never from a caller-supplied boolean — and re-runs the
    //      Policy/Risk gate before executing. One approval authorizes
    //      exactly one execution; a claimed/finalized record cannot be
    //      replayed into a second one.
    //
    // IMPORTANT: step 3 above can never actually succeed for this route.
    // CONFIGURATION.EXECUTE is DESTRUCTIVE tier, which always resolves to
    // the HUMAN_ONLY risk bucket, and `dispatchAgentAction` never lets a
    // claimed AGENT-actor token satisfy HUMAN_ONLY (approval-token
    // replay is exactly what HUMAN_ONLY forbids). Retrying with
    // `?approvalId=` after a normal `/decide` will reliably return 202
    // APPROVAL_REQUIRED again and burn the claim as FAILED. The only path
    // that can execute this action is
    // `POST .../run-checks/decide-and-execute` below, which supplies a
    // live human decision instead of a replayed token.
    const query = z
      .object({ approvalId: z.string().uuid().optional() })
      .parse(request.query ?? {});

    if (!query.approvalId) {
      const approval = await createApprovalRequest({
        entityType: "CONFIGURATION",
        action: "EXECUTE",
        requestedBy: user.id,
        reason: "run platform automation checks",
        context: { route: "admin.automation.run-checks" },
      });
      return reply.status(202).send({
        status: "APPROVAL_REQUIRED" as const,
        approvalId: approval.id,
        message:
          "Submit POST /api/v1/approvals/:id/decide to approve, then retry this " +
          `request with ?approvalId=${approval.id}.`,
      });
    }

    const helper = await runGovernedClaimedExecution({
      executorId: user.id,
      actor: {
        kind: "AGENT",
        agentId: user.id,
        onBehalfOfUserId: user.id,
      },
      entityType: "CONFIGURATION",
      action: "EXECUTE",
      approvalRequestId: query.approvalId,
      requestId: request.id,
      sourceContext: { origin: "user_message", trustLevel: "trusted" },
      routeLabel: "admin.automation.run-checks",
      dispatchInput: { route: "admin.automation.run-checks" },
      executeOnce: buildWatchdogExecuteOnce(app, request),
    });

    return respondToWatchdogHelperResult(reply, helper);
  });

  // CP7.1/CP7.2 -- the HUMAN_ONLY live-human decision path. CONFIGURATION.
  // EXECUTE is DESTRUCTIVE tier, which (with the conservative default
  // confidence/evidence this route supplies none of) always lands in the
  // HUMAN_ONLY risk bucket. `dispatchAgentAction` never lets a claimed
  // AGENT-actor token satisfy HUMAN_ONLY -- see agent-dispatch-guard.ts --
  // so the `?approvalId=` retry above can create and hold an approval, but
  // can never actually execute this action; that is deliberate, not a bug.
  // This endpoint is the only path that can: it atomically decides-and-
  // claims the PENDING approval as a live, separately-authenticated human
  // (`claim_live_approval_request_as_live_human` -- no intermediate
  // APPROVED token is ever produced), enforcing separation of duties
  // (the human deciding here cannot be the identity that originally
  // requested the approval) at the database layer, then runs the exact
  // same Policy/Risk re-check and watchdog execution as the token-replay
  // route above.
  app.post(
    "/api/v1/admin/automation/run-checks/decide-and-execute",
    async (request, reply) => {
      const user = await requireOperator(app, request);

      const body = z
        .object({
          approvalId: z.string().uuid(),
          decisionReason: z.string().min(1).max(2000),
        })
        .parse(request.body ?? {});

      const helper = await runLiveHumanDecisionExecution({
        approvalId: body.approvalId,
        deciderId: user.id,
        decisionReason: body.decisionReason,
        entityType: "CONFIGURATION",
        action: "EXECUTE",
        requestId: request.id,
        sourceContext: { origin: "user_message", trustLevel: "trusted" },
        routeLabel: "admin.automation.run-checks.decide-and-execute",
        dispatchInput: { route: "admin.automation.run-checks" },
        executeOnce: buildWatchdogExecuteOnce(app, request),
      });

      return respondToWatchdogHelperResult(reply, helper);
    },
  );

  app.get("/api/v1/admin/knowledge-graph", async (request) => {
    await requireOperator(app, request);
    const identity = await resolveCloudIdentity(app, request);
    const ownerId = resolveOwnerId(app.atlasEnv, identity.ownerId);
    const { tier } = resolveTier(app.atlasEnv, ownerId);
    const report = runPlatformWatchdog({ tier, ownerId });
    return {
      summary: report.knowledge,
      platformVersion: report.platformVersion,
      generatedAt: report.generatedAt,
      note: "Operational knowledge graph rollup from Evidence / Claims / Memory / Decisions — not a substitute for full graph upserts.",
    };
  });
}

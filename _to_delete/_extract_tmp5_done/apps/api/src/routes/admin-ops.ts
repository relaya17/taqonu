import type { FastifyInstance } from "fastify";
import {
  AtlasError,
  PLATFORM_CODENAME,
  PLATFORM_NAME,
  PLATFORM_VERSION,
  STORAGE_POLICY_VERSION,
} from "@atlas/shared";
import { authorizeEntityAction } from "@atlas/agent-core";
import { z } from "zod";
import { requireAdmin } from "../middleware/auth-guards.js";
import { resolveCloudIdentity } from "../services/cloud-identity.js";
import { resolveOwnerId, resolveTier } from "../services/plan-quota.js";
import {
  runPlatformWatchdog,
  type WatchdogReport,
} from "../services/platform-watchdog.js";
import {
  consumeApprovalRequest,
  createApprovalRequest,
  getApprovalRequest,
} from "../services/approvals.js";
import { buildAdminOracleShell } from "../services/admin-oracle.js";
import { buildOracleActionQueue } from "../services/admin-oracle-queue.js";
import {
  appendOracleAudit,
  buildOracleMorningDigest,
  listOracleAudit,
} from "../services/admin-oracle-digest.js";
import { osStore } from "../store/os-store.js";

export async function registerAdminOpsRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/api/v1/admin/command-center", async (request) => {
    requireAdmin(app, request);
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
    requireAdmin(app, request);
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
    requireAdmin(app, request);
    const identity = await resolveCloudIdentity(app, request);
    const ownerId = resolveOwnerId(app.atlasEnv, identity.ownerId);
    const { tier } = resolveTier(app.atlasEnv, ownerId);
    const watchdog = runPlatformWatchdog({ tier, ownerId });
    const queue = buildOracleActionQueue(watchdog);
    const { digest, versions, cyber } = buildOracleMorningDigest({ queue });
    return { digest, versions, cyber, generatedAt: new Date().toISOString() };
  });

  app.get("/api/v1/admin/oracle/audit", async (request) => {
    requireAdmin(app, request);
    return {
      items: listOracleAudit(50),
      total: listOracleAudit(50).length,
      note: "Oracle automation audit trail — who refreshed / what was ranked.",
    };
  });

  app.post("/api/v1/admin/oracle/refresh-queue", async (request) => {
    requireAdmin(app, request);
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
    const user = requireAdmin(app, request);

    // SECOND, INDEPENDENT authorization axis: `requireAdmin` above only
    // proves the caller holds the admin *role* — it says nothing about
    // whether this particular *class* of action (triggering platform-wide
    // automation checks/remediation) has been approved. Role authority and
    // action risk are orthogonal in this design, so we additionally run the
    // entity-centric policy check. `CONFIGURATION.EXECUTE` is the highest-
    // risk tier in `DEFAULT_ENTITY_POLICIES` (`DESTRUCTIVE`,
    // `requiresApproval: true`), matching "apply/execute a control-plane
    // automation action" — an admin is not automatically entitled to
    // trigger irreversible/high-blast-radius automation without a trace.
    //
    // The approval workflow lives in `../services/approvals.js` +
    // `./approvals.js` (`POST /api/v1/approvals/:id/decide`):
    //   1. No `?approvalId=` given -> we create a PENDING approval request
    //      (a distinct, auditable record of who requested what and why)
    //      and respond 202 with the approval id instead of throwing.
    //   2. Caller (or another admin) decides it via
    //      `POST /api/v1/approvals/:id/decide`.
    //   3. Caller retries this endpoint with `?approvalId=<id>` — if it's
    //      APPROVED we consume it (one approval authorizes exactly one
    //      execution) and pass `approved: true` into the same
    //      `authorizeEntityAction` check below, so the entity-policy check
    //      is still genuinely exercised on the execution path, not bypassed.
    const query = z
      .object({ approvalId: z.string().uuid().optional() })
      .parse(request.query ?? {});

    if (!query.approvalId) {
      const approval = createApprovalRequest({
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

    const approval = getApprovalRequest(query.approvalId);
    if (!approval) {
      throw new AtlasError(
        "NOT_FOUND",
        `Approval request ${query.approvalId} not found`,
        { statusCode: 404 },
      );
    }
    if (approval.status !== "APPROVED") {
      throw new AtlasError(
        "FORBIDDEN",
        `Approval request ${query.approvalId} is not APPROVED (status=${approval.status}) — ` +
          "it must be approved via POST /api/v1/approvals/:id/decide before this action can run.",
        { statusCode: 403, details: { approvalId: query.approvalId, status: approval.status } },
      );
    }
    consumeApprovalRequest(query.approvalId);

    const entityAuthz = authorizeEntityAction("CONFIGURATION", "EXECUTE", {
      mode: "WRITE",
      writeGateOpen: true,
      approved: true,
    });
    if (entityAuthz.decision !== "ALLOWED") {
      const reason =
        entityAuthz.decision === "DENIED"
          ? entityAuthz.reason
          : "admin.automation.run-checks (CONFIGURATION.EXECUTE) was not ALLOWED even with an approved approval request.";
      throw new AtlasError("FORBIDDEN", reason, { statusCode: 403 });
    }

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

    return {
      ok: true as const,
      report,
      message:
        report.criticalCount > 0
          ? "Watchdog found critical issues — remediate before they become user-facing failures."
          : report.highCount > 0
            ? "Watchdog found high-priority risks — review remediation steps."
            : "Watchdog clean — no critical/high alerts.",
    };
  });

  app.get("/api/v1/admin/knowledge-graph", async (request) => {
    requireAdmin(app, request);
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

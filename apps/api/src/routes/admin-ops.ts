import type { FastifyInstance } from "fastify";
import {
  PLATFORM_CODENAME,
  PLATFORM_NAME,
  PLATFORM_VERSION,
  STORAGE_POLICY_VERSION,
} from "@atlas/shared";
import { requireAdmin } from "../middleware/auth-guards.js";
import { resolveCloudIdentity } from "../services/cloud-identity.js";
import { resolveOwnerId, resolveTier } from "../services/plan-quota.js";
import {
  runPlatformWatchdog,
  type WatchdogReport,
} from "../services/platform-watchdog.js";
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

    return {
      platform: {
        name: PLATFORM_NAME,
        codename: PLATFORM_CODENAME,
        version: PLATFORM_VERSION,
        storagePolicyVersion: STORAGE_POLICY_VERSION,
      },
      tier,
      watchdog,
      generatedAt: watchdog.generatedAt,
    };
  });

  app.post("/api/v1/admin/automation/run-checks", async (request) => {
    requireAdmin(app, request);
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

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { KILL_SWITCH_CATEGORIES } from "@atlas/agent-core";
import { AtlasError, KILL_SWITCH_CONTROL_PATH } from "@atlas/shared";
import { requireControlPlaneService } from "../services/governed-lifecycle-handoff.js";
import { osStore } from "../store/os-store.js";
import { getKillSwitchStatus } from "../services/kill-switch-runtime.js";

/**
 * Task 7 -- Runtime Kill Switch Control API.
 *
 * Same Control-Plane-service-authenticated write-surface contract as
 * `agent-runtime-controls.ts` (`requireControlPlaneService` -- the only
 * write-capable boundary reachable from `apps/control-plane`, which has no
 * browser session and therefore cannot use `requireOperator`). This is NOT
 * a new or weaker auth path: it is the exact precedent already used by 5
 * other route files (`agent-runtime-controls.ts`, `approvals.ts`,
 * `audit.ts`, `gateway-fulfill.ts`, `governed-lifecycle-handoff.ts`).
 *
 * Enforcement never reads this route or its store field directly --
 * `agent-dispatch-guard.ts` / `remediation.ts` call
 * `effectiveKillSwitchEnv()` (`kill-switch-runtime.ts`), which reads
 * `osStore.getKillSwitchOverrides()` itself. This route exists purely so
 * Control (and any other operator surface) can read/mutate that same
 * durable state instead of Control ever touching `osStore` directly.
 *
 * GET  /api/v1/internal/kill-switches        -> full per-category status
 * POST /api/v1/internal/kill-switches        -> activate or clear a runtime override
 */
const postBodySchema = z.object({
  category: z.enum(KILL_SWITCH_CATEGORIES),
  action: z.enum(["activate", "deactivate"]),
  setBy: z.string().min(1).max(200),
  reason: z.string().min(1).max(2000),
});

export async function registerKillSwitchRoutes(app: FastifyInstance): Promise<void> {
  app.get(KILL_SWITCH_CONTROL_PATH, async (request) => {
    requireControlPlaneService(request.headers.authorization);
    return {
      categories: KILL_SWITCH_CATEGORIES,
      status: getKillSwitchStatus(),
    };
  });

  app.post(KILL_SWITCH_CONTROL_PATH, async (request) => {
    const actorId = requireControlPlaneService(request.headers.authorization);
    const parsed = postBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw new AtlasError("VALIDATION_ERROR", "Malformed kill switch control request", {
        statusCode: 400,
      });
    }
    const { category, action, reason } = parsed.data;
    // Body `setBy` is accepted for wire compatibility with Control Plane
    // (which still forwards its session principal) but MUST NOT become the
    // durable actor. The authenticated hop is `cp:service`.
    void parsed.data.setBy;
    if (action === "activate") {
      const override = osStore.setKillSwitchOverride(category, actorId, reason);
      return { category, override };
    }
    const result = osStore.clearKillSwitchOverride(category, actorId, reason);
    return { category, cleared: result.cleared };
  });
}

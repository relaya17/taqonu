import type { FastifyInstance } from "fastify";
import { EXECUTION_CONTROL_PATH } from "@atlas/shared";
import { requireControlPlaneService } from "../services/governed-lifecycle-handoff.js";
import { osStore } from "../store/os-store.js";

export const EXECUTION_VISIBILITY = [
  "active",
  "completed",
  "failed",
  "blocked",
  "paused",
] as const;
export type ExecutionVisibility = (typeof EXECUTION_VISIBILITY)[number];

export function visibilityForAgentRunStatus(status: string): ExecutionVisibility {
  if (status === "QUEUED" || status === "RUNNING") return "active";
  if (status === "SUCCEEDED") return "completed";
  if (status === "FAILED") return "failed";
  if (status === "AWAITING_APPROVAL") return "blocked";
  if (status === "CANCELLED") return "paused";
  return "blocked";
}

/**
 * CP SERVICE → canonical agent-run store.
 * Control never reads `osStore` itself; this is the existing hop boundary.
 */
export async function registerExecutionControlRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(EXECUTION_CONTROL_PATH, async (request) => {
    requireControlPlaneService(request.headers.authorization);
    osStore.ensureLoaded();
    const items = osStore.listAgentRuns().map((run) => ({
      id: run.id,
      projectId: run.projectId,
      mode: run.mode,
      status: run.status,
      visibility: visibilityForAgentRunStatus(run.status),
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      createdBy: run.createdBy,
      userRequest: run.userRequest.slice(0, 200),
    }));
    return { items, total: items.length };
  });
}

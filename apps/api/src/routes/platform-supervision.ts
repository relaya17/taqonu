import type { FastifyInstance } from "fastify";
import {
  ATLAS_PLATFORM_HIERARCHY,
  ATLAS_SURFACE_ROLES,
  type PlatformSupervisionSnapshot,
} from "@atlas/shared";
import { requireOperator } from "../middleware/auth-guards.js";
import { osStore } from "../store/os-store.js";

/**
 * Studio supervision contract for Atlas Admin.
 * Owner/operator only. Customer `admin` is rejected by requireOperator.
 */
export function buildStudioSupervisionSnapshot(
  origin: string,
): PlatformSupervisionSnapshot {
  const projects = osStore.listProjects();
  let linkedWorkspaces = 0;
  for (const project of projects) {
    if (osStore.getWorkspaceRoot(project.id)) linkedWorkspaces += 1;
  }

  return {
    surface: "STUDIO",
    parentSurface: "ADMIN",
    role: ATLAS_SURFACE_ROLES.STUDIO,
    runtime: ATLAS_PLATFORM_HIERARCHY.STUDIO.runtime,
    origin,
    reachability: "CONFIGURED",
    health: "unknown",
    generatedAt: new Date().toISOString(),
    metrics: {
      projects: projects.length,
      linkedWorkspaces,
    },
    notes: [
      "Developer workspace at /[locale]/studio. Not Atlas Admin. Not Control.",
      "Counts are tenant-API store totals. A linked folder is not a Control connector.",
    ],
  };
}

export async function registerPlatformSupervisionRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/api/v1/platform/studio-supervision", async (request) => {
    await requireOperator(app, request);
    const webOrigin = (process.env["WEB_ORIGIN"] ?? ATLAS_PLATFORM_HIERARCHY.STUDIO.defaultOrigin)
      .replace(/\/$/, "");
    return buildStudioSupervisionSnapshot(webOrigin);
  });
}

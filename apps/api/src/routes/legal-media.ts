import type { FastifyInstance } from "fastify";
import { runLegalMediaReview } from "@atlas/code-intelligence";
import {
  VERIFIED_LEGAL_MEDIA_SOURCES,
  legalSourcesByRegion,
  uuidSchema,
} from "@atlas/shared";
import { z } from "zod";
import { osStore } from "../store/os-store.js";
import { assertProjectReadAccess } from "../services/project-access.js";
import { requireUser } from "../middleware/auth-guards.js";
import { enforceEntityWrite } from "../services/risk-audit.js";

export async function registerLegalMediaRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/api/v1/legal-media/sources", async () => ({
    note: "Allow-listed government / university / official bodies only. Not legal advice.",
    items: VERIFIED_LEGAL_MEDIA_SOURCES,
    byRegion: legalSourcesByRegion(),
  }));

  app.post("/api/v1/legal-media/review", async (request) => {
    const body = z
      .object({
        projectId: uuidSchema.nullable().optional(),
      })
      .parse(request.body ?? {});

    // SECURITY FIX (found while widening Policy Engine coverage): this
    // route had ZERO auth — when a projectId was given it revealed the
    // project's local workspace root path and ran a real code review
    // against it, leaking findings to any caller who knew the project id.
    // Now always requires sign-in (closing the "no projectId → fully
    // public, no auth at all" gap too) and is gated with the entity-policy
    // / Risk Engine / audit-log path, matching qa.process-audit's
    // `RECORD.EXECUTE` classification for the same "run a real review,
    // persist findings" shape.
    const projectId = body.projectId ?? null;
    const user = projectId
      ? await assertProjectReadAccess(app, request, projectId)
      : await requireUser(app, request);
    enforceEntityWrite({
      entityType: "RECORD",
      action: "EXECUTE",
      routeLabel: "legal-media.review",
      actorId: user.id,
      projectId,
    });
    const workspaceRoot = projectId
      ? (osStore.getWorkspaceRoot(projectId) ?? null)
      : null;

    const review = runLegalMediaReview({
      projectId,
      workspaceRoot,
    });

    app.atlasLogger.info("legal_media_review", {
      projectId,
      lawyerReadiness: review.lawyerReadiness,
      findings: review.findings.length,
    });

    return review;
  });
}

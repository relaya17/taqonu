import type { FastifyInstance } from "fastify";
import { runLegalMediaReview } from "@atlas/code-intelligence";
import {
  VERIFIED_LEGAL_MEDIA_SOURCES,
  uuidSchema,
} from "@atlas/shared";
import { z } from "zod";
import { osStore } from "../store/os-store.js";

export async function registerLegalMediaRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/api/v1/legal-media/sources", async () => ({
    note: "Allow-listed government / university / official bodies only. Not legal advice.",
    items: VERIFIED_LEGAL_MEDIA_SOURCES,
  }));

  app.post("/api/v1/legal-media/review", async (request) => {
    const body = z
      .object({
        projectId: uuidSchema.nullable().optional(),
      })
      .parse(request.body ?? {});

    const projectId = body.projectId ?? null;
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

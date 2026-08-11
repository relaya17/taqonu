import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { researchResultSchema } from "@atlas/shared";

export async function registerResearchRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/research", async (request) => {
    const body = z
      .object({
        question: z.string().min(1).max(4000),
      })
      .parse(request.body);

    return researchResultSchema.parse({
      question: body.question,
      answer:
        "Verified research engine is scaffolded. Phase 6 will retrieve official sources, score freshness, detect conflicts, and attach citations. This response is PROPOSED scaffolding, not VERIFIED_WEB_KNOWLEDGE.",
      citations: [],
      conflicts: [],
      epistemicState: "UNKNOWN",
    });
  });
}

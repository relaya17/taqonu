import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  VERIFIED_LEGAL_MEDIA_SOURCES,
  researchResultSchema,
} from "@atlas/shared";

/**
 * Research against allow-listed official sources only.
 * Never invents citations; empty match → INSUFFICIENT_EVIDENCE.
 */
export async function registerResearchRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/research", async (request) => {
    const body = z
      .object({
        question: z.string().min(1).max(4000),
      })
      .parse(request.body);

    const q = body.question.toLowerCase();
    const hits = VERIFIED_LEGAL_MEDIA_SOURCES.filter((s) => {
      const hay = `${s.titleEn} ${s.titleHe} ${s.topics.join(" ")} ${s.region}`.toLowerCase();
      return (
        s.topics.some((t) => q.includes(t.toLowerCase())) ||
        q.split(/\s+/).some((w) => w.length > 3 && hay.includes(w))
      );
    }).slice(0, 6);

    if (hits.length === 0) {
      return researchResultSchema.parse({
        question: body.question,
        answer:
          "INSUFFICIENT_EVIDENCE — no allow-listed government/university source matched. Atlas will not invent citations. Try privacy, media, broadcast, GDPR, or communications.",
        citations: [],
        conflicts: [],
        epistemicState: "INSUFFICIENT_EVIDENCE",
      });
    }

    const now = new Date().toISOString();
    return researchResultSchema.parse({
      question: body.question,
      answer: `Matched ${hits.length} verified official source(s). These are starting points for human counsel/research — not legal advice and not scraped page content.`,
      citations: hits.map((s) => ({
        claim: `${s.titleEn} (${s.region}) — topics: ${s.topics.join(", ")}`,
        source: s.url,
        sourceType:
          s.kind === "UNIVERSITY"
            ? ("ACADEMIC" as const)
            : s.kind === "TREATY_OR_OFFICIAL_BODY"
              ? ("STANDARDS_BODY" as const)
              : ("GOVERNMENT" as const),
        authorityLevel: "TIER_1" as const,
        retrievedAt: now,
        excerpt: s.titleHe,
        confidence: 0.7,
        epistemicState: "INFERRED" as const,
      })),
      conflicts: [],
      epistemicState: "INFERRED",
    });
  });
}

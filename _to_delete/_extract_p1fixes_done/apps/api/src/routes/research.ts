import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  VERIFIED_LEGAL_MEDIA_SOURCES,
  researchResultSchema,
  type AuthorityTier,
  type EpistemicState,
  type LegalSourceKind,
} from "@atlas/shared";

/**
 * Deterministic per-citation trust scoring for /api/v1/research.
 *
 * This route never scrapes the underlying source page — it only matches an
 * allow-listed catalog (`VERIFIED_LEGAL_MEDIA_SOURCES`) against the question
 * text, and every `excerpt` below is the source's own catalog title, never a
 * verified quoted passage. That means two signals a "full" scoring model
 * would use are NOT honestly available on this path, and are deliberately
 * left out rather than faked:
 *   - Recency: `VerifiedLegalMediaSource` carries no per-source timestamp
 *     (no `lastChecked`/`publishedAt`); stamping `retrievedAt: now()` onto
 *     the citation records when Atlas ran the match, not when the source was
 *     last updated, so it is not a real recency signal and isn't used as one.
 *   - Direct quote vs. summary: there is no scraped excerpt to grade — the
 *     absence of one is itself the signal (see the epistemicState ceiling
 *     below).
 *
 * What IS honestly available per result, and is used:
 *   1. Source-kind authority (`kind`): TREATY_OR_OFFICIAL_BODY (primary
 *      legal/regulatory text itself, e.g. the GDPR regulation) outranks
 *      GOVERNMENT (an official regulator/ministry — authoritative but
 *      administrative, not primary text) which outranks UNIVERSITY (a
 *      reputable secondary/academic source, not primary law). This mirrors
 *      the same "primary source > official body > secondary" ordering as
 *      `authorityTierSchema` (packages/shared/src/schemas/knowledge-source.schema.ts),
 *      applied to the three `LegalSourceKind`s this route actually has.
 *   2. Match precision: whether the question matched one of the source's own
 *      curated `topics` verbatim (precise) vs. only via the looser >3-char
 *      substring fallback the route already used to decide inclusion
 *      (noisier). A precise topic match is stronger evidence the source is
 *      actually on point for the question asked.
 *
 * Formula (fully deterministic — same inputs always produce the same
 * output, no randomness, no per-call LLM judgment):
 *   confidence = KIND_BASE_CONFIDENCE[kind] - (preciseTopicMatch ? 0 : 0.1)
 *   KIND_BASE_CONFIDENCE: TREATY_OR_OFFICIAL_BODY = 0.9, GOVERNMENT = 0.8,
 *     UNIVERSITY = 0.65
 *   (clamped into [0, 1] by confidenceSchema on parse; the table above never
 *   leaves that range, so the clamp is just a belt-and-suspenders guard.)
 *
 * epistemicState ladder — mirrors the *spirit* of
 * capEpistemicStateForSource/EPISTEMIC_TRUST_RANK in
 * packages/shared/src/schemas/memory.schema.ts: never claim a higher
 * epistemic tier than the source justifies. Because nothing on this path is
 * page-content-verified (no scraped quote — see above), the ceiling is
 * OBSERVED; this route can never emit CONFIRMED, VERIFIED, or FACT, no
 * matter how authoritative the matched source is:
 *   confidence >= 0.85 -> OBSERVED  (primary official text + precise match)
 *   confidence >= 0.7  -> INFERRED  (solid official source, but admin body
 *                                    and/or only a loose topic match)
 *   confidence <  0.7  -> ASSUMED   (secondary/academic source with only a
 *                                    loose topic match)
 *
 * authorityLevel reuses the same `kind` signal (see `authorityTierSchema`):
 * TREATY_OR_OFFICIAL_BODY / GOVERNMENT -> TIER_1 (both are official primary
 * sources for their domain), UNIVERSITY -> TIER_2 (reputable but secondary).
 */
const KIND_BASE_CONFIDENCE: Record<LegalSourceKind, number> = {
  TREATY_OR_OFFICIAL_BODY: 0.9,
  GOVERNMENT: 0.8,
  UNIVERSITY: 0.65,
};

const KIND_AUTHORITY_LEVEL: Record<LegalSourceKind, AuthorityTier> = {
  TREATY_OR_OFFICIAL_BODY: "TIER_1",
  GOVERNMENT: "TIER_1",
  UNIVERSITY: "TIER_2",
};

export function scoreCitationConfidence(
  kind: LegalSourceKind,
  preciseTopicMatch: boolean,
): number {
  const base = KIND_BASE_CONFIDENCE[kind];
  const confidence = preciseTopicMatch ? base : base - 0.1;
  return Math.min(1, Math.max(0, confidence));
}

export function epistemicStateForConfidence(confidence: number): EpistemicState {
  if (confidence >= 0.85) return "OBSERVED";
  if (confidence >= 0.7) return "INFERRED";
  return "ASSUMED";
}

/** Local rank for the three states this route can emit — lowest wins when
 * aggregating an overall answer-level epistemicState from per-citation
 * states, so the headline claim is never stronger than its weakest citation. */
const CITATION_EPISTEMIC_RANK: Record<"OBSERVED" | "INFERRED" | "ASSUMED", number> = {
  ASSUMED: 1,
  INFERRED: 2,
  OBSERVED: 3,
};

function weakestEpistemicState(
  states: readonly EpistemicState[],
): "OBSERVED" | "INFERRED" | "ASSUMED" {
  return states.reduce<"OBSERVED" | "INFERRED" | "ASSUMED">((weakest, s) => {
    const state = s as "OBSERVED" | "INFERRED" | "ASSUMED";
    return CITATION_EPISTEMIC_RANK[state] < CITATION_EPISTEMIC_RANK[weakest] ? state : weakest;
  }, states[0] as "OBSERVED" | "INFERRED" | "ASSUMED");
}

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
    const hits = VERIFIED_LEGAL_MEDIA_SOURCES.map((s) => {
      const hay = `${s.titleEn} ${s.titleHe} ${s.topics.join(" ")} ${s.region}`.toLowerCase();
      const preciseTopicMatch = s.topics.some((t) => q.includes(t.toLowerCase()));
      const looseMatch = q.split(/\s+/).some((w) => w.length > 3 && hay.includes(w));
      return { source: s, preciseTopicMatch, matched: preciseTopicMatch || looseMatch };
    })
      .filter((r) => r.matched)
      .slice(0, 6);

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
    const citations = hits.map(({ source: s, preciseTopicMatch }) => {
      const confidence = scoreCitationConfidence(s.kind, preciseTopicMatch);
      const epistemicState = epistemicStateForConfidence(confidence);
      return {
        claim: `${s.titleEn} (${s.region}) — topics: ${s.topics.join(", ")}`,
        source: s.url,
        sourceType:
          s.kind === "UNIVERSITY"
            ? ("ACADEMIC" as const)
            : s.kind === "TREATY_OR_OFFICIAL_BODY"
              ? ("STANDARDS_BODY" as const)
              : ("GOVERNMENT" as const),
        authorityLevel: KIND_AUTHORITY_LEVEL[s.kind],
        retrievedAt: now,
        excerpt: s.titleHe,
        confidence,
        epistemicState,
      };
    });

    return researchResultSchema.parse({
      question: body.question,
      answer: `Matched ${hits.length} verified official source(s). These are starting points for human counsel/research — not legal advice and not scraped page content.`,
      citations,
      conflicts: [],
      epistemicState: weakestEpistemicState(citations.map((c) => c.epistemicState)),
    });
  });
}

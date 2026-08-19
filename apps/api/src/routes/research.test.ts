import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  registerResearchRoutes,
  scoreCitationConfidence,
  epistemicStateForConfidence,
} from "./research.js";
import { buildRouteTestApp } from "./test-helpers/build-route-test-app.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildRouteTestApp(registerResearchRoutes);
});

afterAll(async () => {
  await app.close();
});

describe("scoreCitationConfidence (pure scoring formula)", () => {
  it("ranks a primary official-text source above an official-but-administrative body, above a secondary academic source", () => {
    const treaty = scoreCitationConfidence("TREATY_OR_OFFICIAL_BODY", true);
    const government = scoreCitationConfidence("GOVERNMENT", true);
    const university = scoreCitationConfidence("UNIVERSITY", true);
    expect(treaty).toBeGreaterThan(government);
    expect(government).toBeGreaterThan(university);
  });

  it("scores a precise topic match higher than a loose fallback match, for the same source kind", () => {
    const precise = scoreCitationConfidence("GOVERNMENT", true);
    const loose = scoreCitationConfidence("GOVERNMENT", false);
    expect(precise).toBeGreaterThan(loose);
  });

  it("is deterministic: identical inputs always produce the identical score (no randomness)", () => {
    const scores = Array.from({ length: 20 }, () =>
      scoreCitationConfidence("GOVERNMENT", true),
    );
    expect(new Set(scores).size).toBe(1);
    expect(scores[0]).toBe(scoreCitationConfidence("GOVERNMENT", true));
  });

  it("stays within [0, 1] for every kind/match-precision combination", () => {
    const kinds = ["TREATY_OR_OFFICIAL_BODY", "GOVERNMENT", "UNIVERSITY"] as const;
    for (const kind of kinds) {
      for (const precise of [true, false]) {
        const score = scoreCitationConfidence(kind, precise);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("epistemicStateForConfidence (trust ladder)", () => {
  it("never claims a tier above OBSERVED — this route has no page-content verification, so CONFIRMED/VERIFIED/FACT must be unreachable", () => {
    for (const confidence of [0, 0.1, 0.5, 0.69, 0.7, 0.84, 0.85, 0.9, 1]) {
      const state = epistemicStateForConfidence(confidence);
      expect(["OBSERVED", "INFERRED", "ASSUMED"]).toContain(state);
    }
  });

  it("maps confidence bands to the documented ladder", () => {
    expect(epistemicStateForConfidence(0.9)).toBe("OBSERVED");
    expect(epistemicStateForConfidence(0.85)).toBe("OBSERVED");
    expect(epistemicStateForConfidence(0.8)).toBe("INFERRED");
    expect(epistemicStateForConfidence(0.7)).toBe("INFERRED");
    expect(epistemicStateForConfidence(0.65)).toBe("ASSUMED");
    expect(epistemicStateForConfidence(0)).toBe("ASSUMED");
  });
});

describe("POST /api/v1/research", () => {
  it("INSUFFICIENT_EVIDENCE with zero citations when nothing in the allow-list matches", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/research",
      payload: { question: "xyzabc nonsense query zzqqww" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.citations).toEqual([]);
    expect(body.epistemicState).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("gives a precise, primary-text match (EU AI Act official text) a higher confidence than a loose, secondary-source match (a university's generic 'media-law' topic)", async () => {
    // "ai-act" is a literal topic on the eu-ai-act TREATY_OR_OFFICIAL_BODY
    // catalog entry -> precise match on the highest-authority kind.
    const treatyRes = await app.inject({
      method: "POST",
      url: "/api/v1/research",
      payload: { question: "What are the transparency duties under the ai-act?" },
    });
    expect(treatyRes.statusCode).toBe(200);
    const treatyBody = treatyRes.json();
    const treatyCitation = treatyBody.citations.find((c: { source: string }) =>
      c.source.includes("eur-lex.europa.eu/eli/reg/2024/1689"),
    );
    expect(treatyCitation).toBeDefined();
    expect(treatyCitation.confidence).toBeCloseTo(0.9);
    expect(treatyCitation.epistemicState).toBe("OBSERVED");
    expect(treatyCitation.authorityLevel).toBe("TIER_1");

    // "media-law" is a literal topic on the two UNIVERSITY catalog entries
    // -> precise match, but on the lowest-authority kind.
    const uniRes = await app.inject({
      method: "POST",
      url: "/api/v1/research",
      payload: { question: "Point me to media-law research" },
    });
    expect(uniRes.statusCode).toBe(200);
    const uniBody = uniRes.json();
    const uniCitation = uniBody.citations.find((c: { source: string }) =>
      c.source.includes("tau.ac.il"),
    );
    expect(uniCitation).toBeDefined();
    expect(uniCitation.confidence).toBeLessThan(treatyCitation.confidence);
    expect(uniCitation.authorityLevel).toBe("TIER_2");

    // No citation from either real, differently-scored request ever claims
    // more than the route's honest ceiling.
    for (const c of [...treatyBody.citations, ...uniBody.citations]) {
      expect(["OBSERVED", "INFERRED", "ASSUMED"]).toContain(c.epistemicState);
    }
  });

  it("gives two identical-quality results the same score (determinism, not per-call randomness)", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/research",
      payload: { question: "What are the transparency duties under the ai-act?" },
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/research",
      payload: { question: "What are the transparency duties under the ai-act?" },
    });
    const firstCitations = first.json().citations;
    const secondCitations = second.json().citations;
    expect(firstCitations.length).toBeGreaterThan(0);
    expect(firstCitations.map((c: { confidence: number }) => c.confidence)).toEqual(
      secondCitations.map((c: { confidence: number }) => c.confidence),
    );
    expect(
      firstCitations.map((c: { epistemicState: string }) => c.epistemicState),
    ).toEqual(secondCitations.map((c: { epistemicState: string }) => c.epistemicState));
  });

  it("sets the overall answer epistemicState to the weakest of its citations' states, never higher", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/research",
      payload: { question: "What are the transparency duties under the ai-act?" },
    });
    const body = res.json();
    const rank: Record<string, number> = { ASSUMED: 1, INFERRED: 2, OBSERVED: 3 };
    const weakest = body.citations.reduce(
      (min: number, c: { epistemicState: string }) => Math.min(min, rank[c.epistemicState]),
      Infinity,
    );
    expect(rank[body.epistemicState]).toBe(weakest);
  });
});

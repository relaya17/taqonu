import { describe, expect, it } from "vitest";
import {
  collectEvidenceRefs,
  insufficientEvidenceAnswer,
  resolveConversationEpistemic,
} from "./conversation-evidence.js";

describe("conversation evidence discipline", () => {
  it("empty pool → INSUFFICIENT_EVIDENCE", () => {
    const refs = collectEvidenceRefs({
      memories: [],
      evidenceRecords: [],
      knowledge: { hits: [], plainLanguage: "INSUFFICIENT_EVIDENCE — none" },
    });
    expect(refs).toEqual([]);
    expect(resolveConversationEpistemic(refs)).toBe("INSUFFICIENT_EVIDENCE");
    expect(insufficientEvidenceAnswer("en")).toMatch(/INSUFFICIENT_EVIDENCE/);
    expect(insufficientEvidenceAnswer("he")).toMatch(/INSUFFICIENT_EVIDENCE/);
    expect(insufficientEvidenceAnswer("ar")).toMatch(/INSUFFICIENT_EVIDENCE/);
  });

  it("memory or knowledge refs → PROPOSED", () => {
    const refs = collectEvidenceRefs({
      memories: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          statement: "Auth uses Supabase",
          epistemicState: "INFERRED",
          evidence: [
            {
              id: "22222222-2222-2222-2222-222222222222",
              kind: "doc",
              reference: "AUTH_RLS.md",
              excerpt: "RLS scoped writes",
            },
          ],
        },
      ],
      evidenceRecords: [],
      knowledge: null,
    });
    expect(refs.length).toBeGreaterThan(0);
    expect(refs[0]?.reference).toBe("AUTH_RLS.md");
    expect(resolveConversationEpistemic(refs)).toBe("PROPOSED");
  });

  it("knowledge hits become knowledge refs", () => {
    const refs = collectEvidenceRefs({
      memories: [],
      evidenceRecords: [],
      knowledge: {
        hits: [
          {
            id: "k1",
            title: "Constitution",
            sourceClass: "docs",
            authority: 0.9,
            url: null,
            retrievedAt: new Date().toISOString(),
            sourceUpdatedAt: null,
            freshness: "CURRENT",
            excerpt: "23 domains",
            contentHash: "abc",
            epistemicState: "OBSERVED",
          },
        ],
        plainLanguage: "1 package",
      },
    });
    expect(refs).toHaveLength(1);
    expect(refs[0]?.kind).toBe("knowledge");
    expect(resolveConversationEpistemic(refs)).toBe("PROPOSED");
  });
});

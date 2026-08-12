import { describe, expect, it } from "vitest";
import { PROJECT_STATE_SLICES } from "../constants/state.js";
import {
  projectCurrentStateResponseSchema,
  projectStateSnapshotSchema,
} from "./project-state.schema.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SNAPSHOT_ID = "22222222-2222-4222-8222-222222222222";
const EVIDENCE_ID = "33333333-3333-4333-8333-333333333333";
const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const NOW = "2026-08-12T12:00:00.000Z";

describe("projectCurrentStateResponseSchema", () => {
  it("accepts a full-slice snapshot with evidence rollup", () => {
    const parsed = projectCurrentStateResponseSchema.parse({
      id: SNAPSHOT_ID,
      projectId: PROJECT_ID,
      asOf: NOW,
      reconciledAt: NOW,
      slices: PROJECT_STATE_SLICES.map((key) => ({
        key,
        summary: `${key} UNKNOWN until observed`,
        epistemicState: "UNKNOWN",
        confidence: 0,
        evidenceIds: key === "GIT" ? [EVIDENCE_ID] : [],
        claimIds: [],
        asOf: NOW,
        validUntil: null,
        stale: true,
      })),
      conflicts: [],
      overallEpistemicState: "UNKNOWN",
      sourceConnectors: [],
      evidence: [
        {
          id: EVIDENCE_ID,
          ownerId: OWNER_ID,
          projectId: PROJECT_ID,
          source: "github",
          sourceType: "GITHUB",
          sourceId: "owner/repo",
          uri: "https://github.com/owner/repo",
          excerpt: "repo observed",
          version: null,
          observedAt: NOW,
          createdAt: NOW,
          confidence: 1,
          epistemicState: "FACT",
          category: "GIT",
          metadata: {},
        },
      ],
      evidenceByCategory: PROJECT_STATE_SLICES.map((category) => ({
        category,
        items:
          category === "GIT"
            ? [
                {
                  id: EVIDENCE_ID,
                  ownerId: OWNER_ID,
                  projectId: PROJECT_ID,
                  source: "github",
                  sourceType: "GITHUB",
                  sourceId: "owner/repo",
                  uri: "https://github.com/owner/repo",
                  excerpt: "repo observed",
                  version: null,
                  observedAt: NOW,
                  createdAt: NOW,
                  confidence: 1,
                  epistemicState: "FACT",
                  category: "GIT",
                  metadata: {},
                },
              ]
            : [],
      })),
    });

    expect(parsed.slices).toHaveLength(PROJECT_STATE_SLICES.length);
    expect(parsed.evidence).toHaveLength(1);
    expect(parsed.evidence[0]?.category).toBe("GIT");
    expect(parsed.evidenceByCategory).toHaveLength(PROJECT_STATE_SLICES.length);
    expect(parsed.evidence[0]?.uri).toBe("https://github.com/owner/repo");
    expect(parsed.overallEpistemicState).toBe("UNKNOWN");
  });

  it("defaults evidence to empty without inventing READY", () => {
    const snapshot = projectStateSnapshotSchema.parse({
      id: SNAPSHOT_ID,
      projectId: PROJECT_ID,
      asOf: NOW,
      reconciledAt: NOW,
      slices: [
        {
          key: "ENVIRONMENT",
          summary: "No env feed — UNKNOWN",
          epistemicState: "UNKNOWN",
          confidence: 0,
          evidenceIds: [],
          claimIds: [],
          asOf: NOW,
          validUntil: null,
          stale: true,
        },
      ],
      conflicts: [],
      overallEpistemicState: "UNKNOWN",
      sourceConnectors: [],
    });

    const rollup = projectCurrentStateResponseSchema.parse({
      ...snapshot,
    });
    expect(rollup.evidence).toEqual([]);
    expect(rollup.slices[0]?.epistemicState).toBe("UNKNOWN");
  });
});

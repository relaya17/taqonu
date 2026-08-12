import { describe, expect, it } from "vitest";
import {
  EVIDENCE_CATEGORIES,
  PROJECT_STATE_SLICES,
  type EvidenceRecord,
  type ProjectStateSnapshot,
} from "@atlas/shared";
import {
  buildCurrentStateRollup,
  emptyUnknownSnapshot,
  ensureFullSlices,
} from "./current-state-rollup.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const EVIDENCE_ID = "33333333-3333-4333-8333-333333333333";
const EVIDENCE_SEC = "33333333-3333-4333-8333-333333333334";
const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const NOW = "2026-08-12T12:00:00.000Z";

function evidence(partial: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id: EVIDENCE_ID,
    ownerId: OWNER_ID,
    projectId: PROJECT_ID,
    source: "github",
    sourceType: "GITHUB",
    sourceId: "owner/repo",
    uri: "https://github.com/owner/repo",
    excerpt: "HEAD observed",
    version: null,
    observedAt: NOW,
    createdAt: NOW,
    confidence: 1,
    epistemicState: "FACT",
    category: "GIT",
    classification: "INTERNAL",
    authorityRank: "REPOSITORY_CODE",
    metadata: {},
    ...partial,
  };
}

describe("current-state-rollup", () => {
  it("emptyUnknownSnapshot covers all slices as UNKNOWN", () => {
    const snap = emptyUnknownSnapshot(PROJECT_ID, NOW);
    expect(snap.slices).toHaveLength(PROJECT_STATE_SLICES.length);
    expect(snap.overallEpistemicState).toBe("UNKNOWN");
    expect(snap.slices.every((s) => s.epistemicState === "UNKNOWN")).toBe(true);
    expect(snap.slices.find((s) => s.key === "ENVIRONMENT")?.stale).toBe(true);
    expect(snap.slices.find((s) => s.key === "DEPLOYMENT")?.stale).toBe(true);
  });

  it("ensureFullSlices pads partial snapshots without promoting epistemic", () => {
    const partial: ProjectStateSnapshot = {
      id: "22222222-2222-4222-8222-222222222222",
      projectId: PROJECT_ID,
      asOf: NOW,
      reconciledAt: NOW,
      slices: [
        {
          key: "GIT",
          summary: "repo owner/repo",
          epistemicState: "OBSERVED",
          confidence: 0.9,
          evidenceIds: [EVIDENCE_ID],
          claimIds: [],
          asOf: NOW,
          validUntil: null,
          stale: false,
        },
      ],
      conflicts: [],
      overallEpistemicState: "OBSERVED",
      sourceConnectors: ["github"],
    };

    const full = ensureFullSlices(partial);
    expect(full.slices).toHaveLength(PROJECT_STATE_SLICES.length);
    expect(full.slices.find((s) => s.key === "GIT")?.epistemicState).toBe(
      "OBSERVED",
    );
    expect(full.slices.find((s) => s.key === "CODE")?.epistemicState).toBe(
      "UNKNOWN",
    );
  });

  it("buildCurrentStateRollup only includes referenced evidence", () => {
    const snap = emptyUnknownSnapshot(PROJECT_ID, NOW);
    snap.slices = snap.slices.map((slice) =>
      slice.key === "GIT"
        ? { ...slice, evidenceIds: [EVIDENCE_ID], epistemicState: "OBSERVED" }
        : slice,
    );

    const orphan = evidence({
      id: "44444444-4444-4444-8444-444444444444",
      uri: "https://example.com/orphan",
    });
    const linked = evidence();

    const rollup = buildCurrentStateRollup(snap, [linked, orphan]);
    expect(rollup.evidence).toHaveLength(1);
    expect(rollup.evidence[0]?.id).toBe(EVIDENCE_ID);
    expect(rollup.evidence[0]?.uri).toBe("https://github.com/owner/repo");
    expect(rollup.evidence[0]?.category).toBe("GIT");
  });

  it("preserves CODE/GIT/SECURITY distinctly in evidenceByCategory", () => {
    const snap = emptyUnknownSnapshot(PROJECT_ID, NOW);
    snap.slices = snap.slices.map((slice) => {
      if (slice.key === "GIT") {
        return {
          ...slice,
          evidenceIds: [EVIDENCE_ID],
          epistemicState: "OBSERVED",
        };
      }
      if (slice.key === "SECURITY") {
        return {
          ...slice,
          evidenceIds: [EVIDENCE_SEC],
          epistemicState: "OBSERVED",
        };
      }
      return slice;
    });

    const gitEv = evidence();
    const secEv = evidence({
      id: EVIDENCE_SEC,
      source: "security:scan",
      sourceType: "SYSTEM",
      category: "SECURITY",
      uri: null,
      excerpt: "no secrets in logs",
      metadata: { kind: "security" },
    });

    const rollup = buildCurrentStateRollup(snap, [gitEv, secEv]);
    expect(rollup.evidenceByCategory).toHaveLength(EVIDENCE_CATEGORIES.length);
    expect(
      rollup.evidenceByCategory.find((b) => b.category === "GIT")?.items,
    ).toHaveLength(1);
    expect(
      rollup.evidenceByCategory.find((b) => b.category === "SECURITY")?.items,
    ).toHaveLength(1);
    expect(
      rollup.evidenceByCategory.find((b) => b.category === "CODE")?.items,
    ).toHaveLength(0);
    expect(rollup.evidence.map((e) => e.category).sort()).toEqual([
      "GIT",
      "SECURITY",
    ]);
  });
});

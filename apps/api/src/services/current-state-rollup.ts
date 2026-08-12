import {
  PROJECT_STATE_SLICES,
  assertCategoriesPreserved,
  groupEvidenceByCategory,
  parseEvidenceRecord,
  projectCurrentStateResponseSchema,
  projectStateSnapshotSchema,
  type EvidenceRecord,
  type ProjectCurrentStateResponse,
  type ProjectStateSlice,
  type ProjectStateSnapshot,
  type ProjectStateSliceKey,
} from "@atlas/shared";

function unknownSlice(
  key: ProjectStateSliceKey,
  asOf: string,
): ProjectStateSlice {
  return {
    key,
    summary: `No connector evidence for ${key} — remains UNKNOWN until observed.`,
    epistemicState: "UNKNOWN",
    confidence: 0,
    evidenceIds: [],
    claimIds: [],
    asOf,
    validUntil: null,
    stale: true,
  };
}

/** Pad missing slices as UNKNOWN — never invent READY/FACT. */
export function ensureFullSlices(
  snapshot: ProjectStateSnapshot,
): ProjectStateSnapshot {
  const byKey = new Map(snapshot.slices.map((slice) => [slice.key, slice]));
  const slices = PROJECT_STATE_SLICES.map(
    (key) => byKey.get(key) ?? unknownSlice(key, snapshot.asOf),
  );
  return projectStateSnapshotSchema.parse({ ...snapshot, slices });
}

export function emptyUnknownSnapshot(
  projectId: string,
  asOf = new Date().toISOString(),
): ProjectStateSnapshot {
  return projectStateSnapshotSchema.parse({
    id: crypto.randomUUID(),
    projectId,
    asOf,
    reconciledAt: asOf,
    slices: PROJECT_STATE_SLICES.map((key) => unknownSlice(key, asOf)),
    conflicts: [],
    overallEpistemicState: "UNKNOWN",
    sourceConnectors: [],
  });
}

/**
 * Attach evidence records referenced by slice evidenceIds.
 * Categories stay distinct — never silently merge into one blob.
 */
export function buildCurrentStateRollup(
  snapshot: ProjectStateSnapshot,
  projectEvidence: readonly EvidenceRecord[],
): ProjectCurrentStateResponse {
  const full = ensureFullSlices(snapshot);
  const referenced = new Set(
    full.slices.flatMap((slice) => slice.evidenceIds),
  );
  const evidence =
    referenced.size === 0
      ? []
      : projectEvidence
          .filter((item) => referenced.has(item.id))
          .map((item) => parseEvidenceRecord(item));

  const evidenceByCategory = groupEvidenceByCategory(evidence);
  assertCategoriesPreserved(evidence, evidenceByCategory);

  return projectCurrentStateResponseSchema.parse({
    ...full,
    evidence,
    evidenceByCategory,
  });
}

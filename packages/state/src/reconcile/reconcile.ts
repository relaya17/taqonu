import {
  projectStateSnapshotSchema,
  type ProjectStateSnapshot,
  type StateConflict,
} from "@atlas/shared";
import { summarizeConflict } from "./conflicts.js";
import { weakestEpistemicState } from "./epistemic.js";
import type { ReconciliationInput } from "./input.js";
import { buildAllSlices } from "./slices.js";

export interface ReconciliationResult {
  readonly snapshot: ProjectStateSnapshot;
  readonly domainEvent: {
    readonly type: "state.reconciled";
    readonly projectId: string;
    readonly snapshotId: string;
    readonly overallEpistemicState: ProjectStateSnapshot["overallEpistemicState"];
    readonly conflictCount: number;
  };
}

/**
 * Fuse GitHub (+ later connectors), memory, and decisions into Current State.
 * Never invents FACT from PROPOSED. Conflicts are retained, not merged.
 */
export function reconcileProjectState(
  input: ReconciliationInput,
): ReconciliationResult {
  const asOf = input.asOf ?? new Date().toISOString();
  const reconciledAt = new Date().toISOString();
  const drafts = buildAllSlices({ ...input, asOf });

  const conflicts: StateConflict[] = [];
  for (const draft of drafts) {
    if (draft.conflictingClaimIds) {
      const [claimAId, claimBId] = draft.conflictingClaimIds;
      const claimA = input.claims.find((item) => item.id === claimAId);
      const claimB = input.claims.find((item) => item.id === claimBId);
      conflicts.push({
        id: crypto.randomUUID(),
        sliceKey: draft.key,
        claimAId,
        claimBId,
        resolution:
          claimA && claimB ? summarizeConflict(claimA, claimB) : null,
        epistemicState: "CONFLICTED",
        detectedAt: reconciledAt,
      });
    }
  }

  // Claim-level conflicts on same project without silent merge
  const activeClaims = input.claims.filter(
    (item) => item.epistemicState === "CONFLICTED" || item.conflictingClaimIds.length > 0,
  );
  for (const claim of activeClaims) {
    for (const otherId of claim.conflictingClaimIds) {
      const already = conflicts.some(
        (item) =>
          (item.claimAId === claim.id && item.claimBId === otherId) ||
          (item.claimBId === claim.id && item.claimAId === otherId),
      );
      if (already) {
        continue;
      }
      conflicts.push({
        id: crypto.randomUUID(),
        sliceKey: "ARCHITECTURE",
        claimAId: claim.id,
        claimBId: otherId,
        resolution: null,
        epistemicState: "CONFLICTED",
        detectedAt: reconciledAt,
      });
    }
  }

  const sliceStates = drafts.map((item) =>
    conflicts.some((conflict) => conflict.sliceKey === item.key)
      ? ("CONFLICTED" as const)
      : item.epistemicState,
  );

  const overallEpistemicState =
    conflicts.length > 0
      ? "CONFLICTED"
      : weakestEpistemicState(sliceStates);

  const connectors = [
    ...new Set(input.observations.map((item) => item.connector)),
  ];

  const snapshot = projectStateSnapshotSchema.parse({
    id: crypto.randomUUID(),
    projectId: input.projectId,
    asOf,
    reconciledAt,
    slices: drafts.map((draft) => ({
      key: draft.key,
      summary: draft.summary,
      epistemicState: conflicts.some((conflict) => conflict.sliceKey === draft.key)
        ? "CONFLICTED"
        : draft.epistemicState,
      confidence: draft.confidence,
      evidenceIds: [...draft.evidenceIds],
      claimIds: [...draft.claimIds],
      asOf: draft.asOf,
      validUntil: draft.validUntil,
      stale: draft.stale,
    })),
    conflicts,
    overallEpistemicState,
    sourceConnectors: connectors.length > 0 ? connectors : ["github"],
  });

  return {
    snapshot,
    domainEvent: {
      type: "state.reconciled",
      projectId: input.projectId,
      snapshotId: snapshot.id,
      overallEpistemicState: snapshot.overallEpistemicState,
      conflictCount: conflicts.length,
    },
  };
}

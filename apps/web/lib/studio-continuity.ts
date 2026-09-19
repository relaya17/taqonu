export interface StudioContinuityPatch {
  readonly id: string;
  readonly title: string;
  readonly status: string;
}

export interface StudioContinuityRun {
  readonly commandId?: string;
  readonly status: string;
  readonly passed?: boolean | null;
}

export interface StudioContinuityCost {
  readonly totalUsd: number;
  readonly runCount: number;
  readonly note: string;
}

export interface StudioContinuityInput {
  readonly lastPatch: StudioContinuityPatch | null;
  readonly lastRun: StudioContinuityRun | null;
  readonly cost: StudioContinuityCost | null;
  readonly boundFindingId: string | null;
}

export interface StudioContinuityView {
  readonly patchTitle: string | null;
  readonly patchStatus: string | null;
  readonly runCommand: string | null;
  readonly runStatus: string | null;
  readonly costUsd: number | null;
  readonly costRuns: number | null;
  readonly boundFindingId: string | null;
}

/**
 * Compose the project's current work state from existing Studio sources.
 * Does not invent Truth, cost, or a pending-approval list from Control.
 */
export function studioContinuityView(
  input: StudioContinuityInput,
): StudioContinuityView {
  return {
    patchTitle: input.lastPatch?.title ?? null,
    patchStatus: input.lastPatch?.status ?? null,
    runCommand: input.lastRun?.commandId ?? null,
    runStatus: input.lastRun?.status ?? null,
    costUsd: input.cost ? input.cost.totalUsd : null,
    costRuns: input.cost ? input.cost.runCount : null,
    boundFindingId: input.boundFindingId,
  };
}

export function pickLatestStudioPatch(
  items: readonly StudioContinuityPatch[] | undefined,
): StudioContinuityPatch | null {
  if (!items || items.length === 0) return null;
  const active = items.find(
    (item) => item.status !== "VERIFIED" && item.status !== "ROLLED_BACK",
  );
  return active ?? items[0] ?? null;
}

import type { ProjectGenome } from "@atlas/shared";
import { diffFlows } from "../behavior/diff.js";

export interface TemporalCompareResult {
  previousAt: string | null;
  currentAt: string;
  apiCountDelta: number;
  dependencyCountDelta: number;
  fileCountDelta: number;
  behaviorDiffCount: number;
  summary: string;
  behaviorDiffs: ReturnType<typeof diffFlows>;
}

/** Compare two genome snapshots (temporal engine seed). */
export function compareGenomes(
  previous: ProjectGenome | null,
  current: ProjectGenome,
): TemporalCompareResult {
  const behaviorDiffs = previous
    ? diffFlows(previous.apis, current.apis)
    : [];
  const apiCountDelta = current.apis.length - (previous?.apis.length ?? 0);
  const dependencyCountDelta =
    current.dependencies.length - (previous?.dependencies.length ?? 0);
  const fileCountDelta =
    current.architecture.fileCount -
    (previous?.architecture.fileCount ?? current.architecture.fileCount);

  const summary = previous
    ? `Compared to ${previous.capturedAt}: APIs Δ${apiCountDelta}, deps Δ${dependencyCountDelta}, behavior diffs ${behaviorDiffs.length}.`
    : "No previous genome — baseline captured (temporal compare UNKNOWN until next cycle).";

  return {
    previousAt: previous?.capturedAt ?? null,
    currentAt: current.capturedAt,
    apiCountDelta,
    dependencyCountDelta,
    fileCountDelta,
    behaviorDiffCount: behaviorDiffs.length,
    summary,
    behaviorDiffs,
  };
}

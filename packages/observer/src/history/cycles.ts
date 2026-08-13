import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { atlasObserverPaths } from "../paths.js";

export interface CycleHistoryEntry {
  id: string;
  at: string;
  riskBand: string;
  riskScore: number;
  findingCount: number;
  behaviorDiffCount: number;
  graphNodes: number;
  graphEdges: number;
  trigger: string;
  topFindingTitle: string | null;
}

export function appendCycleHistory(
  workspaceRoot: string,
  entry: CycleHistoryEntry,
): void {
  const { cycles, cyclesIndex } = atlasObserverPaths(workspaceRoot);
  mkdirSync(cycles, { recursive: true });
  writeFileSync(
    join(
      cycles,
      `${entry.at.replace(/[:.]/g, "-")}-${entry.id.slice(0, 8)}.json`,
    ),
    JSON.stringify(entry, null, 2),
    "utf8",
  );
  const existing = listCycleHistory(workspaceRoot);
  const next = [entry, ...existing.filter((e) => e.id !== entry.id)].slice(
    0,
    50,
  );
  writeFileSync(cyclesIndex, JSON.stringify(next, null, 2), "utf8");
}

export function listCycleHistory(workspaceRoot: string): CycleHistoryEntry[] {
  const { cyclesIndex } = atlasObserverPaths(workspaceRoot);
  if (!existsSync(cyclesIndex)) return [];
  try {
    const raw = JSON.parse(
      readFileSync(cyclesIndex, "utf8"),
    ) as CycleHistoryEntry[];
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, 50);
  } catch {
    return [];
  }
}

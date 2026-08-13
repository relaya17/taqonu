import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { atlasObserverPaths } from "../paths.js";

export interface TruthCounters {
  analyzed: number;
  meaningfulRisks: number;
  confirmedRegressions: number;
  caughtBeforeProd: number;
  cycles: number;
  updatedAt: string;
}

export function loadTruthCounters(workspaceRoot: string): TruthCounters {
  const { truthCounters } = atlasObserverPaths(workspaceRoot);
  if (!existsSync(truthCounters)) {
    return {
      analyzed: 0,
      meaningfulRisks: 0,
      confirmedRegressions: 0,
      caughtBeforeProd: 0,
      cycles: 0,
      updatedAt: new Date().toISOString(),
    };
  }
  try {
    const raw = JSON.parse(readFileSync(truthCounters, "utf8")) as TruthCounters;
    return {
      analyzed: Number(raw.analyzed) || 0,
      meaningfulRisks: Number(raw.meaningfulRisks) || 0,
      confirmedRegressions: Number(raw.confirmedRegressions) || 0,
      caughtBeforeProd: Number(raw.caughtBeforeProd) || 0,
      cycles: Number(raw.cycles) || 0,
      updatedAt: raw.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return {
      analyzed: 0,
      meaningfulRisks: 0,
      confirmedRegressions: 0,
      caughtBeforeProd: 0,
      cycles: 0,
      updatedAt: new Date().toISOString(),
    };
  }
}

export function bumpTruthCounters(
  workspaceRoot: string,
  delta: {
    analyzed?: number;
    meaningfulRisks?: number;
    confirmedRegressions?: number;
    caughtBeforeProd?: number;
  },
): TruthCounters {
  const cur = loadTruthCounters(workspaceRoot);
  const next: TruthCounters = {
    analyzed: cur.analyzed + (delta.analyzed ?? 0),
    meaningfulRisks: cur.meaningfulRisks + (delta.meaningfulRisks ?? 0),
    confirmedRegressions:
      cur.confirmedRegressions + (delta.confirmedRegressions ?? 0),
    caughtBeforeProd: cur.caughtBeforeProd + (delta.caughtBeforeProd ?? 0),
    cycles: cur.cycles + 1,
    updatedAt: new Date().toISOString(),
  };
  const { truthCounters } = atlasObserverPaths(workspaceRoot);
  mkdirSync(dirname(truthCounters), { recursive: true });
  writeFileSync(truthCounters, JSON.stringify(next, null, 2), "utf8");
  return next;
}

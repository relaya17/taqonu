import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ObserverFinding } from "@atlas/shared";
import { atlasObserverPaths } from "../paths.js";
import { selectTopTruthFinding } from "./top.js";
import { loadSentinelLastScan } from "../security/persist.js";

export interface LastTruthFindings {
  readonly at: string;
  readonly cycleId: string | null;
  readonly findings: ObserverFinding[];
}

export function saveLastTruthFindings(
  workspaceRoot: string,
  input: LastTruthFindings,
): void {
  const path = atlasObserverPaths(workspaceRoot).lastFindings;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(input, null, 2)}\n`, "utf8");
}

export function loadLastTruthFindings(
  workspaceRoot: string,
): LastTruthFindings | null {
  const path = atlasObserverPaths(workspaceRoot).lastFindings;
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as LastTruthFindings;
    if (!raw || !Array.isArray(raw.findings)) return null;
    return raw;
  } catch {
    return null;
  }
}

function sentinelFindingsAsObserver(
  workspaceRoot: string,
): ObserverFinding[] {
  const last = loadSentinelLastScan(workspaceRoot);
  if (!last) return [];
  return last.findings.slice(0, 40).map((finding) => ({
    id: finding.id.startsWith("sentinel:")
      ? finding.id
      : `sentinel:${finding.id}`,
    title: finding.title,
    detail: finding.detail,
    claim: finding.claim === "OBSERVED" ? "OBSERVED" : "INFERRED",
    epistemicState:
      finding.epistemicState === "OBSERVED" ? "OBSERVED" : "INFERRED",
    riskBand: finding.severity,
    category: "SECURITY" as const,
    evidenceRefs: [...finding.evidenceRefs],
  }));
}

/** Prefer persisted observe-cycle findings; else last Sentinel scan. */
export function resolveTruthTopFinding(workspaceRoot: string): {
  readonly lastFindings: ObserverFinding[];
  readonly topFinding: ObserverFinding | null;
} {
  const persisted = loadLastTruthFindings(workspaceRoot);
  const fromCycle = persisted?.findings ?? [];
  const findings =
    fromCycle.length > 0 ? fromCycle : sentinelFindingsAsObserver(workspaceRoot);
  return {
    lastFindings: findings.slice(0, 20),
    topFinding: selectTopTruthFinding(findings),
  };
}

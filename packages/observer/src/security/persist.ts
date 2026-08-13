/**
 * Persist Sentinel scan + AuthZ baseline under `.atlas/sentinel/`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { atlasObserverPaths } from "../paths.js";
import type { SentinelScanResult } from "./scan.js";

export interface AuthzFileSnapshot {
  readonly hasGuard: boolean;
  readonly highValue: boolean;
  readonly sensitiveRoute: boolean;
}

export interface AuthzBaseline {
  readonly at: string;
  readonly files: Record<string, AuthzFileSnapshot>;
}

export function loadAuthzBaseline(
  workspaceRoot: string,
): AuthzBaseline | null {
  const path = atlasObserverPaths(workspaceRoot).sentinelAuthzBaseline;
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as AuthzBaseline;
  } catch {
    return null;
  }
}

export function saveAuthzBaseline(
  workspaceRoot: string,
  baseline: AuthzBaseline,
): void {
  const path = atlasObserverPaths(workspaceRoot).sentinelAuthzBaseline;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
}

export function saveSentinelLastScan(
  workspaceRoot: string,
  result: SentinelScanResult,
): void {
  const path = atlasObserverPaths(workspaceRoot).sentinelLastScan;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

export function loadSentinelLastScan(
  workspaceRoot: string,
): SentinelScanResult | null {
  const path = atlasObserverPaths(workspaceRoot).sentinelLastScan;
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SentinelScanResult;
  } catch {
    return null;
  }
}

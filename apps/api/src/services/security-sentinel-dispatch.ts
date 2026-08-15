import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  agentRunResultSchema,
  type AgentRunResult,
} from "@atlas/shared";
import { runSentinelScan } from "@atlas/observer";
import { osStore } from "../store/os-store.js";

export function resolveProjectWorkspaceRoot(
  projectId?: string | null,
): string | null {
  if (!projectId) return null;
  const stored = osStore.getWorkspaceRoot(projectId);
  if (!stored) return null;
  const root = resolve(stored);
  return existsSync(root) ? root : null;
}

/** SECURITY fabric run backed by Atlas Sentinel — observed findings, not a stub. */
export function runSecuritySpecialistViaSentinel(input: {
  request: string;
  projectId?: string | null;
  workspaceRoot?: string | null;
}): AgentRunResult | null {
  const root =
    input.workspaceRoot && existsSync(input.workspaceRoot)
      ? resolve(input.workspaceRoot)
      : resolveProjectWorkspaceRoot(input.projectId ?? null);
  if (!root) return null;

  const started = Date.now();
  const scan = runSentinelScan(root, { persist: false });
  const top = scan.findings.slice(0, 8);
  const claims = [
    `SECURITY: sentinel_posture=${scan.posture}`,
    `WRITE=forbidden`,
    `critical=${scan.counts.critical} high=${scan.counts.high}`,
    ...top.map((f) => `${f.severity} ${f.title}`),
    ...scan.nextActions.slice(0, 3),
  ];
  return agentRunResultSchema.parse({
    agentId: "SECURITY",
    status: "COMPLETED",
    summary: `Sentinel ${scan.posture}: ${scan.summary}`,
    claims,
    evidenceRefs: top.flatMap((f) =>
      "evidenceRefs" in f && Array.isArray(f.evidenceRefs)
        ? f.evidenceRefs.slice(0, 2)
        : [f.id],
    ),
    epistemicState: "OBSERVED",
    costUsd: 0,
    durationMs: Math.max(1, Date.now() - started),
  });
}

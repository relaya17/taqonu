/**
 * Debugger policy gate — Studio Evolution design (2026-10-04 Design Plan,
 * approved for implementation). Policy ONLY: this module never spawns a
 * process and never imports governed-command.ts. Every branch is
 * fail-closed. Order: host opt-in → P3 (system-wide) → P2 → ownership →
 * duplicate-session → ALLOW. The host opt-in only decides whether the
 * Debugger may be ATTEMPTED on this host; it never relaxes any later check.
 */
import { spawnSync } from "node:child_process";
import { AtlasError } from "@atlas/shared";
import type { ProjectOwnerLookup } from "./project-access.js";
import { isAgentActorRequest } from "./studio-actor.js";

/**
 * Debugger is human-only, same posture as the PTY terminal
 * (`isAgentPtyRequest`/`denyAgentPty` in studio-pty.ts). The Agent must
 * never open, act within, or close a Debug Session.
 */
export function isAgentDebugRequest(headers: Record<string, unknown>): boolean {
  return isAgentActorRequest(headers);
}

export function denyAgentDebugRequest(): never {
  throw new AtlasError(
    "FORBIDDEN",
    "Debug Sessions are human-only. The Agent cannot open, act within, or close one.",
    { statusCode: 403 },
  );
}

export type DebugGateDenial =
  | "DEBUGGER_DISABLED"
  | "P2_PRODUCTION_LINKED"
  | "P2_INSUFFICIENT_EVIDENCE"
  | "P3_CONFIGURATION_ERROR"
  | "OWNERSHIP"
  | "DEBUG_SESSION_ALREADY_ACTIVE";

export type DebugGateDecision =
  | { readonly decision: "ALLOW" }
  | { readonly decision: "DENY"; readonly denial: DebugGateDenial; readonly reason: string };

export type ProjectEnvironmentTier = "PRODUCTION" | "STAGING" | "DEVELOPMENT";

/**
 * Host opt-in. The Debugger is OFF unless the API host explicitly sets
 * ATLAS_DEBUGGER_ENABLED=1. Any other value (unset, "true", "0") is off.
 * This is an additional restriction, not a permission: it cannot grant
 * access that P2/P3/ownership/duplicate would deny.
 */
export function isDebuggerEnabledOnHost(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ATLAS_DEBUGGER_ENABLED === "1";
}

export function checkHostEnabled(enabled: boolean): DebugGateDecision {
  if (!enabled) {
    return {
      decision: "DENY",
      denial: "DEBUGGER_DISABLED",
      reason: "The Debugger is not enabled on this API host. A host operator must opt in explicitly.",
    };
  }
  return { decision: "ALLOW" };
}

/**
 * P2 source of truth. `Project.environmentTier` does not exist yet (a
 * separate, not yet authorized Data Model decision), so in production this
 * ALWAYS returns null, which checkP2 treats as INSUFFICIENT_EVIDENCE → DENY.
 * No heuristic by slug/name. The override map is populated only by the
 * *ForTests setter below, which no non-test source may call.
 */
let environmentTierOverridesForTests: Map<string, ProjectEnvironmentTier> | null = null;

export function readProjectEnvironmentTier(projectId: string): ProjectEnvironmentTier | null {
  return environmentTierOverridesForTests?.get(projectId) ?? null;
}

/** Test-only: lets a test classify a project so the success path is reachable. */
export function setProjectEnvironmentTierForTests(projectId: string, tier: ProjectEnvironmentTier | null): void {
  if (tier === null) {
    environmentTierOverridesForTests?.delete(projectId);
    return;
  }
  (environmentTierOverridesForTests ??= new Map()).set(projectId, tier);
}

export function resetProjectEnvironmentTiersForTests(): void {
  environmentTierOverridesForTests = null;
}

/**
 * P3 enforcement capability. A Windows process's integrity level is fixed at
 * process creation and cannot change while it runs — so this is checked once
 * and cached, not per-request (Studio Evolution design, §7: startup-only).
 * Non-Windows hosts use the POSIX root check as a best-effort equivalent.
 *
 * Fail-closed: only positive evidence of a non-elevated process yields
 * `false`. A failed, timed-out, non-zero or unrecognized check is `"UNKNOWN"`,
 * which the gate denies exactly like an elevated process. `"UNKNOWN"` is cached
 * too, so a failed check denies until the API restarts and never re-spawns
 * `whoami` on every request.
 */
export type AtlasElevation = boolean | "UNKNOWN";

let cachedElevationState: AtlasElevation | null = null;

// Integrity-level RIDs (S-1-16-<rid>): Untrusted, Low, Medium, Medium Plus.
const NON_ELEVATED_INTEGRITY_RIDS: ReadonlySet<number> = new Set([0, 4096, 8192, 8448]);
const HIGH_INTEGRITY_RID = 12288;

export interface WindowsElevationProbe {
  readonly error?: Error | undefined;
  readonly status: number | null;
  readonly stdout: string | null | undefined;
}

/** Pure interpretation of `whoami /groups`; exported so every outcome is testable. */
export function classifyWindowsElevationProbe(probe: WindowsElevationProbe): AtlasElevation {
  if (probe.error || probe.status !== 0) return "UNKNOWN";
  const stdout = probe.stdout;
  if (typeof stdout !== "string" || stdout.length === 0) return "UNKNOWN";
  const rids = [...stdout.matchAll(/\bS-1-16-(\d+)\b/g)].map((m) => Number(m[1]));
  if (rids.some((rid) => rid >= HIGH_INTEGRITY_RID) || /High Mandatory Level/i.test(stdout)) return true;
  if (rids.some((rid) => NON_ELEVATED_INTEGRITY_RIDS.has(rid))) return false;
  return "UNKNOWN";
}

export interface AtlasElevationEnvironment {
  readonly platform: NodeJS.Platform;
  readonly spawn: typeof spawnSync;
  readonly getuid: (() => number) | undefined;
}

/** Uncached detection. The injected environment exists so failures can be exercised without a real host check. */
export function detectAtlasElevation(
  env: AtlasElevationEnvironment = {
    platform: process.platform,
    spawn: spawnSync,
    getuid: typeof process.getuid === "function" ? process.getuid.bind(process) : undefined,
  },
): AtlasElevation {
  try {
    if (env.platform === "win32") {
      const result = env.spawn("whoami", ["/groups"], {
        shell: false,
        windowsHide: true,
        encoding: "utf8",
        timeout: 5_000,
      });
      return classifyWindowsElevationProbe(result);
    }
    // POSIX: uid 0 is the closest equivalent to "elevated" for this check.
    return env.getuid ? env.getuid() === 0 : "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
}

export function getAtlasElevation(): AtlasElevation {
  if (cachedElevationState !== null) return cachedElevationState;
  cachedElevationState = detectAtlasElevation();
  return cachedElevationState;
}

/** Test-only: forces the cached elevation state so unit tests do not spawn `whoami`. */
export function setAtlasElevationStateForTests(next: AtlasElevation | null): void {
  cachedElevationState = next;
}

/**
 * P2. Denies PRODUCTION and any unclassified project (null). It never
 * assumes DEVELOPMENT and never uses a slug/name heuristic.
 */
export function checkP2(environmentTier: ProjectEnvironmentTier | null): DebugGateDecision {
  if (environmentTier === "PRODUCTION") {
    return {
      decision: "DENY",
      denial: "P2_PRODUCTION_LINKED",
      reason: "Project is classified production-linked. Debug sessions are not permitted.",
    };
  }
  if (environmentTier === null) {
    return {
      decision: "DENY",
      denial: "P2_INSUFFICIENT_EVIDENCE",
      reason:
        "Project environment classification has no source of truth yet (environmentTier is unset). Fail-closed per approved Debugger policy.",
    };
  }
  return { decision: "ALLOW" };
}

export function checkP3(elevated: AtlasElevation): DebugGateDecision {
  if (elevated === "UNKNOWN") {
    return {
      decision: "DENY",
      denial: "P3_CONFIGURATION_ERROR",
      reason:
        "Atlas API process elevation could not be verified. Debug sessions are disabled host-wide until it can (fail-closed).",
    };
  }
  if (elevated) {
    return {
      decision: "DENY",
      denial: "P3_CONFIGURATION_ERROR",
      reason:
        "Atlas API process is running elevated. Debug sessions are disabled host-wide until it is restarted non-elevated.",
    };
  }
  return { decision: "ALLOW" };
}

/**
 * Only an authorization-grade owner record that equals the actor allows. A
 * missing, malformed, unavailable or backup-recovered record denies, and the
 * Debugger never claims an unowned project.
 */
export function checkOwnership(owner: ProjectOwnerLookup, actorId: string): DebugGateDecision {
  if (owner.state === "VERIFIED" && owner.ownerId !== null) {
    if (owner.ownerId === actorId) return { decision: "ALLOW" };
    return {
      decision: "DENY",
      denial: "OWNERSHIP",
      reason: "Debug sessions may only be opened by the project owner.",
    };
  }
  return { decision: "DENY", denial: "OWNERSHIP", reason: ownershipUnverifiedReason(owner.state) };
}

export function ownershipUnverifiedReason(state: ProjectOwnerLookup["state"]): string {
  switch (state) {
    case "ABSENT":
      return "Project has no recorded owner. Debug sessions are not opened on an unowned project, and the Debugger never claims one.";
    case "RECOVERED_FROM_BACKUP":
      return "Project ownership was recovered from a backup and is not authorization-grade. Debug sessions are denied.";
    default:
      return "Project ownership could not be established. Debug sessions are denied (fail-closed).";
  }
}

export function checkDuplicateSession(hasActiveSessionForTarget: boolean): DebugGateDecision {
  if (hasActiveSessionForTarget) {
    return {
      decision: "DENY",
      denial: "DEBUG_SESSION_ALREADY_ACTIVE",
      reason: "A debug session is already active for this target. Attach to an existing session is not supported.",
    };
  }
  return { decision: "ALLOW" };
}

export interface DebugGateInput {
  readonly hostEnabled: boolean;
  readonly elevated: AtlasElevation;
  readonly environmentTier: ProjectEnvironmentTier | null;
  readonly owner: ProjectOwnerLookup;
  readonly actorId: string;
  readonly hasActiveSessionForTarget: boolean;
}

/** Orchestrates the approved gate order. Each step is independently testable above. */
export function evaluateDebugGate(input: DebugGateInput): DebugGateDecision {
  const host = checkHostEnabled(input.hostEnabled);
  if (host.decision === "DENY") return host;

  const p3 = checkP3(input.elevated);
  if (p3.decision === "DENY") return p3;

  const p2 = checkP2(input.environmentTier);
  if (p2.decision === "DENY") return p2;

  const ownership = checkOwnership(input.owner, input.actorId);
  if (ownership.decision === "DENY") return ownership;

  const duplicate = checkDuplicateSession(input.hasActiveSessionForTarget);
  if (duplicate.decision === "DENY") return duplicate;

  return { decision: "ALLOW" };
}

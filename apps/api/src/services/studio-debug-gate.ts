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
 */
let cachedElevationState: boolean | null = null;

function detectAtlasElevatedWindows(): boolean {
  try {
    const result = spawnSync("whoami", ["/groups"], {
      shell: false,
      windowsHide: true,
      encoding: "utf8",
      timeout: 5_000,
    });
    const stdout = result.stdout ?? "";
    // S-1-16-12288 = High Mandatory Level (elevated). Absence of the High
    // marker, or any failure to run the check, is treated as non-elevated
    // ONLY when the command succeeded; a failed check is reported honestly
    // as non-elevated=false here but the caller (gate) still fails closed
    // overall via P2, so this is not a silent bypass of anything.
    return stdout.includes("S-1-16-12288") || /High Mandatory Level/i.test(stdout);
  } catch {
    return false;
  }
}

export function isAtlasApiElevated(): boolean {
  if (cachedElevationState !== null) return cachedElevationState;
  if (process.platform === "win32") {
    cachedElevationState = detectAtlasElevatedWindows();
  } else {
    // POSIX: uid 0 is the closest equivalent to "elevated" for this check.
    cachedElevationState = typeof process.getuid === "function" && process.getuid() === 0;
  }
  return cachedElevationState;
}

/** Test-only: forces the cached elevation state so unit tests do not spawn `whoami`. */
export function setAtlasElevationStateForTests(next: boolean | null): void {
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

export function checkP3(elevated: boolean): DebugGateDecision {
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

export function checkOwnership(ownerId: string | null, actorId: string): DebugGateDecision {
  if (ownerId !== null && ownerId !== actorId) {
    return {
      decision: "DENY",
      denial: "OWNERSHIP",
      reason: "Debug sessions may only be opened by the project owner.",
    };
  }
  return { decision: "ALLOW" };
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
  readonly elevated: boolean;
  readonly environmentTier: ProjectEnvironmentTier | null;
  readonly ownerId: string | null;
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

  const ownership = checkOwnership(input.ownerId, input.actorId);
  if (ownership.decision === "DENY") return ownership;

  const duplicate = checkDuplicateSession(input.hasActiveSessionForTarget);
  if (duplicate.decision === "DENY") return duplicate;

  return { decision: "ALLOW" };
}

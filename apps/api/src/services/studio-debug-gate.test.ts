import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, afterEach } from "vitest";
import type { ProjectOwnerLookup } from "./project-access.js";
import {
  checkDuplicateSession,
  checkHostEnabled,
  checkOwnership,
  checkP2,
  checkP3,
  classifyWindowsElevationProbe,
  denyAgentDebugRequest,
  detectAtlasElevation,
  evaluateDebugGate,
  getAtlasElevation,
  isAgentDebugRequest,
  isDebuggerEnabledOnHost,
  readProjectEnvironmentTier,
  resetProjectEnvironmentTiersForTests,
  setAtlasElevationStateForTests,
  setProjectEnvironmentTierForTests,
} from "./studio-debug-gate.js";

const verified = (ownerId: string): ProjectOwnerLookup => ({ state: "VERIFIED", ownerId });

afterEach(() => {
  setAtlasElevationStateForTests(null);
  resetProjectEnvironmentTiersForTests();
});

describe("host opt-in (default OFF)", () => {
  it("is off when the variable is unset", () => {
    expect(isDebuggerEnabledOnHost({})).toBe(false);
  });

  it.each(["true", "0", "yes", "on", "", " 1", "1 "])("is off for the non-exact value %j", (value) => {
    expect(isDebuggerEnabledOnHost({ ATLAS_DEBUGGER_ENABLED: value })).toBe(false);
  });

  it("is on only for exactly \"1\"", () => {
    expect(isDebuggerEnabledOnHost({ ATLAS_DEBUGGER_ENABLED: "1" })).toBe(true);
  });

  it("checkHostEnabled(false) denies with DEBUGGER_DISABLED", () => {
    const result = checkHostEnabled(false);
    expect(result.decision).toBe("DENY");
    expect(result.decision === "DENY" && result.denial).toBe("DEBUGGER_DISABLED");
  });

  it("disabled host denies first, before any other check could run", () => {
    const result = evaluateDebugGate({
      hostEnabled: false,
      elevated: false,
      environmentTier: "DEVELOPMENT",
      owner: verified("actor-1"),
      actorId: "actor-1",
      hasActiveSessionForTarget: false,
    });
    expect(result.decision === "DENY" && result.denial).toBe("DEBUGGER_DISABLED");
  });

  it("enabling the host is NOT a bypass: every later gate still denies", () => {
    const base: Parameters<typeof evaluateDebugGate>[0] = {
      hostEnabled: true,
      elevated: false,
      environmentTier: "DEVELOPMENT",
      owner: verified("actor-1"),
      actorId: "actor-1",
      hasActiveSessionForTarget: false,
    };
    const denial = (patch: Partial<Parameters<typeof evaluateDebugGate>[0]>) => {
      const result = evaluateDebugGate({ ...base, ...patch });
      return result.decision === "DENY" ? result.denial : "ALLOW";
    };
    expect(denial({ elevated: true })).toBe("P3_CONFIGURATION_ERROR");
    expect(denial({ environmentTier: "PRODUCTION" })).toBe("P2_PRODUCTION_LINKED");
    expect(denial({ environmentTier: null })).toBe("P2_INSUFFICIENT_EVIDENCE");
    expect(denial({ actorId: "someone-else" })).toBe("OWNERSHIP");
    expect(denial({ owner: { state: "ABSENT", ownerId: null } })).toBe("OWNERSHIP");
    expect(denial({ owner: { state: "RECOVERED_FROM_BACKUP", ownerId: null } })).toBe("OWNERSHIP");
    expect(denial({ elevated: "UNKNOWN" })).toBe("P3_CONFIGURATION_ERROR");
    expect(denial({ hasActiveSessionForTarget: true })).toBe("DEBUG_SESSION_ALREADY_ACTIVE");
  });
});

describe("P2 test seam (production default must stay null)", () => {
  it("returns null for any project when nothing was set", () => {
    expect(readProjectEnvironmentTier("00000000-0000-4000-8000-000000000001")).toBeNull();
    expect(readProjectEnvironmentTier("anything")).toBeNull();
  });

  it("the setter only affects the project it was given, and reset restores null", () => {
    setProjectEnvironmentTierForTests("p-1", "DEVELOPMENT");
    expect(readProjectEnvironmentTier("p-1")).toBe("DEVELOPMENT");
    expect(readProjectEnvironmentTier("p-2")).toBeNull();
    resetProjectEnvironmentTiersForTests();
    expect(readProjectEnvironmentTier("p-1")).toBeNull();
  });

  it("setting a project back to null removes the override", () => {
    setProjectEnvironmentTierForTests("p-1", "STAGING");
    setProjectEnvironmentTierForTests("p-1", null);
    expect(readProjectEnvironmentTier("p-1")).toBeNull();
  });

  it("no non-test source file calls the *ForTests setter (it cannot be a production back door)", () => {
    const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (full.endsWith(".ts") && !full.endsWith(".test.ts")) {
          const text = readFileSync(full, "utf8");
          if (
            /setProjectEnvironmentTierForTests/.test(text) &&
            !full.endsWith(join("services", "studio-debug-gate.ts"))
          ) {
            offenders.push(full);
          }
        }
      }
    };
    walk(srcRoot);
    expect(offenders).toEqual([]);
  });
});

describe("Agent denial (human-only, same posture as PTY)", () => {
  it("classifies an agent actor header as Debugger-ineligible", () => {
    expect(isAgentDebugRequest({ "x-atlas-actor-kind": "AGENT" })).toBe(true);
    expect(isAgentDebugRequest({ "x-atlas-agent-id": "CODE_ENGINEER" })).toBe(true);
    expect(isAgentDebugRequest({ authorization: "Bearer human" })).toBe(false);
  });

  it("denyAgentDebugRequest throws a 403 FORBIDDEN", () => {
    expect(() => denyAgentDebugRequest()).toThrowError(/human-only/i);
  });
});

describe("checkP2 (production-linked / environment classification)", () => {
  it("denies PRODUCTION", () => {
    const result = checkP2("PRODUCTION");
    expect(result.decision).toBe("DENY");
    expect(result.decision === "DENY" && result.denial).toBe("P2_PRODUCTION_LINKED");
  });

  it("denies null as INSUFFICIENT_EVIDENCE, not ALLOW", () => {
    const result = checkP2(null);
    expect(result.decision).toBe("DENY");
    expect(result.decision === "DENY" && result.denial).toBe("P2_INSUFFICIENT_EVIDENCE");
  });

  it("allows an explicit DEVELOPMENT classification", () => {
    expect(checkP2("DEVELOPMENT").decision).toBe("ALLOW");
  });

  it("allows an explicit STAGING classification", () => {
    expect(checkP2("STAGING").decision).toBe("ALLOW");
  });
});

describe("checkP3 (Atlas self-elevation)", () => {
  it("denies when elevated — CONFIGURATION_ERROR", () => {
    const result = checkP3(true);
    expect(result.decision).toBe("DENY");
    expect(result.decision === "DENY" && result.denial).toBe("P3_CONFIGURATION_ERROR");
  });

  it("allows when verified not elevated", () => {
    expect(checkP3(false).decision).toBe("ALLOW");
  });

  it("denies when elevation is UNKNOWN (fail-closed), with a distinct reason", () => {
    const result = checkP3("UNKNOWN");
    expect(result.decision).toBe("DENY");
    expect(result.decision === "DENY" && result.denial).toBe("P3_CONFIGURATION_ERROR");
    expect(result.decision === "DENY" && result.reason).toMatch(/could not be verified/i);
  });
});

describe("elevation detection (failure and unknown never become 'not elevated')", () => {
  const MEDIUM = "Mandatory Label\\Medium Mandatory Level   Label   S-1-16-8192\n";
  const HIGH = "Mandatory Label\\High Mandatory Level   Label   S-1-16-12288\n";

  it("classifies a verified Medium integrity level as not elevated (existing behavior)", () => {
    expect(classifyWindowsElevationProbe({ status: 0, stdout: MEDIUM })).toBe(false);
  });

  it("classifies the High integrity level as elevated (existing denial behavior)", () => {
    expect(classifyWindowsElevationProbe({ status: 0, stdout: HIGH })).toBe(true);
  });

  it("classifies the High level by its localized-name-independent SID", () => {
    expect(classifyWindowsElevationProbe({ status: 0, stdout: "x S-1-16-12288\n" })).toBe(true);
  });

  it("a spawn error (including a timeout) is UNKNOWN", () => {
    const timeout = Object.assign(new Error("spawnSync whoami ETIMEDOUT"), { code: "ETIMEDOUT" });
    expect(classifyWindowsElevationProbe({ error: timeout, status: null, stdout: MEDIUM })).toBe("UNKNOWN");
  });

  it("a non-zero exit is UNKNOWN even if the output looks non-elevated", () => {
    expect(classifyWindowsElevationProbe({ status: 1, stdout: MEDIUM })).toBe("UNKNOWN");
  });

  it("a killed process (null status) is UNKNOWN", () => {
    expect(classifyWindowsElevationProbe({ status: null, stdout: MEDIUM })).toBe("UNKNOWN");
  });

  it.each([null, undefined, "", "unrelated output without an integrity level\n"])(
    "empty or unrecognized output %j is UNKNOWN",
    (stdout) => {
      expect(classifyWindowsElevationProbe({ status: 0, stdout })).toBe("UNKNOWN");
    },
  );

  it("an unrecognized integrity level is UNKNOWN", () => {
    expect(classifyWindowsElevationProbe({ status: 0, stdout: "S-1-16-9999\n" })).toBe("UNKNOWN");
  });

  const spawnReturning = (value: unknown) => (() => value) as unknown as typeof import("node:child_process").spawnSync;

  it("win32: a thrown spawn is UNKNOWN", () => {
    const env = {
      platform: "win32" as const,
      getuid: undefined,
      spawn: (() => {
        throw new Error("spawn failed");
      }) as unknown as typeof import("node:child_process").spawnSync,
    };
    expect(detectAtlasElevation(env)).toBe("UNKNOWN");
  });

  it("win32: passes the existing 5 second subprocess timeout and no shell", () => {
    let seen: Record<string, unknown> = {};
    const env = {
      platform: "win32" as const,
      getuid: undefined,
      spawn: ((_cmd: string, _args: string[], options: Record<string, unknown>) => {
        seen = options;
        return { status: 0, stdout: MEDIUM };
      }) as unknown as typeof import("node:child_process").spawnSync,
    };
    expect(detectAtlasElevation(env)).toBe(false);
    expect(seen.timeout).toBe(5_000);
    expect(seen.shell).toBe(false);
  });

  it("win32: a timed-out probe is UNKNOWN", () => {
    const env = {
      platform: "win32" as const,
      getuid: undefined,
      spawn: spawnReturning({ error: new Error("ETIMEDOUT"), status: null, stdout: "" }),
    };
    expect(detectAtlasElevation(env)).toBe("UNKNOWN");
  });

  it("POSIX: uid 0 is elevated, other uids are not, and a missing getuid is UNKNOWN", () => {
    const base = { platform: "linux" as const, spawn: spawnReturning({}) };
    expect(detectAtlasElevation({ ...base, getuid: () => 0 })).toBe(true);
    expect(detectAtlasElevation({ ...base, getuid: () => 1000 })).toBe(false);
    expect(detectAtlasElevation({ ...base, getuid: undefined })).toBe("UNKNOWN");
  });

  it("POSIX: a throwing getuid is UNKNOWN", () => {
    const env = {
      platform: "linux" as const,
      spawn: spawnReturning({}),
      getuid: () => {
        throw new Error("no uid");
      },
    };
    expect(detectAtlasElevation(env)).toBe("UNKNOWN");
  });

  it("the cached state is returned without re-detecting, and UNKNOWN is cached", () => {
    setAtlasElevationStateForTests("UNKNOWN");
    expect(getAtlasElevation()).toBe("UNKNOWN");
    setAtlasElevationStateForTests(false);
    expect(getAtlasElevation()).toBe(false);
  });

  it("UNKNOWN elevation denies the whole gate even when every other check would pass", () => {
    const result = evaluateDebugGate({
      hostEnabled: true,
      elevated: "UNKNOWN",
      environmentTier: "DEVELOPMENT",
      owner: verified("actor-1"),
      actorId: "actor-1",
      hasActiveSessionForTarget: false,
    });
    expect(result.decision === "DENY" && result.denial).toBe("P3_CONFIGURATION_ERROR");
  });
});

describe("checkOwnership (Debugger never claims; only an authorization-grade owner equal to the actor allows)", () => {
  it("denies a mismatched owner", () => {
    const result = checkOwnership(verified("owner-a"), "owner-b");
    expect(result.decision).toBe("DENY");
    expect(result.decision === "DENY" && result.denial).toBe("OWNERSHIP");
  });

  it("denies an absent owner (an unowned project is not claimed)", () => {
    const result = checkOwnership({ state: "ABSENT", ownerId: null }, "owner-b");
    expect(result.decision).toBe("DENY");
    expect(result.decision === "DENY" && result.denial).toBe("OWNERSHIP");
    expect(result.decision === "DENY" && result.reason).toMatch(/no recorded owner/i);
  });

  it.each(["MALFORMED", "UNAVAILABLE"] as const)("denies %s ownership (fail-closed)", (state) => {
    const result = checkOwnership({ state, ownerId: null }, "owner-b");
    expect(result.decision).toBe("DENY");
    expect(result.decision === "DENY" && result.reason).toMatch(/could not be established/i);
  });

  it("denies backup-recovered ownership even when it names the actor", () => {
    const result = checkOwnership({ state: "RECOVERED_FROM_BACKUP", ownerId: "owner-a" }, "owner-a");
    expect(result.decision).toBe("DENY");
    expect(result.decision === "DENY" && result.reason).toMatch(/backup/i);
  });

  it("denies a VERIFIED state that carries no owner id", () => {
    expect(checkOwnership({ state: "VERIFIED", ownerId: null }, "owner-a").decision).toBe("DENY");
  });

  it("allows the matching authorization-grade owner", () => {
    expect(checkOwnership(verified("owner-a"), "owner-a").decision).toBe("ALLOW");
  });
});

describe("checkDuplicateSession", () => {
  it("denies when a session is already active for the target", () => {
    const result = checkDuplicateSession(true);
    expect(result.decision).toBe("DENY");
    expect(result.decision === "DENY" && result.denial).toBe("DEBUG_SESSION_ALREADY_ACTIVE");
  });

  it("allows when no active session exists", () => {
    expect(checkDuplicateSession(false).decision).toBe("ALLOW");
  });
});

describe("evaluateDebugGate (approved order: P3 -> P2 -> ownership -> duplicate)", () => {
  it("P3 denies before any other check even if everything else would pass", () => {
    const result = evaluateDebugGate({
      hostEnabled: true,
      elevated: true,
      environmentTier: "DEVELOPMENT",
      owner: verified("actor-1"),
      actorId: "actor-1",
      hasActiveSessionForTarget: false,
    });
    expect(result.decision).toBe("DENY");
    expect(result.decision === "DENY" && result.denial).toBe("P3_CONFIGURATION_ERROR");
  });

  it("P2 INSUFFICIENT_EVIDENCE denies given today's real-world input (no environmentTier source)", () => {
    const result = evaluateDebugGate({
      hostEnabled: true,
      elevated: false,
      environmentTier: null,
      owner: verified("actor-1"),
      actorId: "actor-1",
      hasActiveSessionForTarget: false,
    });
    expect(result.decision).toBe("DENY");
    expect(result.decision === "DENY" && result.denial).toBe("P2_INSUFFICIENT_EVIDENCE");
  });

  it("ownership denies after P2/P3 pass", () => {
    const result = evaluateDebugGate({
      hostEnabled: true,
      elevated: false,
      environmentTier: "DEVELOPMENT",
      owner: verified("owner-a"),
      actorId: "someone-else",
      hasActiveSessionForTarget: false,
    });
    expect(result.decision).toBe("DENY");
    expect(result.decision === "DENY" && result.denial).toBe("OWNERSHIP");
  });

  it("duplicate-session denies after P2/P3/ownership pass", () => {
    const result = evaluateDebugGate({
      hostEnabled: true,
      elevated: false,
      environmentTier: "DEVELOPMENT",
      owner: verified("actor-1"),
      actorId: "actor-1",
      hasActiveSessionForTarget: true,
    });
    expect(result.decision).toBe("DENY");
    expect(result.decision === "DENY" && result.denial).toBe("DEBUG_SESSION_ALREADY_ACTIVE");
  });

  it("allows only when every gate passes", () => {
    const result = evaluateDebugGate({
      hostEnabled: true,
      elevated: false,
      environmentTier: "DEVELOPMENT",
      owner: verified("actor-1"),
      actorId: "actor-1",
      hasActiveSessionForTarget: false,
    });
    expect(result.decision).toBe("ALLOW");
  });
});

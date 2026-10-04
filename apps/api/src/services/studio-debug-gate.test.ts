import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, afterEach } from "vitest";
import {
  checkDuplicateSession,
  checkHostEnabled,
  checkOwnership,
  checkP2,
  checkP3,
  denyAgentDebugRequest,
  evaluateDebugGate,
  isAgentDebugRequest,
  isDebuggerEnabledOnHost,
  readProjectEnvironmentTier,
  resetProjectEnvironmentTiersForTests,
  setAtlasElevationStateForTests,
  setProjectEnvironmentTierForTests,
} from "./studio-debug-gate.js";

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
      ownerId: "actor-1",
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
      ownerId: "actor-1",
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

  it("allows when not elevated", () => {
    expect(checkP3(false).decision).toBe("ALLOW");
  });
});

describe("checkOwnership", () => {
  it("denies a mismatched owner", () => {
    const result = checkOwnership("owner-a", "owner-b");
    expect(result.decision).toBe("DENY");
    expect(result.decision === "DENY" && result.denial).toBe("OWNERSHIP");
  });

  it("allows when ownerId is null (unclaimed project)", () => {
    expect(checkOwnership(null, "owner-b").decision).toBe("ALLOW");
  });

  it("allows the matching owner", () => {
    expect(checkOwnership("owner-a", "owner-a").decision).toBe("ALLOW");
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
      ownerId: "actor-1",
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
      ownerId: "actor-1",
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
      ownerId: "owner-a",
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
      ownerId: "actor-1",
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
      ownerId: "actor-1",
      actorId: "actor-1",
      hasActiveSessionForTarget: false,
    });
    expect(result.decision).toBe("ALLOW");
  });
});

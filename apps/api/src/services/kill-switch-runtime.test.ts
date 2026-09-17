import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Task 7 -- Runtime Kill Switch Control: unit tests for the effective-state
 * merge helper itself (`kill-switch-runtime.ts`), isolated from any HTTP
 * route or `dispatchAgentAction` machinery. Proves the union semantics
 * directly against `@atlas/agent-core`'s real, UNMODIFIED
 * `firstActiveKillSwitch` / `listActiveKillSwitches` primitives.
 */
const tmpDir = mkdtempSync(join(tmpdir(), "atlas-kill-switch-runtime-test-"));
process.env.ATLAS_STORE_PATH = join(tmpDir, "store.json");
process.env.ATLAS_SKIP_STORE_PERSIST = "1";
process.env.ATLAS_SKIP_AUDIT_LOG = "1";

const { osStore } = await import("../store/os-store.js");
const {
  effectiveKillSwitchEnv,
  firstActiveEffectiveKillSwitch,
  listActiveEffectiveKillSwitches,
  getKillSwitchStatus,
  envBaselineCategories,
  runtimeOverrideCategories,
} = await import("./kill-switch-runtime.js");

describe("kill-switch-runtime effective-state resolution", () => {
  const ORIGINAL_ENV = process.env.ATLAS_KILL_SWITCHES;

  beforeEach(() => {
    osStore.unloadForTests();
    delete process.env.ATLAS_KILL_SWITCHES;
  });

  afterEach(() => {
    osStore.unloadForTests();
    if (ORIGINAL_ENV === undefined) {
      delete process.env.ATLAS_KILL_SWITCHES;
    } else {
      process.env.ATLAS_KILL_SWITCHES = ORIGINAL_ENV;
    }
  });

  it("with no env and no runtime override, effectiveKillSwitchEnv returns the real env object unchanged (no synthetic object)", () => {
    const env = effectiveKillSwitchEnv(process.env);
    expect(env).toBe(process.env);
  });

  it("env OFF + runtime ON => effective ACTIVE", () => {
    osStore.setKillSwitchOverride("agentDispatch", "op", "r");
    expect(firstActiveEffectiveKillSwitch()?.category).toBe("agentDispatch");
    expect(listActiveEffectiveKillSwitches()).toContain("agentDispatch");
  });

  it("env ON + runtime unset => effective ACTIVE", () => {
    process.env.ATLAS_KILL_SWITCHES = "agentDispatch";
    expect(firstActiveEffectiveKillSwitch()?.category).toBe("agentDispatch");
  });

  it("env ON + runtime ON (same category) => effective ACTIVE", () => {
    process.env.ATLAS_KILL_SWITCHES = "agentDispatch";
    osStore.setKillSwitchOverride("agentDispatch", "op", "r");
    expect(firstActiveEffectiveKillSwitch()?.category).toBe("agentDispatch");
  });

  it("env OFF + runtime OFF => effective INACTIVE", () => {
    expect(firstActiveEffectiveKillSwitch()).toBeNull();
    expect(listActiveEffectiveKillSwitches()).toEqual([]);
  });

  it("clearing the runtime override never subtracts from the env baseline (union, never override/subtraction)", () => {
    process.env.ATLAS_KILL_SWITCHES = "payments";
    osStore.setKillSwitchOverride("payments", "op", "r");
    osStore.clearKillSwitchOverride("payments", "op", "r2");
    expect(firstActiveEffectiveKillSwitch(["payments"])?.category).toBe("payments");
  });

  it("envBaselineCategories and runtimeOverrideCategories report their own layer only, independent of each other", () => {
    process.env.ATLAS_KILL_SWITCHES = "payments";
    osStore.setKillSwitchOverride("webhooksInbound", "op", "r");
    expect(envBaselineCategories().has("payments")).toBe(true);
    expect(envBaselineCategories().has("webhooksInbound")).toBe(false);
    expect(runtimeOverrideCategories().has("webhooksInbound")).toBe(true);
    expect(runtimeOverrideCategories().has("payments")).toBe(false);
  });

  it("getKillSwitchStatus distinguishes env-active, runtime-active, and both, per category", () => {
    process.env.ATLAS_KILL_SWITCHES = "payments";
    osStore.setKillSwitchOverride("webhooksInbound", "op", "compromised secret");

    const status = getKillSwitchStatus();
    const payments = status.find((s) => s.category === "payments");
    const webhooks = status.find((s) => s.category === "webhooksInbound");
    const aiWorkers = status.find((s) => s.category === "aiWorkers");

    expect(payments).toMatchObject({ envActive: true, runtimeOverrideActive: false, effectiveActive: true });
    expect(webhooks).toMatchObject({ envActive: false, runtimeOverrideActive: true, effectiveActive: true });
    expect(webhooks?.override).toMatchObject({ reason: "compromised secret", setBy: "op" });
    expect(aiWorkers).toMatchObject({ envActive: false, runtimeOverrideActive: false, effectiveActive: false, override: null });
  });

  it("an unrelated runtime override does not activate a category the caller did not declare", () => {
    osStore.setKillSwitchOverride("payments", "op", "r");
    expect(firstActiveEffectiveKillSwitch([])).toBeNull();
    expect(firstActiveEffectiveKillSwitch(["webhooksOutbound"])).toBeNull();
  });
});

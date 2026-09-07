import { describe, expect, it } from "vitest";
import {
  KILL_SWITCH_CATEGORIES,
  checkKillSwitch,
  firstActiveKillSwitch,
  isKillSwitchActive,
  listActiveKillSwitches,
} from "./kill-switches.js";

function envWith(raw: string | undefined): NodeJS.ProcessEnv {
  return raw === undefined ? {} : { ATLAS_KILL_SWITCHES: raw };
}

describe("kill switches", () => {
  it("is inactive for every category when the env var is unset", () => {
    for (const category of KILL_SWITCH_CATEGORIES) {
      expect(isKillSwitchActive(category, envWith(undefined))).toBe(false);
    }
    expect(listActiveKillSwitches(envWith(undefined))).toEqual([]);
  });

  it("activates exactly the listed categories, pipe-separated", () => {
    const env = envWith("payments|webhooksInbound");
    expect(isKillSwitchActive("payments", env)).toBe(true);
    expect(isKillSwitchActive("webhooksInbound", env)).toBe(true);
    expect(isKillSwitchActive("webhooksOutbound", env)).toBe(false);
    expect(isKillSwitchActive("agentDispatch", env)).toBe(false);
    expect(new Set(listActiveKillSwitches(env))).toEqual(
      new Set(["payments", "webhooksInbound"]),
    );
  });

  it("also accepts a comma-separated list", () => {
    const env = envWith("aiWorkers, payments");
    expect(isKillSwitchActive("aiWorkers", env)).toBe(true);
    expect(isKillSwitchActive("payments", env)).toBe(true);
  });

  it("ignores unknown tokens rather than activating anything or throwing", () => {
    const env = envWith("paymentsTypo|payments");
    expect(isKillSwitchActive("payments", env)).toBe(true);
    expect(listActiveKillSwitches(env)).toEqual(["payments"]);
  });

  it("checkKillSwitch reports the category alongside its active state", () => {
    const env = envWith("agentDispatch");
    expect(checkKillSwitch("agentDispatch", env)).toEqual({
      category: "agentDispatch",
      active: true,
    });
    expect(checkKillSwitch("payments", env)).toEqual({
      category: "payments",
      active: false,
    });
  });

  it("firstActiveKillSwitch always checks agentDispatch even with no additional categories", () => {
    const env = envWith("agentDispatch");
    expect(firstActiveKillSwitch([], env)).toEqual({
      category: "agentDispatch",
      active: true,
    });
  });

  it("firstActiveKillSwitch checks caller-declared categories in addition to agentDispatch", () => {
    const env = envWith("payments");
    expect(firstActiveKillSwitch(["payments"], env)).toEqual({
      category: "payments",
      active: true,
    });
    expect(firstActiveKillSwitch(["webhooksInbound"], env)).toBeNull();
  });

  it("firstActiveKillSwitch returns null when nothing relevant is active", () => {
    expect(firstActiveKillSwitch(["payments", "aiWorkers"], envWith(undefined))).toBeNull();
  });
});

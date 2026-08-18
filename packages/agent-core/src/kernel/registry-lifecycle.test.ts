import { beforeEach, describe, expect, it } from "vitest";
import { FABRIC_AGENT_IDS } from "@atlas/shared";
import {
  CORE_AGENT_IDS,
  isAgentEnabled,
  listAgentLifecycleState,
  resetAgentLifecycleForTests,
  setAgentEnabled,
} from "./registry-lifecycle.js";

beforeEach(() => {
  resetAgentLifecycleForTests();
});

describe("isAgentEnabled", () => {
  it("reports every catalog agent enabled by default", () => {
    for (const id of FABRIC_AGENT_IDS) {
      expect(isAgentEnabled(id)).toBe(true);
    }
  });
});

describe("setAgentEnabled", () => {
  it("disables a non-core agent and isAgentEnabled reflects it", () => {
    expect(CORE_AGENT_IDS.has("QA")).toBe(false);
    const result = setAgentEnabled("QA", false);
    expect(result).toEqual({ ok: true });
    expect(isAgentEnabled("QA")).toBe(false);
  });

  it("re-enables a previously disabled non-core agent", () => {
    setAgentEnabled("QA", false);
    expect(isAgentEnabled("QA")).toBe(false);
    const result = setAgentEnabled("QA", true);
    expect(result).toEqual({ ok: true });
    expect(isAgentEnabled("QA")).toBe(true);
  });

  it("refuses to disable a core agent, with a clear reason, and leaves it enabled", () => {
    for (const coreId of CORE_AGENT_IDS) {
      const result = setAgentEnabled(coreId, false);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason.length).toBeGreaterThan(0);
        expect(result.reason).toContain(coreId);
      }
      expect(isAgentEnabled(coreId)).toBe(true);
    }
  });

  it("allows re-enabling a core agent (enabling is never blocked)", () => {
    const result = setAgentEnabled("ORCHESTRATOR", true);
    expect(result).toEqual({ ok: true });
    expect(isAgentEnabled("ORCHESTRATOR")).toBe(true);
  });
});

describe("listAgentLifecycleState", () => {
  it("covers every real catalog agent id with correct core flags", () => {
    const items = listAgentLifecycleState();
    expect(items).toHaveLength(FABRIC_AGENT_IDS.length);
    const byId = new Map(items.map((item) => [item.agentId, item]));
    for (const id of FABRIC_AGENT_IDS) {
      const entry = byId.get(id);
      expect(entry).toBeDefined();
      expect(entry?.enabled).toBe(true);
      expect(entry?.core).toBe(CORE_AGENT_IDS.has(id));
    }
  });

  it("reflects a disabled non-core agent's state", () => {
    setAgentEnabled("QA", false);
    const items = listAgentLifecycleState();
    const qa = items.find((item) => item.agentId === "QA");
    expect(qa?.enabled).toBe(false);
    expect(qa?.core).toBe(false);
  });
});

describe("resetAgentLifecycleForTests", () => {
  it("actually resets all runtime overrides back to enabled", () => {
    setAgentEnabled("QA", false);
    setAgentEnabled("DEBUGGER", false);
    expect(isAgentEnabled("QA")).toBe(false);
    expect(isAgentEnabled("DEBUGGER")).toBe(false);

    resetAgentLifecycleForTests();

    expect(isAgentEnabled("QA")).toBe(true);
    expect(isAgentEnabled("DEBUGGER")).toBe(true);
    for (const item of listAgentLifecycleState()) {
      expect(item.enabled).toBe(true);
    }
  });
});

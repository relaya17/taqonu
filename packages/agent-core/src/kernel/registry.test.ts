import { describe, expect, it } from "vitest";
import { FABRIC_AGENT_IDS } from "@atlas/shared";
import { getRegisteredAgent, listRegisteredAgents } from "./registry.js";

describe("agent registry", () => {
  it("lists exactly the fabric agent catalog, one entry per id", () => {
    const items = listRegisteredAgents();
    expect(items).toHaveLength(FABRIC_AGENT_IDS.length);
    expect(new Set(items.map((a) => a.id)).size).toBe(FABRIC_AGENT_IDS.length);
  });

  it("gives JUDGE and ORCHESTRATOR their expected extra permissions", () => {
    const judge = getRegisteredAgent("JUDGE");
    expect(judge.permissions).toContain("JUDGE");
    const orchestrator = getRegisteredAgent("ORCHESTRATOR");
    expect(orchestrator.permissions).toContain("ORCHESTRATE");
  });

  it("never grants APPLY_PATCH to any agent (only PROPOSE_PATCH is allowed, per ADR-015)", () => {
    for (const id of FABRIC_AGENT_IDS) {
      const agent = getRegisteredAgent(id);
      expect(agent.permissions).not.toContain("APPLY_PATCH");
    }
  });

  it("write-capable agents (CODE_ENGINEER/DEBUGGER/TEST_ENGINEER) get PROPOSE_PATCH", () => {
    for (const id of ["CODE_ENGINEER", "DEBUGGER", "TEST_ENGINEER"] as const) {
      const agent = getRegisteredAgent(id);
      expect(agent.permissions).toContain("PROPOSE_PATCH");
    }
  });

  it("every registered agent always allows INSUFFICIENT_EVIDENCE and refuses hallucination", () => {
    for (const id of FABRIC_AGENT_IDS) {
      const agent = getRegisteredAgent(id);
      expect(agent.evidencePolicy.allowInsufficient).toBe(true);
      expect(agent.evidencePolicy.refuseHallucination).toBe(true);
    }
  });

  it("JUDGE and SECURITY require higher minAuthority than the default", () => {
    expect(getRegisteredAgent("JUDGE").evidencePolicy.minAuthority).toBe(0.7);
    expect(getRegisteredAgent("SECURITY").evidencePolicy.minAuthority).toBe(0.7);
    expect(getRegisteredAgent("ARCHITECT").evidencePolicy.minAuthority).toBe(0.4);
  });
});

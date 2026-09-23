import { describe, expect, it } from "vitest";
import {
  classifyApplicationAgentObservation,
  isReservedApplicationAgentId,
  parseApplicationExpectedAgentIds,
} from "./application-agent-observation.js";

describe("CTRL-018 application Agent observation", () => {
  it("Case 1 — null observed is UNKNOWN", () => {
    const result = classifyApplicationAgentObservation({
      observedAgentId: null,
      expectedAgentIds: ["agent.cio"],
    });
    expect(result).toEqual({
      observation: "UNKNOWN",
      reserved: false,
      observedAgentId: null,
    });
  });

  it("Case 2 — no Expected declaration and non-null observed is UNKNOWN", () => {
    const result = classifyApplicationAgentObservation({
      observedAgentId: "agent.cio",
      expectedAgentIds: null,
    });
    expect(result.observation).toBe("UNKNOWN");
    expect(result.reserved).toBe(false);
  });

  it("Case 3 — observed member of Expected set is EXPECTED", () => {
    const result = classifyApplicationAgentObservation({
      observedAgentId: "agent.cio",
      expectedAgentIds: ["agent.cio"],
    });
    expect(result.observation).toBe("EXPECTED");
  });

  it("Case 4 — observed outside Expected set is UNEXPECTED", () => {
    const result = classifyApplicationAgentObservation({
      observedAgentId: "agent.other",
      expectedAgentIds: ["agent.cio"],
    });
    expect(result.observation).toBe("UNEXPECTED");
  });

  it("Case 5 — multiple Expected IDs: one member is EXPECTED", () => {
    const result = classifyApplicationAgentObservation({
      observedAgentId: "agent.kashrut",
      expectedAgentIds: ["agent.cio", "agent.kashrut"],
    });
    expect(result.observation).toBe("EXPECTED");
  });

  it("Case 6 — explicitly empty Expected set is UNKNOWN, not UNEXPECTED", () => {
    expect(parseApplicationExpectedAgentIds("")).toEqual([]);
    expect(parseApplicationExpectedAgentIds("   ")).toEqual([]);
    const result = classifyApplicationAgentObservation({
      observedAgentId: "agent.cio",
      expectedAgentIds: [],
    });
    expect(result.observation).toBe("UNKNOWN");
  });

  it("Case 7 — reserved identities are not UNEXPECTED", () => {
    expect(isReservedApplicationAgentId("ORCHESTRATOR")).toBe(true);
    expect(isReservedApplicationAgentId("psa:00000000-0000-4000-8000-000000000001")).toBe(
      true,
    );
    expect(isReservedApplicationAgentId("cp:service")).toBe(true);
    expect(
      classifyApplicationAgentObservation({
        observedAgentId: "ORCHESTRATOR",
        expectedAgentIds: ["agent.cio"],
      }).observation,
    ).toBeNull();
    expect(
      classifyApplicationAgentObservation({
        observedAgentId: "ORCHESTRATOR",
        expectedAgentIds: ["agent.cio"],
      }).reserved,
    ).toBe(true);
  });

  it("does not invent Expected from a missing declaration", () => {
    expect(parseApplicationExpectedAgentIds(undefined)).toBeNull();
  });
});

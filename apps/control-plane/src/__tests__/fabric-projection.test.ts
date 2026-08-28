import { describe, expect, it } from "vitest";
import { FABRIC_AGENT_IDS } from "@atlas/shared";
import { listRegisteredAgents } from "../services/agent-registry.js";
import { getFabricProjection } from "../services/fabric-projection.js";

describe("Control Plane fabric projection (Phase 11.6)", () => {
  it("does not merge Fabric IDs into AGENT_DEFINITIONS", () => {
    const legacy = listRegisteredAgents();
    expect(legacy).toHaveLength(9);
    const projection = getFabricProjection();
    expect(projection.items.map((i) => i.agentId)).toEqual([...FABRIC_AGENT_IDS]);
    expect(legacy.map((a) => a.agentId)).not.toEqual([...FABRIC_AGENT_IDS]);
  });

  it("never defaults the projection to ACTIVE", () => {
    for (const item of getFabricProjection().items) {
      expect(item.catalogStatus).toBe("LAB");
      expect(item.executionEnabledByThisProjection).toBe(false);
    }
  });
});

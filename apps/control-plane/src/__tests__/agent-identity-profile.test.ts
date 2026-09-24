import { describe, expect, it } from "vitest";
import { FABRIC_AGENT_IDS, PERSONAL_SUPERVISING_AGENT_CLASS } from "@atlas/shared";
import { listRegisteredAgents } from "../services/agent-registry.js";
import {
  controlProfileGrantsExecution,
  getControlAgentProfile,
  listControlAgentProfiles,
  portfolioMetadataGrantsExecution,
  unprovenCaseflowAgent,
} from "../services/agent-identity-profile.js";

describe("control agent identity profiles", () => {
  const profiles = listControlAgentProfiles();

  it("keeps Fabric, oversight, and PSA as separate identity sources", () => {
    const fabric = profiles.filter((profile) => profile.identitySource === "FABRIC");
    const oversight = profiles.filter(
      (profile) => profile.identitySource === "CONTROL_OVERSIGHT",
    );
    expect(fabric.map((profile) => profile.agentId)).toEqual([...FABRIC_AGENT_IDS]);
    expect(oversight).toHaveLength(listRegisteredAgents().length);
    expect(oversight).toHaveLength(9);
    expect(getControlAgentProfile("PSA", PERSONAL_SUPERVISING_AGENT_CLASS)?.personalScope).toBe(
      true,
    );
    expect(
      getControlAgentProfile("PSA", PERSONAL_SUPERVISING_AGENT_CLASS)?.professionalScope,
    ).toBe(false);
    expect(getControlAgentProfile("FABRIC", "CODE_ENGINEER")?.identitySource).toBe("FABRIC");
    expect(getControlAgentProfile("CONTROL_OVERSIGHT", "CODE_ENGINEER")?.identitySource).toBe(
      "CONTROL_OVERSIGHT",
    );
  });

  it("does not promote portfolio keys or CaseFlow null into a runtime agent", () => {
    expect(profiles.some((profile) => profile.agentId.startsWith("CF-AG-"))).toBe(false);
    expect(profiles.some((profile) => profile.identitySource === "PORTFOLIO_OBSERVATION")).toBe(
      false,
    );
    const caseflow = unprovenCaseflowAgent();
    expect(caseflow.applicationId).toBe("caseflow");
    expect(caseflow.agentId).toBeNull();
    expect(portfolioMetadataGrantsExecution()).toBe(false);
  });

  it("does not grant execution, personal memory, or a fabricated owner from a profile", () => {
    for (const profile of profiles) {
      expect(controlProfileGrantsExecution(profile)).toBe(false);
      expect(profile.executionAuthorityGrantedByProfile).toBe(false);
      expect(profile.bypassesApproval).toBe(false);
      expect(profile.bypassesKillSwitch).toBe(false);
      expect(profile.maySelfApprove).toBe(false);
      expect(profile.memory.canWritePersonalMemory).toBe(false);
      expect(profile.memory.storeDefaultOpenUnchanged).toBe(true);
    }
    const legal = getControlAgentProfile("FABRIC", "LEGAL_MEDIA_COMMS");
    expect(legal?.personalScope).toBe(false);
    expect(legal?.memory.canReadPersonalMemory).toBe(false);
    expect(legal?.ownerId).toBeNull();
    const hotel = getControlAgentProfile("APPLICATION", "agent.cio");
    expect(hotel?.runtimeProven).toBe(false);
    expect(hotel?.scopeEvidence).toBe("NOT_PROVEN");
    expect(hotel?.memory.canReadPersonalMemory).toBe(false);
    const psa = getControlAgentProfile("PSA", PERSONAL_SUPERVISING_AGENT_CLASS);
    expect(psa?.ownerId).toBeNull();
    expect(psa?.runtimeReference).toBe("psa:<ownerId>");
    expect(psa?.memory.memoryOwner).toBe("USER");
    expect(psa?.memory.canReadPersonalMemory).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { FABRIC_AGENT_IDS } from "../constants/agents.js";
import {
  PERSONAL_SUPERVISING_AGENT_CLASS,
  isFabricSpecialistId,
  isPersonalSupervisingAgentId,
  personalSupervisingAgentId,
  presentedScopeWithin,
  scopeAllows,
} from "./personal-supervising-agent.js";

const OWNER = "11111111-1111-4111-8111-111111111111";

const scope = {
  ownerId: OWNER,
  tenantId: "tenant-alpha",
  projectIds: ["project-alpha"],
  applicationIds: ["civio"],
};

describe("Personal Supervising Agent contract", () => {
  it("is a distinct class, not a Fabric catalog id", () => {
    expect(FABRIC_AGENT_IDS).not.toContain(PERSONAL_SUPERVISING_AGENT_CLASS);
    expect(PERSONAL_SUPERVISING_AGENT_CLASS).not.toBe("ORCHESTRATOR");
    expect(isFabricSpecialistId("ORCHESTRATOR")).toBe(true);
    expect(isFabricSpecialistId(PERSONAL_SUPERVISING_AGENT_CLASS)).toBe(false);
    expect(FABRIC_AGENT_IDS).toHaveLength(16);
  });

  it("stable id is not the authorization scope", () => {
    const id = personalSupervisingAgentId(OWNER);
    expect(id).toBe(`psa:${OWNER}`);
    expect(isPersonalSupervisingAgentId(id)).toBe(true);
    expect(
      scopeAllows(scope, {
        tenantId: "tenant-beta",
        projectId: "project-alpha",
        applicationId: "civio",
      }),
    ).toBe(false);
    expect(
      scopeAllows(scope, {
        tenantId: "tenant-alpha",
        projectId: "project-alpha",
        applicationId: "civio",
      }),
    ).toBe(true);
  });

  it("rejects cross-project and cross-application records", () => {
    expect(
      scopeAllows(scope, {
        tenantId: "tenant-alpha",
        projectId: "project-beta",
        applicationId: "civio",
      }),
    ).toBe(false);
    expect(
      scopeAllows(scope, {
        tenantId: "tenant-alpha",
        projectId: "project-alpha",
        applicationId: "hotelos",
      }),
    ).toBe(false);
  });

  it("does not let a later call expand persisted owner/scope", () => {
    expect(
      presentedScopeWithin(scope, {
        tenantId: "tenant-alpha",
        projectIds: ["project-alpha"],
        applicationIds: ["civio"],
      }),
    ).toBe(true);
    expect(
      presentedScopeWithin(scope, {
        tenantId: "tenant-beta",
        projectIds: ["project-alpha"],
        applicationIds: ["civio"],
      }),
    ).toBe(false);
    expect(
      presentedScopeWithin(scope, {
        tenantId: "tenant-alpha",
        projectIds: ["project-beta"],
        applicationIds: ["civio"],
      }),
    ).toBe(false);
    expect(
      presentedScopeWithin(scope, {
        tenantId: "tenant-alpha",
        projectIds: ["project-alpha"],
        applicationIds: ["hotelos"],
      }),
    ).toBe(false);
  });
});

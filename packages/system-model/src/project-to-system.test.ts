import { describe, expect, it } from "vitest";
import {
  ATLAS_SELF_SYSTEM_ID,
  type Project,
} from "@atlas/shared";
import { actAllowed, nextControlPhase } from "./control-loop.js";
import {
  atlasSelfManagedSystem,
  postureFromVerdict,
  projectToManagedSystem,
} from "./project-to-system.js";
import { defaultSystemContract } from "./system-contract.js";

const PROJECT: Project = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "vantera",
  name: "Vantera",
  description: null,
  status: "ACTIVE",
  techStack: ["next"],
  createdAt: "2026-08-15T00:00:00.000Z",
  updatedAt: "2026-08-15T00:00:00.000Z",
};

describe("ManagedSystem projection", () => {
  it("lifts a customer project without rewriting it", () => {
    const system = projectToManagedSystem({
      project: PROJECT,
      verdictHint: "CONDITIONAL",
      mediumRisks: 2,
      asOf: "2026-08-15T12:00:00.000Z",
    });
    expect(system.kind).toBe("CUSTOMER");
    expect(system.posture).toBe("WATCH");
    expect(system.projectId).toBe(PROJECT.id);
    expect(system.selfManaged).toBe(false);
  });

  it("marks BrokerOS as a lab system", () => {
    const system = projectToManagedSystem({
      project: { ...PROJECT, slug: "brokeros", name: "BrokerOS" },
    });
    expect(system.kind).toBe("LAB");
  });

  it("includes Atlas as a self-managed system", () => {
    const self = atlasSelfManagedSystem({
      asOf: "2026-08-15T12:00:00.000Z",
    });
    expect(self.id).toBe(ATLAS_SELF_SYSTEM_ID);
    expect(self.kind).toBe("ATLAS_SELF");
    expect(self.selfManaged).toBe(true);
  });

  it("blocks ACT until verify + policy + approval", () => {
    expect(
      actAllowed({
        phase: "ACT",
        verified: true,
        policyAllows: true,
        approvalGranted: false,
      }),
    ).toBe(false);
    expect(nextControlPhase("DISCOVER")).toBe("UNDERSTAND");
    expect(nextControlPhase("ACT")).toBeNull();
  });

  it("emits a proposed system contract", () => {
    const system = projectToManagedSystem({ project: PROJECT });
    const contract = defaultSystemContract(system, "2026-08-15T12:00:00.000Z");
    expect(contract.systemId).toBe(system.id);
    expect(contract.epistemicState).toBe("PROPOSED");
    expect(contract.approvalPolicies.length).toBeGreaterThan(0);
  });
});

describe("postureFromVerdict", () => {
  it("maps blocked verdict to blocked posture", () => {
    expect(postureFromVerdict("BLOCKED")).toBe("BLOCKED");
    expect(postureFromVerdict("READY")).toBe("CLEAR");
  });
});

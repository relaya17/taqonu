import { describe, expect, it } from "vitest";
import { FABRIC_AGENT_IDS } from "@atlas/shared";
import { buildPsaGovernedRequest } from "./psa-governed-request";

const base = {
  ownerId: "00000000-0000-4000-8000-000000000001",
  projectId: "00000000-0000-4000-8000-000000000002",
  reason: "Look at the open finding",
  now: "2026-09-26T00:00:00.000Z",
  taskId: "00000000-0000-4000-8000-000000000003",
  evidenceId: "00000000-0000-4000-8000-000000000004",
};

describe("buildPsaGovernedRequest", () => {
  it("uses a Fabric specialist id and marks the statement PROPOSED", () => {
    const body = buildPsaGovernedRequest({
      ...base,
      specialistId: "RESEARCHER",
    });
    expect(body.agentId).toBe("RESEARCHER");
    expect(FABRIC_AGENT_IDS).toContain(body.agentId);
    expect(body.agentId).not.toMatch(/^psa:/);
    expect(body.action).toEqual({ entityType: "RECORD", action: "READ" });
    expect(body.evidence[0]?.epistemicState).toBe("PROPOSED");
    expect(body.claims).toEqual([base.reason]);
  });

  it("rejects the personal agent id and an unknown specialist", () => {
    expect(() =>
      buildPsaGovernedRequest({
        ...base,
        specialistId: "psa:00000000-0000-4000-8000-000000000001",
      }),
    ).toThrow(/Fabric specialist/);
    expect(() =>
      buildPsaGovernedRequest({ ...base, specialistId: "CODE_ENGINEER_CLONE" }),
    ).toThrow(/Fabric specialist/);
  });
});

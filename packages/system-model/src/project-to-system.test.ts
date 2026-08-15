import { describe, expect, it } from "vitest";
import {
  ATLAS_SELF_SYSTEM_ID,
  type Project,
} from "@atlas/shared";
import { actAllowed, deriveControlLoopPhase, nextControlPhase } from "./control-loop.js";
import { facetsFromSignals } from "./facet-signals.js";
import {
  atlasSelfManagedSystem,
  postureFromVerdict,
  projectToManagedSystem,
} from "./project-to-system.js";
import {
  defaultLedgerInvariant,
  defaultSystemContract,
  verifySystemInvariants,
} from "./system-contract.js";

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

describe("facetsFromSignals", () => {
  it("marks only observed counts as present", () => {
    const facets = facetsFromSignals({
      hasIdentity: true,
      repoCount: 1,
      environmentCount: 0,
      serviceCount: 2,
      databaseCount: 0,
      integrationCount: 1,
      deploymentCount: 3,
      workerCount: 0,
      jobCount: 0,
      apiCount: 0,
      secretsMetadataCount: 1,
      policyCount: 0,
      evidenceCount: 4,
      riskCount: 0,
      decisionCount: 0,
      incidentCount: 0,
      healthObserved: true,
    });
    expect(facets.identity).toBe(1);
    expect(facets.repositories).toBe(1);
    expect(facets.environments).toBe(0);
    expect(facets.deployments).toBe(3);
    expect(facets.health).toBe(1);
  });
});

describe("deriveControlLoopPhase", () => {
  it("stays in DISCOVER until a repo or evidence exists", () => {
    expect(
      deriveControlLoopPhase({
        hasRepos: false,
        evidenceCount: 0,
        healthObserved: false,
        contractState: "PROPOSED",
        invariantOverall: "UNKNOWN",
        posture: "UNKNOWN",
      }).phase,
    ).toBe("DISCOVER");
  });

  it("reaches ACT only after confirmed contract + passing invariants", () => {
    const ready = deriveControlLoopPhase({
      hasRepos: true,
      evidenceCount: 4,
      healthObserved: true,
      contractState: "CONFIRMED",
      invariantOverall: "PASS",
      posture: "WATCH",
    });
    expect(ready.phase).toBe("ACT");
    expect(ready.actEligible).toBe(true);

    const blocked = deriveControlLoopPhase({
      hasRepos: true,
      evidenceCount: 4,
      healthObserved: true,
      contractState: "CONFIRMED",
      invariantOverall: "PASS",
      posture: "BLOCKED",
    });
    expect(blocked.actEligible).toBe(false);
    expect(blocked.phase).toBe("VERIFY");
  });
});

describe("verifySystemInvariants", () => {
  it("fails a confirmed contract when required evidence is missing", () => {
    const system = projectToManagedSystem({ project: PROJECT });
    const contract = {
      ...defaultSystemContract(system, "2026-08-15T12:00:00.000Z"),
      financialInvariants: [defaultLedgerInvariant()],
      epistemicState: "CONFIRMED" as const,
    };
    const result = verifySystemInvariants({
      contract,
      evidenceTokens: ["github", "git"],
      asOf: "2026-08-15T12:00:00.000Z",
    });
    expect(result.overall).toBe("FAIL");
    expect(result.results[0]?.missingEvidence).toContain("stripe-webhook");
  });

  it("passes when every required token is observed", () => {
    const system = projectToManagedSystem({ project: PROJECT });
    const contract = {
      ...defaultSystemContract(system, "2026-08-15T12:00:00.000Z"),
      financialInvariants: [defaultLedgerInvariant()],
      epistemicState: "CONFIRMED" as const,
    };
    const result = verifySystemInvariants({
      contract,
      evidenceTokens: ["stripe-webhook", "ledger-row", "worker-run"],
      asOf: "2026-08-15T12:00:00.000Z",
    });
    expect(result.overall).toBe("PASS");
  });
});

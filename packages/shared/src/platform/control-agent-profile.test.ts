import { describe, expect, it } from "vitest";
import { FABRIC_AGENT_IDS } from "../constants/agents.js";
import { agentMayExecute } from "../constants/operating-cycle.js";
import {
  CONTROL_PROFILE_TEST_FIXTURE_AGENT_ID,
  controlGovernedKnowledgeAllows,
  controlGovernedMemoryAllows,
  controlKnowledgeDecisionForProfile,
  controlMemoryDecisionForProfile,
  controlProfileTestFixture,
  defineControlAgentProfile,
  governanceProfileForAgentId,
  memoryGovernanceForScopes,
  portfolioObservationGrantsExecution,
  representUnprovenApplicationAgent,
} from "./control-agent-profile.js";

function example(personal: boolean, professional: boolean, domain: string | null) {
  return defineControlAgentProfile({
    identitySource: "APPLICATION",
    agentId: "example.legal",
    displayName: "Example",
    applicationId: "example",
    ownerId: personal ? "owner-1" : null,
    personalScope: personal,
    professionalScope: professional,
    scopeEvidence: "DECLARED",
    domain,
    runtimeReference: null,
    modelReference: null,
    providerReference: null,
    listedStatus: "DECLARED",
    lifecycleAuthority: "NONE",
    runtimeProven: false,
    version: null,
    provenance: "test",
    supervisorAgentId: null,
    supervisorType: "NONE",
    capabilityRef: null,
    riskRef: null,
  });
}

describe("control agent profile", () => {
  it("represents all four personal/professional combinations on one identity", () => {
    const neither = example(false, false, null);
    const personal = example(true, false, null);
    const professional = example(false, true, "LEGAL");
    const both = example(true, true, "LEGAL");
    expect(both.agentId).toBe(personal.agentId);
    expect(both.personalScope && both.professionalScope).toBe(true);
    expect(professional.personalScope).toBe(false);
    expect(personal.professionalScope).toBe(false);
    expect(neither.personalScope || neither.professionalScope).toBe(false);
  });

  it("does not grant personal memory to a professional-only profile", () => {
    const professional = example(false, true, "LEGAL");
    expect(professional.memory.canReadPersonalMemory).toBe(false);
    expect(professional.memory.canWritePersonalMemory).toBe(false);
    expect(professional.memory.canPersistPersonalData).toBe(false);
    expect(professional.memory.canReadProfessionalKnowledge).toBe(true);
    expect(professional.memory.memoryOwner).toBe("NONE");
  });

  it("allows personal memory read for a personal profile without making the agent the owner", () => {
    const personal = example(true, false, null);
    expect(personal.memory.canReadPersonalMemory).toBe(true);
    expect(personal.memory.canWritePersonalMemory).toBe(false);
    expect(personal.memory.memoryOwner).toBe("USER");
    expect(personal.memory.storeDefaultOpenUnchanged).toBe(true);
  });

  it("keeps personal and professional knowledge separate on a combined profile", () => {
    const both = memoryGovernanceForScopes({
      personalScope: true,
      professionalScope: true,
      scopeEvidence: "DECLARED",
    });
    expect(both.canReadPersonalMemory).toBe(true);
    expect(both.canReadProfessionalKnowledge).toBe(true);
    expect(both.canWriteProfessionalKnowledge).toBe(false);
  });

  it("does not treat an application id or a null agent id as an agent", () => {
    const missing = representUnprovenApplicationAgent({
      applicationId: "caseflow",
      agentId: null,
    });
    expect(missing.kind).toBe("NOT_AN_AGENT");
    expect(missing.agentId).toBeNull();
    expect(missing.executionAuthorityGrantedByProfile).toBe(false);
  });

  it("does not let a profile, portfolio row, or revoked status grant execution or self-approval", () => {
    const profile = example(true, true, "LEGAL");
    expect(profile.executionAuthorityGrantedByProfile).toBe(false);
    expect(profile.bypassesApproval).toBe(false);
    expect(profile.bypassesKillSwitch).toBe(false);
    expect(profile.maySelfApprove).toBe(false);
    expect(portfolioObservationGrantsExecution()).toBe(false);
    expect(agentMayExecute("REVOKED")).toBe(false);
    expect(FABRIC_AGENT_IDS).toHaveLength(16);
  });

  it("does not grant memory from an unproven scope", () => {
    const access = memoryGovernanceForScopes({
      personalScope: false,
      professionalScope: false,
      scopeEvidence: "NOT_PROVEN",
    });
    expect(access.canReadPersonalMemory).toBe(false);
    expect(access.canReadProfessionalKnowledge).toBe(false);
  });

  it("resolves catalog identities without granting write, persist, or execution", () => {
    const fabric = governanceProfileForAgentId("ORCHESTRATOR");
    const oversight = governanceProfileForAgentId("QA_ENGINEER");
    const psa = governanceProfileForAgentId("psa:owner-1");
    const hotel = governanceProfileForAgentId("agent.cio");
    const legacy = governanceProfileForAgentId("legacy-plugin");
    expect(fabric?.identitySource).toBe("FABRIC");
    expect(fabric?.personalScope).toBe(false);
    expect(fabric?.professionalScope).toBe(true);
    expect(oversight?.identitySource).toBe("CONTROL_OVERSIGHT");
    expect(psa?.identitySource).toBe("PSA");
    expect(psa?.agentId).toBe("PERSONAL_SUPERVISING_AGENT");
    expect(psa?.supervisorAgentId).toBeNull();
    expect(psa?.supervisorType).toBe("HUMAN");
    expect(hotel?.scopeEvidence).toBe("NOT_PROVEN");
    expect(legacy).toBeNull();
    expect(controlGovernedMemoryAllows("ORCHESTRATOR", "read").allowed).toBe(false);
    expect(controlGovernedMemoryAllows("ORCHESTRATOR", "write").allowed).toBe(false);
    expect(controlGovernedMemoryAllows("ORCHESTRATOR", "persist").allowed).toBe(false);
    expect(controlGovernedMemoryAllows("psa:owner-1", "read").allowed).toBe(true);
    expect(controlGovernedMemoryAllows("psa:owner-1", "write").allowed).toBe(false);
    expect(controlGovernedMemoryAllows("psa:owner-1", "persist").allowed).toBe(false);
    expect(controlGovernedKnowledgeAllows("ORCHESTRATOR").allowed).toBe(true);
    expect(controlGovernedKnowledgeAllows("psa:owner-1").allowed).toBe(false);
    expect(controlGovernedKnowledgeAllows("agent.cio").allowed).toBe(false);
    expect(controlGovernedMemoryAllows("legacy-plugin", "read").governed).toBe(false);
    expect(controlGovernedMemoryAllows(undefined, "read").governed).toBe(false);
    expect(fabric?.executionAuthorityGrantedByProfile).toBe(false);
    expect(fabric?.ownerId).toBeNull();
    expect(fabric?.memory.memoryOwner).toBe("NONE");
    expect(psa?.memory.memoryOwner).toBe("USER");
  });

  it("keeps supervisor agent id null when no authoritative supervisor agent exists", () => {
    const fabric = governanceProfileForAgentId("CODE_ENGINEER");
    const psa = governanceProfileForAgentId("PERSONAL_SUPERVISING_AGENT");
    expect(fabric?.supervisorType).toBe("NONE");
    expect(fabric?.supervisorAgentId).toBeNull();
    expect(psa?.supervisorType).toBe("HUMAN");
    expect(psa?.supervisorAgentId).toBeNull();
    expect(psa?.supervisorAgentId).not.toBe(psa?.agentId);
    expect(psa?.ownerId).toBeNull();
    expect(fabric?.agentId).not.toBe(fabric?.ownerId);
  });

  it("runs one test-fixture identity through the production memory and knowledge decisions", () => {
    const profile = controlProfileTestFixture();
    expect(profile.provenance).toBe("TEST FIXTURE");
    expect(profile.agentId).toBe(CONTROL_PROFILE_TEST_FIXTURE_AGENT_ID);
    expect(profile.personalScope).toBe(true);
    expect(profile.professionalScope).toBe(true);
    expect(governanceProfileForAgentId(profile.agentId)).toBeNull();
    expect(FABRIC_AGENT_IDS).not.toContain(profile.agentId);
    const personalRead = controlMemoryDecisionForProfile(profile, "read");
    const personalWrite = controlMemoryDecisionForProfile(profile, "write");
    const personalPersist = controlMemoryDecisionForProfile(profile, "persist");
    const knowledge = controlKnowledgeDecisionForProfile(profile);
    expect(personalRead.profile?.agentId).toBe(profile.agentId);
    expect(knowledge.profile?.agentId).toBe(profile.agentId);
    expect(personalRead.allowed).toBe(true);
    expect(knowledge.allowed).toBe(true);
    expect(personalWrite.allowed).toBe(false);
    expect(personalPersist.allowed).toBe(false);
    expect(knowledge.profile?.memory.canWriteProfessionalKnowledge).toBe(false);
    expect(profile.ownerId).toBeNull();
    expect(profile.applicationId).toBe("test-fixture");
    expect(profile.applicationId).not.toBe(profile.agentId);
    expect(profile.supervisorAgentId).toBeNull();
    expect(profile.executionAuthorityGrantedByProfile).toBe(false);
  });
});

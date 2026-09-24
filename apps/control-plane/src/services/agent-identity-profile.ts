/**
 * Control governance profiles for identities that already exist.
 * Does not merge Fabric, the legacy oversight list, PSA, or portfolio seed.
 * Does not create executable agents.
 */
import {
  FABRIC_AGENT_CATALOG,
  FABRIC_AGENT_IDS,
  PERSONAL_SUPERVISING_AGENT_CLASS,
  defineControlAgentProfile,
  portfolioObservationGrantsExecution,
  profileKey,
  representUnprovenApplicationAgent,
  type ControlAgentIdentitySource,
  type ControlAgentProfile,
  type UnprovenApplicationAgent,
} from "@atlas/shared";
import { listRegisteredAgents } from "./agent-registry.js";

const ATLAS_APPLICATION_ID = "def-000";

function fabricProfiles(): readonly ControlAgentProfile[] {
  return FABRIC_AGENT_IDS.map((id) => {
    const def = FABRIC_AGENT_CATALOG[id];
    return defineControlAgentProfile({
      identitySource: "FABRIC",
      agentId: id,
      displayName: def.title,
      applicationId: ATLAS_APPLICATION_ID,
      ownerId: null,
      personalScope: false,
      professionalScope: true,
      scopeEvidence: "DECLARED",
      domain: def.category,
      runtimeReference: "FABRIC_AGENT_CATALOG",
      modelReference: null,
      providerReference: null,
      listedStatus: "CATALOG",
      lifecycleAuthority: "CATALOG_STATIC",
      runtimeProven: true,
      version: null,
      provenance: "packages/shared/src/constants/agents.ts",
      supervisorAgentId: null,
      supervisorType: "NONE",
      capabilityRef: id,
      riskRef: def.riskLevel,
    });
  });
}

function oversightProfiles(): readonly ControlAgentProfile[] {
  return listRegisteredAgents().map((agent) =>
    defineControlAgentProfile({
      identitySource: "CONTROL_OVERSIGHT",
      agentId: agent.agentId,
      displayName: agent.displayName,
      applicationId: ATLAS_APPLICATION_ID,
      ownerId: null,
      personalScope: false,
      professionalScope: true,
      scopeEvidence: "DECLARED",
      domain: null,
      runtimeReference: "AGENT_DEFINITIONS",
      modelReference: null,
      providerReference: null,
      listedStatus: agent.status,
      lifecycleAuthority: "OVERSIGHT_LIST",
      runtimeProven: false,
      version: null,
      provenance: "apps/control-plane/src/services/agent-registry.ts",
      supervisorAgentId: null,
      supervisorType: "NONE",
      capabilityRef: agent.agentId,
      riskRef: null,
    }),
  );
}

function psaClassProfile(): ControlAgentProfile {
  return defineControlAgentProfile({
    identitySource: "PSA",
    agentId: PERSONAL_SUPERVISING_AGENT_CLASS,
    displayName: "Personal Supervising Agent",
    applicationId: null,
    ownerId: null,
    personalScope: true,
    professionalScope: false,
    scopeEvidence: "DECLARED",
    domain: null,
    runtimeReference: "psa:<ownerId>",
    modelReference: null,
    providerReference: null,
    listedStatus: "PER_OWNER_RECORD",
    lifecycleAuthority: "PSA_RECORD",
    runtimeProven: true,
    version: null,
    provenance: "public.personal_supervising_agents",
    supervisorAgentId: null,
    supervisorType: "HUMAN",
    capabilityRef: null,
    riskRef: null,
  });
}

function hotelosObservation(): ControlAgentProfile {
  return defineControlAgentProfile({
    identitySource: "APPLICATION",
    agentId: "agent.cio",
    displayName: "HotelOS agent.cio",
    applicationId: "hotelos",
    ownerId: null,
    personalScope: false,
    professionalScope: false,
    scopeEvidence: "NOT_PROVEN",
    domain: null,
    runtimeReference: "application-owned-id",
    modelReference: null,
    providerReference: null,
    listedStatus: "NOT_RUNTIME_PROVEN",
    lifecycleAuthority: "NONE",
    runtimeProven: false,
    version: null,
    provenance: "application-owned identifier observed in Atlas tests; HotelOS runtime is not in this repo",
    supervisorAgentId: null,
    supervisorType: "NONE",
    capabilityRef: null,
    riskRef: null,
  });
}

let cached: readonly ControlAgentProfile[] | null = null;

export function listControlAgentProfiles(): readonly ControlAgentProfile[] {
  if (!cached) {
    cached = [
      ...fabricProfiles(),
      ...oversightProfiles(),
      psaClassProfile(),
      hotelosObservation(),
    ];
  }
  return cached;
}

export function getControlAgentProfile(
  identitySource: ControlAgentIdentitySource,
  agentId: string,
): ControlAgentProfile | undefined {
  const key = `${identitySource}:${agentId}`;
  return listControlAgentProfiles().find((profile) => profileKey(profile) === key);
}

export function unprovenCaseflowAgent(): UnprovenApplicationAgent {
  return representUnprovenApplicationAgent({
    applicationId: "caseflow",
    agentId: null,
  });
}

export function controlProfileGrantsExecution(
  _profile: ControlAgentProfile,
): false {
  return false;
}

export function portfolioMetadataGrantsExecution(): false {
  return portfolioObservationGrantsExecution();
}

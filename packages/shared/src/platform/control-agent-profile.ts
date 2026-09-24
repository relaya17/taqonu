/**
 * Control Agent identity/profile.
 *
 * Governance description only. This is not an execution catalog.
 * FABRIC_AGENT_CATALOG remains execution identity.
 * Control AGENT_DEFINITIONS remains the legacy oversight list.
 * PSA remains psa:<ownerId>.
 * Portfolio seed remains observational metadata.
 *
 * Listing a profile does not grant execution, approval bypass, or kill-switch bypass.
 * Known profiles are an input to the existing memory authorization path.
 * Callers with no Control identity keep allowedAgents default-open.
 */

import { z } from "zod";
import { FABRIC_AGENT_IDS, type FabricAgentId } from "../constants/agents.js";
import {
  PERSONAL_SUPERVISING_AGENT_CLASS,
  PSA_STABLE_ID_PREFIX,
} from "./personal-supervising-agent.js";

export const CONTROL_AGENT_IDENTITY_SOURCES = [
  "FABRIC",
  "CONTROL_OVERSIGHT",
  "PSA",
  "APPLICATION",
  "PORTFOLIO_OBSERVATION",
] as const;

export type ControlAgentIdentitySource =
  (typeof CONTROL_AGENT_IDENTITY_SOURCES)[number];

export const controlAgentScopeEvidenceSchema = z.enum([
  "DECLARED",
  "NOT_PROVEN",
]);
export type ControlAgentScopeEvidence = z.infer<
  typeof controlAgentScopeEvidenceSchema
>;

export const controlAgentMemoryGovernanceSchema = z.object({
  canReadPersonalMemory: z.boolean(),
  canWritePersonalMemory: z.boolean(),
  canPersistPersonalData: z.boolean(),
  canReadProfessionalKnowledge: z.boolean(),
  canWriteProfessionalKnowledge: z.boolean(),
  /** User owns personal memory. The agent is not the owner. */
  memoryOwner: z.enum(["USER", "NONE"]),
  memoryCustodian: z.literal("ATLAS_CONTROL"),
  /** Policy flags do not rewrite allowedAgents default-open. */
  storeDefaultOpenUnchanged: z.literal(true),
});
export type ControlAgentMemoryGovernance = z.infer<
  typeof controlAgentMemoryGovernanceSchema
>;

export const controlAgentProfileSchema = z.object({
  identitySource: z.enum(CONTROL_AGENT_IDENTITY_SOURCES),
  agentId: z.string().trim().min(1).max(200),
  displayName: z.string().trim().min(1).max(200),
  applicationId: z.string().trim().min(1).max(128).nullable(),
  ownerId: z.string().trim().min(1).max(128).nullable(),
  personalScope: z.boolean(),
  professionalScope: z.boolean(),
  scopeEvidence: controlAgentScopeEvidenceSchema,
  domain: z.string().trim().min(1).max(128).nullable(),
  runtimeReference: z.string().trim().min(1).max(256).nullable(),
  modelReference: z.string().trim().min(1).max(128).nullable(),
  providerReference: z.string().trim().min(1).max(128).nullable(),
  listedStatus: z.string().trim().min(1).max(64),
  lifecycleAuthority: z.enum([
    "NONE",
    "PSA_RECORD",
    "OVERSIGHT_LIST",
    "CATALOG_STATIC",
  ]),
  runtimeProven: z.boolean(),
  version: z.string().trim().min(1).max(64).nullable(),
  provenance: z.string().trim().min(1).max(500),
  supervisorAgentId: z.string().trim().min(1).max(200).nullable(),
  supervisorType: z.enum(["PSA", "HUMAN", "NONE"]),
  capabilityRef: z.string().trim().min(1).max(200).nullable(),
  riskRef: z.string().trim().min(1).max(64).nullable(),
  policyRef: z.literal("EXISTING_CONTROL_POLICY"),
  approvalRef: z.literal("EXISTING_APPROVAL_GATE"),
  memory: controlAgentMemoryGovernanceSchema,
  executionAuthorityGrantedByProfile: z.literal(false),
  bypassesApproval: z.literal(false),
  bypassesKillSwitch: z.literal(false),
  maySelfApprove: z.literal(false),
});
export type ControlAgentProfile = z.infer<typeof controlAgentProfileSchema>;

export const unprovenApplicationAgentSchema = z.object({
  kind: z.literal("NOT_AN_AGENT"),
  applicationId: z.string().trim().min(1).max(128),
  agentId: z.null(),
  runtimeProven: z.literal(false),
  executionAuthorityGrantedByProfile: z.literal(false),
});
export type UnprovenApplicationAgent = z.infer<
  typeof unprovenApplicationAgentSchema
>;

const CLOSED_GUARDS = {
  executionAuthorityGrantedByProfile: false,
  bypassesApproval: false,
  bypassesKillSwitch: false,
  maySelfApprove: false,
} as const;

export function memoryGovernanceForScopes(input: {
  readonly personalScope: boolean;
  readonly professionalScope: boolean;
  readonly scopeEvidence: ControlAgentScopeEvidence;
}): ControlAgentMemoryGovernance {
  const declared = input.scopeEvidence === "DECLARED";
  const personal = declared && input.personalScope;
  const professional = declared && input.professionalScope;
  return controlAgentMemoryGovernanceSchema.parse({
    canReadPersonalMemory: personal,
    canWritePersonalMemory: false,
    canPersistPersonalData: false,
    canReadProfessionalKnowledge: professional,
    canWriteProfessionalKnowledge: false,
    memoryOwner: personal ? "USER" : "NONE",
    memoryCustodian: "ATLAS_CONTROL",
    storeDefaultOpenUnchanged: true,
  });
}

export function defineControlAgentProfile(
  input: Omit<
    ControlAgentProfile,
    | "memory"
    | "executionAuthorityGrantedByProfile"
    | "bypassesApproval"
    | "bypassesKillSwitch"
    | "maySelfApprove"
    | "policyRef"
    | "approvalRef"
  >,
): ControlAgentProfile {
  return controlAgentProfileSchema.parse({
    ...input,
    policyRef: "EXISTING_CONTROL_POLICY",
    approvalRef: "EXISTING_APPROVAL_GATE",
    memory: memoryGovernanceForScopes({
      personalScope: input.personalScope,
      professionalScope: input.professionalScope,
      scopeEvidence: input.scopeEvidence,
    }),
    ...CLOSED_GUARDS,
  });
}

export function profileKey(profile: Pick<ControlAgentProfile, "identitySource" | "agentId">): string {
  return `${profile.identitySource}:${profile.agentId}`;
}

export function isControlAgentIdentitySource(
  value: string,
): value is ControlAgentIdentitySource {
  return (CONTROL_AGENT_IDENTITY_SOURCES as readonly string[]).includes(value);
}

/** Application id is not an agent id. Null agent id is not a runtime agent. */
export function representUnprovenApplicationAgent(input: {
  readonly applicationId: string;
  readonly agentId: null;
}): UnprovenApplicationAgent {
  return unprovenApplicationAgentSchema.parse({
    kind: "NOT_AN_AGENT",
    applicationId: input.applicationId,
    agentId: null,
    runtimeProven: false,
    executionAuthorityGrantedByProfile: false,
  });
}

export function portfolioObservationGrantsExecution(): false {
  return false;
}

const OVERSIGHT_ONLY_AGENT_IDS = [
  "QA_ENGINEER",
  "PRODUCT_MANAGER",
  "DATA_ANALYST",
] as const;

const UNPROVEN_APPLICATION_AGENT_ID = "agent.cio";

export type ControlMemoryOperation = "read" | "write" | "persist";

export type ControlMemoryDecision = {
  readonly governed: boolean;
  readonly allowed: boolean;
  readonly profile: ControlAgentProfile | null;
};

function isFabricAgentId(agentId: string): agentId is FabricAgentId {
  return (FABRIC_AGENT_IDS as readonly string[]).includes(agentId);
}

function isOversightOnlyAgentId(agentId: string): boolean {
  return (OVERSIGHT_ONLY_AGENT_IDS as readonly string[]).includes(agentId);
}

const governanceCache = new Map<string, ControlAgentProfile>();

function cachedProfile(
  key: string,
  build: () => ControlAgentProfile,
): ControlAgentProfile {
  const existing = governanceCache.get(key);
  if (existing) return existing;
  const profile = build();
  governanceCache.set(key, profile);
  return profile;
}

function declaredProfessionalProfile(
  identitySource: "FABRIC" | "CONTROL_OVERSIGHT",
  agentId: string,
): ControlAgentProfile {
  return cachedProfile(`${identitySource}:${agentId}`, () =>
    defineControlAgentProfile({
      identitySource,
      agentId,
      displayName: agentId,
      applicationId: identitySource === "FABRIC" ? "def-000" : null,
      ownerId: null,
      personalScope: false,
      professionalScope: true,
      scopeEvidence: "DECLARED",
      domain: null,
      runtimeReference:
        identitySource === "FABRIC" ? "FABRIC_AGENT_CATALOG" : "AGENT_DEFINITIONS",
      modelReference: null,
      providerReference: null,
      listedStatus: "LISTED",
      lifecycleAuthority:
        identitySource === "FABRIC" ? "CATALOG_STATIC" : "OVERSIGHT_LIST",
      runtimeProven: identitySource === "FABRIC",
      version: null,
      provenance: "Existing catalog. Control profile is governance input only.",
      supervisorAgentId: null,
      supervisorType: "NONE",
      capabilityRef: null,
      riskRef: null,
    }),
  );
}

function psaClassProfile(): ControlAgentProfile {
  return cachedProfile(`PSA:${PERSONAL_SUPERVISING_AGENT_CLASS}`, () =>
    defineControlAgentProfile({
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
      listedStatus: "CLASS",
      lifecycleAuthority: "PSA_RECORD",
      runtimeProven: true,
      version: null,
      provenance: "PSA class. Instance id psa:<ownerId> uses this policy.",
      supervisorAgentId: null,
      supervisorType: "HUMAN",
      capabilityRef: null,
      riskRef: null,
    }),
  );
}

function hotelosUnprovenProfile(): ControlAgentProfile {
  return cachedProfile("APPLICATION:agent.cio", () =>
    defineControlAgentProfile({
      identitySource: "APPLICATION",
      agentId: UNPROVEN_APPLICATION_AGENT_ID,
      displayName: "HotelOS agent.cio",
      applicationId: "hotelos",
      ownerId: null,
      personalScope: false,
      professionalScope: false,
      scopeEvidence: "NOT_PROVEN",
      domain: null,
      runtimeReference: null,
      modelReference: null,
      providerReference: null,
      listedStatus: "OBSERVED",
      lifecycleAuthority: "NONE",
      runtimeProven: false,
      version: null,
      provenance: "Application observation. Scope is not proven.",
      supervisorAgentId: null,
      supervisorType: "NONE",
      capabilityRef: null,
      riskRef: null,
    }),
  );
}

/**
 * Resolve a Control governance profile for an agent id already present on a
 * memory call. Unknown ids are unprofiled and stay on the legacy path.
 * `psa:<ownerId>` uses the PSA class policy. It does not create a second agent.
 */
export function governanceProfileForAgentId(
  agentId: string,
): ControlAgentProfile | null {
  if (isFabricAgentId(agentId)) {
    return declaredProfessionalProfile("FABRIC", agentId);
  }
  if (isOversightOnlyAgentId(agentId)) {
    return declaredProfessionalProfile("CONTROL_OVERSIGHT", agentId);
  }
  if (
    agentId === PERSONAL_SUPERVISING_AGENT_CLASS ||
    agentId.startsWith(PSA_STABLE_ID_PREFIX)
  ) {
    return psaClassProfile();
  }
  if (agentId === UNPROVEN_APPLICATION_AGENT_ID) {
    return hotelosUnprovenProfile();
  }
  return null;
}

/** Not a catalog id. Production resolution must not return this agent. */
export const CONTROL_PROFILE_TEST_FIXTURE_AGENT_ID =
  "test.personal-professional" as const;

/**
 * TEST FIXTURE. One agent id with both scopes. It is not registered in
 * Fabric, oversight, PSA, or the application inventory.
 */
export function controlProfileTestFixture(): ControlAgentProfile {
  return defineControlAgentProfile({
    identitySource: "APPLICATION",
    agentId: CONTROL_PROFILE_TEST_FIXTURE_AGENT_ID,
    displayName: "TEST FIXTURE",
    applicationId: "test-fixture",
    ownerId: null,
    personalScope: true,
    professionalScope: true,
    scopeEvidence: "DECLARED",
    domain: null,
    runtimeReference: null,
    modelReference: null,
    providerReference: null,
    listedStatus: "TEST FIXTURE",
    lifecycleAuthority: "NONE",
    runtimeProven: false,
    version: null,
    provenance: "TEST FIXTURE",
    supervisorAgentId: null,
    supervisorType: "NONE",
    capabilityRef: null,
    riskRef: null,
  });
}

export function controlMemoryDecisionForProfile(
  profile: ControlAgentProfile,
  operation: ControlMemoryOperation,
): ControlMemoryDecision {
  const allowed =
    operation === "read"
      ? profile.memory.canReadPersonalMemory
      : operation === "write"
        ? profile.memory.canWritePersonalMemory
        : profile.memory.canPersistPersonalData;
  return { governed: true, allowed, profile };
}

export function controlKnowledgeDecisionForProfile(
  profile: ControlAgentProfile,
): ControlMemoryDecision {
  return {
    governed: true,
    allowed: profile.memory.canReadProfessionalKnowledge,
    profile,
  };
}

export function controlGovernedMemoryAllows(
  agentId: string | undefined,
  operation: ControlMemoryOperation,
): ControlMemoryDecision {
  if (!agentId) return { governed: false, allowed: true, profile: null };
  const profile = governanceProfileForAgentId(agentId);
  if (!profile) return { governed: false, allowed: true, profile: null };
  return controlMemoryDecisionForProfile(profile, operation);
}

export function controlGovernedKnowledgeAllows(agentId: string | undefined): ControlMemoryDecision {
  if (!agentId) return { governed: false, allowed: true, profile: null };
  const profile = governanceProfileForAgentId(agentId);
  if (!profile) return { governed: false, allowed: true, profile: null };
  return controlKnowledgeDecisionForProfile(profile);
}

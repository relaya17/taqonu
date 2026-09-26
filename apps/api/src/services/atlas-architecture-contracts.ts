/**
 * Phase 1 MASTER GAP CLOSURE — reconciled architecture contracts.
 *
 * These are the live semantics of the current tree. Do not flip a value
 * to make a report look complete. Empty `allowedAgents` stays default-open
 * (POLICY DECISION). Agent identity is not model identity. Studio
 * `proposePatch` is a CODE_ENGINEER heuristic, not an LLM, and is not Truth.
 */
export const ATLAS_OWNERSHIP_CONTRACT = {
  atlasRole: "Truth + QA + Governance + Control",
  customerSourceCode: "stays-in-customer-workspace-or-git",
  connectorBoundary: "observes-from-outside",
  controlPlaneMergedWithStudio: false,
  selfAuditAutoApply: false,
} as const;

export const MEMORY_OWNERSHIP_CONTRACT = {
  userOwnedMemory: "tenant-owner-scoped fail-closed",
  agentScopedMemory: "allowedAgents non-empty restricts to listed agent ids",
  // Stage 4 (approved 2026-09-26): fail-closed identity. See
  // MEMORY_AGENT_VISIBILITY_CONTRACT in memory-pipeline.ts.
  emptyAllowedAgents: "open-to-admitted-identities-only",
  omitRequesterId: "human-surface-declared-only",
  projectOperationalMemory: "retrieve by projectId + ownerId",
  durableSoR:
    "osStore.persist JSON + optional Supabase dual-write; RAM is cache not SoR",
} as const;

export const ADR014_AUTHORITY_CONTRACT = {
  sourceAuthorityRanksPrioritize: true,
  knowledgeSourceTypesPrioritize: true,
  authorityPromotesToTruth: false,
  compositeScorePromotesToTruth: false,
  conflictingEvidence: "CONFLICTED-or-UNKNOWN-never-PASS",
} as const;

export const AGENT_IDENTITY_CONTRACT = {
  agentId: "fabric-catalog-or-plugin-id",
  modelId: "provider-routing-only",
  agentEqualsModel: false,
  studioProposePatch: "heuristic-not-llm",
  modelOutputIsTruth: false,
  executeToolRunsMutatingTools: false,
  modelGateway:
    "LLM_PROVIDER routing + llm.invocation audit of real provider usage; echo $0 is honest",
} as const;

export const TRUTH_EVIDENCE_CONTRACT = {
  truthDerivedFrom: "evidence + system state",
  missingProof: "never-PASS",
  modelInferenceAuthority: "LLM_INFERENCE lowest rank",
  heuristicPatchAuthorityHint: "LLM_INFERENCE (lowest rank; intelligenceKind=heuristic is the honest label)",
  unknownBlockedPartial: "first-class epistemic states",
} as const;

export const STUDIO_EXECUTION_CONTRACT = {
  unrestrictedShell: false,
  clientArgvAccepted: false,
  commandIdentity: "commandId-allowlist",
  spawnShell: false,
  workspaceContainment: "linked-project-workspaceRoot-only",
  approval: "RECORD.EXECUTE HUMAN_ONLY live-human decide-and-execute",
  extensionsMarketplace: false,
  extensionsUserJs: false,
  extensionsHostApi: false,
  extensionsHostProductGoal: false,
} as const;

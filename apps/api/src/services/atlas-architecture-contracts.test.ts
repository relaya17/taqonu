import { describe, expect, it } from "vitest";
import {
  ADR014_AUTHORITY_CONTRACT,
  AGENT_IDENTITY_CONTRACT,
  ATLAS_OWNERSHIP_CONTRACT,
  MEMORY_OWNERSHIP_CONTRACT,
  STUDIO_EXECUTION_CONTRACT,
  TRUTH_EVIDENCE_CONTRACT,
} from "./atlas-architecture-contracts.js";
import { MEMORY_AGENT_VISIBILITY_CONTRACT } from "./memory-pipeline.js";
import { STUDIO_EXTENSION_CONTRACT } from "./studio-extensions.js";

describe("Phase 1 architecture contracts", () => {
  it("does not merge Studio with Control and does not auto-apply Atlas self-audit", () => {
    expect(ATLAS_OWNERSHIP_CONTRACT.controlPlaneMergedWithStudio).toBe(false);
    expect(ATLAS_OWNERSHIP_CONTRACT.selfAuditAutoApply).toBe(false);
    expect(ATLAS_OWNERSHIP_CONTRACT.atlasRole).toBe(
      "Truth + QA + Governance + Control",
    );
  });

  it("Stage 4: memory agent visibility is fail-closed (approved 2026-09-26)", () => {
    expect(MEMORY_OWNERSHIP_CONTRACT.emptyAllowedAgents).toBe(
      "open-to-admitted-identities-only",
    );
    expect(MEMORY_AGENT_VISIBILITY_CONTRACT.emptyAllowedAgents).toBe(
      "open-to-admitted-identities-only",
    );
    expect(MEMORY_OWNERSHIP_CONTRACT.omitRequesterId).toBe(
      "human-surface-declared-only",
    );
    expect(MEMORY_AGENT_VISIBILITY_CONTRACT.omitRequesterId).toBe(
      "human-surface-declared-only",
    );
    expect(MEMORY_AGENT_VISIBILITY_CONTRACT.unknownOrUnprofiledId).toBe("denied");
    expect(MEMORY_AGENT_VISIBILITY_CONTRACT.psaIdentity).toBe("bound-to-memory-owner");
    expect(MEMORY_AGENT_VISIBILITY_CONTRACT.mixedIds).toBe("all-must-be-admitted");
  });

  it("keeps Agent identity distinct from model identity; proposePatch is heuristic; model output is not Truth", () => {
    expect(AGENT_IDENTITY_CONTRACT.agentEqualsModel).toBe(false);
    expect(AGENT_IDENTITY_CONTRACT.studioProposePatch).toBe("heuristic-not-llm");
    expect(AGENT_IDENTITY_CONTRACT.modelOutputIsTruth).toBe(false);
    expect(AGENT_IDENTITY_CONTRACT.executeToolRunsMutatingTools).toBe(false);
    expect(TRUTH_EVIDENCE_CONTRACT.missingProof).toBe("never-PASS");
    expect(TRUTH_EVIDENCE_CONTRACT.truthDerivedFrom).toBe(
      "evidence + system state",
    );
  });

  it("forbids unrestricted shell, client argv, marketplace, and user JS", () => {
    expect(STUDIO_EXECUTION_CONTRACT.unrestrictedShell).toBe(false);
    expect(STUDIO_EXECUTION_CONTRACT.clientArgvAccepted).toBe(false);
    expect(STUDIO_EXECUTION_CONTRACT.spawnShell).toBe(false);
    expect(STUDIO_EXTENSION_CONTRACT.marketplace).toBe(false);
    expect(STUDIO_EXTENSION_CONTRACT.userProvidedJs).toBe(false);
    expect(STUDIO_EXTENSION_CONTRACT.hostApi).toBe(false);
    expect(STUDIO_EXTENSION_CONTRACT.productGoal).toBe(false);
    expect(STUDIO_EXECUTION_CONTRACT.extensionsHostProductGoal).toBe(false);
  });

  it("does not let authority or composite score promote a claim to Truth", () => {
    expect(ADR014_AUTHORITY_CONTRACT.authorityPromotesToTruth).toBe(false);
    expect(ADR014_AUTHORITY_CONTRACT.compositeScorePromotesToTruth).toBe(false);
    expect(ADR014_AUTHORITY_CONTRACT.conflictingEvidence).toBe(
      "CONFLICTED-or-UNKNOWN-never-PASS",
    );
    expect(MEMORY_OWNERSHIP_CONTRACT.durableSoR).toContain("RAM is cache not SoR");
  });
});

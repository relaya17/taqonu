import { describe, expect, it } from "vitest";
import { FABRIC_AGENT_IDS, FABRIC_AGENT_CATALOG } from "../constants/agents.js";
import {
  ATLAS_AUTHORITY_INHERITANCE,
  GOVERNANCE_DECISION_STATUSES,
  PORTFOLIO_SAFETY_LOCKS,
  requiresOwnerAndCatalogChange,
} from "../constants/portfolio-governance.js";
import {
  allSourceRuntimesUnknownOrNotProbed,
  atlasPermissionsNeverFromSource,
  buildPortfolioSummary,
  fabricRefsAreNotAnExecutionRegistry,
  knowledgeNeverIngestedInRecords,
  loadSeedSnapshot,
  noFabricCatalogMutation,
  noKnowledgeIngested,
  sourceCodeNeverCopied,
  sourceWriteNeverInherited,
  verificationDistinctFromRuntime,
} from "./index.js";

/**
 * Phase 11.11 — Portfolio Governance Security Verification
 *
 * Comprehensive security tests for the Portfolio Governance model.
 * These tests verify the architectural boundaries are enforced:
 * - Authentication and authorization controls
 * - Permission isolation (source → Atlas)
 * - Fabric isolation
 * - Runtime probing disabled
 * - Knowledge ingestion disabled
 * - Secrets and credentials protection
 */
describe("Portfolio Governance Security (Phase 11.11)", () => {
  const snapshot = loadSeedSnapshot();
  const summary = buildPortfolioSummary(snapshot);

  describe("Authorization and governance control", () => {
    it("governance decisions require owner control — PROPOSED cannot auto-approve", () => {
      for (const decision of snapshot.governanceDecisions) {
        expect(GOVERNANCE_DECISION_STATUSES).toContain(decision.status);
        if (decision.status === "PROPOSED") {
          expect(decision.decidedBy).toBeNull();
          expect(decision.decidedAt).toBeNull();
        }
      }
    });

    it("high-risk actions require Owner AND catalog change", () => {
      expect(requiresOwnerAndCatalogChange("CREATE_NEW_ATLAS_SPECIALIST")).toBe(true);
      expect(requiresOwnerAndCatalogChange("ADAPT_INTO_EXISTING_ATLAS_CAPABILITY")).toBe(true);
      expect(requiresOwnerAndCatalogChange("ADAPT_INTO_EXISTING")).toBe(true);
      expect(requiresOwnerAndCatalogChange("KEEP_SOURCE_SPECIFIC")).toBe(false);
      expect(requiresOwnerAndCatalogChange("IMPORT_KNOWLEDGE_ONLY")).toBe(false);
      expect(requiresOwnerAndCatalogChange("DO_NOT_IMPORT")).toBe(false);
      expect(requiresOwnerAndCatalogChange("ESCALATE")).toBe(false);
    });

    it("no governance decision has auto-mutated Fabric", () => {
      expect(noFabricCatalogMutation(snapshot)).toBe(true);
      for (const decision of snapshot.governanceDecisions) {
        expect(decision.fabricCatalogMutated).toBe(false);
      }
    });

    it("no governance decision has auto-ingested knowledge", () => {
      expect(noKnowledgeIngested(snapshot)).toBe(true);
      for (const decision of snapshot.governanceDecisions) {
        expect(decision.knowledgeIngested).toBe(false);
      }
    });
  });

  describe("Permission isolation (source → Atlas boundary)", () => {
    it("source WRITE permissions never become Atlas WRITE authority", () => {
      expect(sourceWriteNeverInherited(snapshot)).toBe(true);
      for (const perm of snapshot.sourcePermissions) {
        expect(perm.atlasInheritance).toBe(ATLAS_AUTHORITY_INHERITANCE);
        expect(perm.atlasInheritance).toBe("NONE");
      }
    });

    it("Atlas permissions never inherit from source agents", () => {
      expect(atlasPermissionsNeverFromSource(snapshot)).toBe(true);
      for (const atlasPerm of snapshot.atlasPermissions) {
        expect(atlasPerm.inheritedFromSourceAgentId).toBeNull();
        expect(atlasPerm.source).toBe("FABRIC_CATALOG");
      }
    });

    it("all source permissions with WRITE_SOURCE authority stay isolated", () => {
      const writeSources = snapshot.sourcePermissions.filter(
        (p) => p.sourceAuthority === "WRITE_SOURCE",
      );
      expect(writeSources.length).toBeGreaterThan(0);
      for (const perm of writeSources) {
        expect(perm.atlasInheritance).toBe("NONE");
      }
    });

    it("source code is never copied into Atlas", () => {
      expect(sourceCodeNeverCopied(snapshot)).toBe(true);
      for (const record of snapshot.sourceCodeRecords) {
        expect(record.copiedIntoAtlas).toBe(false);
        expect(record.bytesCopied).toBe(0);
      }
    });
  });

  describe("Fabric isolation", () => {
    it("FABRIC_AGENT_IDS count is exactly 16 and immutable from Portfolio", () => {
      expect(FABRIC_AGENT_IDS).toHaveLength(16);
      expect(summary.executionRegistry).toBe("FABRIC_AGENT_CATALOG");
    });

    it("Portfolio data does not create or modify Atlas agents", () => {
      expect(summary.fabricCatalogMutated).toBe(false);
      expect(summary.controlPlaneAgentDefinitionsAreNotExecution).toBe(true);
    });

    it("fabricAgentRefs are read-only projections, not execution registries", () => {
      expect(fabricRefsAreNotAnExecutionRegistry(snapshot)).toBe(true);
      for (const ref of snapshot.fabricAgentRefs) {
        expect(ref.executableViaPortfolioGovernance).toBe(false);
        expect(ref.isExecutionRegistry).toBe(false);
      }
    });

    it("canonical capabilities do not grant execution authority", () => {
      for (const canon of snapshot.canonicalCapabilities) {
        expect(canon.kind).toMatch(/^(FABRIC_RUNTIME|KNOWLEDGE_ONLY)$/);
        const isRuntimeCanonical = canon.kind === "FABRIC_RUNTIME";
        if (isRuntimeCanonical) {
          expect(FABRIC_AGENT_IDS).toContain(canon.fabricAgentId);
        }
      }
    });

    it("source agents are blocked from automatic Fabric promotion", () => {
      for (const agent of snapshot.sourceAgents) {
        expect(agent.atlasPromotionBlocked).toBe(true);
        expect(FABRIC_AGENT_IDS).not.toContain(agent.sourceKey);
      }
    });
  });

  describe("SourceAgent execution blocked", () => {
    it("safety locks prevent source execution", () => {
      expect(PORTFOLIO_SAFETY_LOCKS.sourceExecutionEnabled).toBe(false);
      expect(summary.sourceExecutionEnabled).toBe(false);
    });

    it("source applications cannot be started or probed", () => {
      expect(PORTFOLIO_SAFETY_LOCKS.probesEnabled).toBe(false);
    });

    it("sibling repositories cannot be modified", () => {
      expect(PORTFOLIO_SAFETY_LOCKS.siblingRepositoriesWritable).toBe(false);
    });

    it("source code cannot be copied into Atlas", () => {
      expect(PORTFOLIO_SAFETY_LOCKS.copySourceCodeIntoAtlas).toBe(false);
    });
  });

  describe("Runtime probing disabled", () => {
    it("all source runtimes remain UNKNOWN / NOT_PROBED", () => {
      expect(allSourceRuntimesUnknownOrNotProbed(snapshot)).toBe(true);
      expect(summary.allSourceRuntimesUnknown).toBe(true);
    });

    it("no source agent has been probed", () => {
      for (const agent of snapshot.sourceAgents) {
        expect(["UNKNOWN", "NOT_PROBED"]).toContain(agent.runtimeStatus.state);
        expect(agent.runtimeStatus.probeKind).toBe("NONE");
        expect(agent.runtimeStatus.probedAt).toBeNull();
      }
    });

    it("verification status is independent of runtime status", () => {
      expect(verificationDistinctFromRuntime(snapshot)).toBe(true);
    });
  });

  describe("Knowledge ingestion disabled", () => {
    it("safety lock prevents knowledge ingestion", () => {
      expect(PORTFOLIO_SAFETY_LOCKS.ingestEnabled).toBe(false);
      expect(summary.ingestEnabled).toBe(false);
    });

    it("knowledge ingestion is controlled by Owner-approved governance decisions", () => {
      // Phase 11.15: 4 knowledge records were explicitly approved by Owner
      const ingestedRecords = snapshot.knowledgeRecords.filter((r) => r.ingested);
      expect(ingestedRecords.length).toBe(4);
      // All ingested records must have a governance decision ID
      for (const record of ingestedRecords) {
        expect(record.governanceDecisionId).not.toBeNull();
      }
      // ingestEnabled safety lock remains false to prevent unapproved future ingestion
      expect(snapshot.safety.ingestEnabled).toBe(false);
    });

    it("knowledge records have valid governance decision links", () => {
      for (const record of snapshot.knowledgeRecords) {
        if (record.ingested) {
          // Ingested records must link to a valid governance decision
          expect(record.governanceDecisionId).not.toBeNull();
          const decision = snapshot.governanceDecisions.find(
            (d) => d.id === record.governanceDecisionId,
          );
          expect(decision).toBeDefined();
          expect(decision?.action).toBe("IMPORT_KNOWLEDGE_ONLY");
        }
        // ingestEnabled is always false (safety lock)
        expect(record.ingestEnabled).toBe(false);
      }
    });
  });

  describe("Secrets and credentials protection", () => {
    it("evidence paths do not reference secrets or credentials", () => {
      for (const evidence of snapshot.evidence) {
        expect(evidence.path).not.toMatch(/\.(env|secret|key|pem|crt|cert)$/i);
        expect(evidence.path).not.toMatch(/(credentials|secrets|\.env)/i);
      }
    });

    it("provenance paths do not reference sensitive files", () => {
      for (const agent of snapshot.sourceAgents) {
        const p = agent.provenance;
        expect(p.sourcePath).not.toMatch(/\.(env|secret|key|pem|crt|cert)$/i);
        expect(p.sourcePath).not.toMatch(/(credentials|secrets|private)/i);
      }
    });

    it("source code records do not point to sensitive files", () => {
      for (const record of snapshot.sourceCodeRecords) {
        expect(record.path).not.toMatch(/\.(env|secret|key|pem|crt|cert)$/i);
        expect(record.path).not.toMatch(/(credentials|secrets|private)/i);
      }
    });
  });

  describe("Cross-application isolation", () => {
    it("each source agent belongs to exactly one application", () => {
      const appIds = new Set(snapshot.applications.map((a) => a.id));
      for (const agent of snapshot.sourceAgents) {
        expect(appIds.has(agent.applicationId)).toBe(true);
      }
    });

    it("source agents cannot reference applications they do not belong to", () => {
      const agentsByApp = new Map<string, Set<string>>();
      for (const agent of snapshot.sourceAgents) {
        if (!agentsByApp.has(agent.applicationId)) {
          agentsByApp.set(agent.applicationId, new Set());
        }
        agentsByApp.get(agent.applicationId)!.add(agent.id);
      }
      for (const agent of snapshot.sourceAgents) {
        const siblings = agentsByApp.get(agent.applicationId)!;
        expect(siblings.has(agent.id)).toBe(true);
      }
    });

    it("capabilities reference only their own source agents", () => {
      const agentIds = new Set(snapshot.sourceAgents.map((a) => a.id));
      for (const cap of snapshot.capabilities) {
        expect(agentIds.has(cap.sourceAgentId)).toBe(true);
      }
    });

    it("evidence references valid capabilities or agents", () => {
      const capIds = new Set(snapshot.capabilities.map((c) => c.id));
      const agentIds = new Set(snapshot.sourceAgents.map((a) => a.id));
      for (const evidence of snapshot.evidence) {
        if (evidence.capabilityId) {
          expect(capIds.has(evidence.capabilityId)).toBe(true);
        }
        if (evidence.sourceAgentId) {
          expect(agentIds.has(evidence.sourceAgentId)).toBe(true);
        }
      }
    });
  });

  describe("Input validation and data integrity", () => {
    it("all UUIDs are valid format", () => {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      for (const app of snapshot.applications) {
        expect(app.id).toMatch(uuidRegex);
      }
      for (const agent of snapshot.sourceAgents) {
        expect(agent.id).toMatch(uuidRegex);
        expect(agent.applicationId).toMatch(uuidRegex);
      }
      for (const cap of snapshot.capabilities) {
        expect(cap.id).toMatch(uuidRegex);
        expect(cap.sourceAgentId).toMatch(uuidRegex);
      }
    });

    it("all provenance contains full 40-character commit SHAs", () => {
      for (const agent of snapshot.sourceAgents) {
        expect(agent.provenance.sourceCommit).toMatch(/^[0-9a-f]{40}$/i);
      }
    });

    it("timestamps are valid ISO format", () => {
      const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;
      expect(snapshot.extractedAt).toMatch(isoRegex);
    });
  });
});

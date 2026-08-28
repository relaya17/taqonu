import { describe, expect, it } from "vitest";
import {
  ATLAS_PERMISSION_KINDS,
  DEFAULT_SOURCE_RUNTIME,
  PORTFOLIO_ENTITY_PLANES,
  PORTFOLIO_SAFETY_LOCKS,
  SOURCE_AUTHORITY_KINDS,
  requiresOwnerAndCatalogChange,
} from "../constants/portfolio-governance.js";
import { emptyOverlay, emptyPortfolioSnapshot, mergePortfolioSnapshot } from "../portfolio/index.js";
import {
  portfolioAtlasPermissionSchema,
  portfolioConflictSchema,
  portfolioGovernanceDecisionSchema,
  portfolioGovernanceSnapshotSchema,
  portfolioKnowledgeRecordSchema,
  portfolioSourceCodeRecordSchema,
  portfolioSourcePermissionSchema,
} from "./portfolio-governance.schema.js";

const SHA = "7ba11d5e0abfbd9c4bf05b084e6cea7eaf80992e";
const AT = "2026-08-28T13:42:00.000Z";
const ID = "a11c0000-0000-4000-a000-000000000001";

function emptyInput() {
  return {
    version: 1 as const,
    extractedAt: AT,
    applications: [],
    sourceAgents: [],
    capabilities: [],
    canonicalCapabilities: [],
    evidence: [],
    dedupRelations: [],
    conflicts: [],
    governanceDecisions: [],
    auditEvents: [],
  };
}

describe("Phase 11.1 foundation schema", () => {
  it("declares every required governance plane", () => {
    expect(PORTFOLIO_ENTITY_PLANES).toEqual([
      "SOURCE_CODE",
      "KNOWLEDGE",
      "SOURCE_AGENT",
      "SOURCE_CAPABILITY",
      "CANONICAL_ATLAS_CAPABILITY",
      "PROVENANCE",
      "EVIDENCE",
      "RUNTIME_STATUS",
      "SOURCE_PERMISSIONS",
      "ATLAS_PERMISSIONS",
      "GOVERNANCE_DECISION",
      "AUDIT",
      "ATLAS_FABRIC_AGENT",
    ]);
  });

  it("parses an empty snapshot with safety locks and separated collections", () => {
    const snapshot = portfolioGovernanceSnapshotSchema.parse(emptyInput());
    expect(snapshot.sourceAgents).toEqual([]);
    expect(snapshot.capabilities).toEqual([]);
    expect(snapshot.canonicalCapabilities).toEqual([]);
    expect(snapshot.sourceCodeRecords).toEqual([]);
    expect(snapshot.knowledgeRecords).toEqual([]);
    expect(snapshot.sourcePermissions).toEqual([]);
    expect(snapshot.atlasPermissions).toEqual([]);
    expect(snapshot.fabricAgentRefs).toEqual([]);
    expect(snapshot.safety).toEqual(PORTFOLIO_SAFETY_LOCKS);
    expect(snapshot.safety.ingestEnabled).toBe(false);
    expect(snapshot.safety.fabricCatalogWritableFromPortfolio).toBe(false);
    expect(snapshot.safety.copySourceCodeIntoAtlas).toBe(false);
    expect(DEFAULT_SOURCE_RUNTIME).toEqual({
      state: "UNKNOWN",
      probeKind: "NONE",
      probedAt: null,
    });
  });

  it("rejects source WRITE inheritance into Atlas", () => {
    expect(() =>
      portfolioSourcePermissionSchema.parse({
        id: ID,
        sourceAgentId: ID,
        sourceAuthority: "WRITE_SOURCE",
        description: "source write",
        atlasInheritance: "INHERIT",
      }),
    ).toThrow();
    expect(SOURCE_AUTHORITY_KINDS).toContain("WRITE_SOURCE");
    expect(ATLAS_PERMISSION_KINDS).not.toContain("WRITE_SOURCE");
  });

  it("rejects Atlas permissions that claim a source agent origin", () => {
    expect(() =>
      portfolioAtlasPermissionSchema.parse({
        id: ID,
        fabricAgentId: "ORCHESTRATOR",
        atlasAuthority: "ORCHESTRATE",
        description: "illegal inherit",
        source: "FABRIC_CATALOG",
        inheritedFromSourceAgentId: ID,
        grantedByPortfolio: false,
      }),
    ).toThrow();
  });

  it("rejects copied source code and ingested knowledge", () => {
    const provenance = {
      sourceRepository: "github/vantera",
      sourceBranch: "main",
      sourceCommit: SHA,
      sourcePath: "packages/x/src/index.ts",
      sourcePackage: null,
      sourceSymbol: null,
      sourceType: "SOURCE_CODE",
      extractedAt: AT,
    };
    expect(() =>
      portfolioSourceCodeRecordSchema.parse({
        id: ID,
        applicationId: ID,
        sourceAgentId: null,
        provenance,
        copiedIntoAtlas: true,
        bytesCopied: 12,
        note: "no",
      }),
    ).toThrow();
    expect(() =>
      portfolioKnowledgeRecordSchema.parse({
        id: ID,
        applicationId: ID,
        sourceAgentId: null,
        capabilityId: null,
        provenance: { ...provenance, sourceType: "KNOWLEDGE" },
        title: "rule",
        summary: "do not invent amounts",
        ingested: true,
        ingestEnabled: true,
      }),
    ).toThrow();
  });

  it("rejects a decision that claims Fabric mutation or knowledge ingest happened", () => {
    expect(() =>
      portfolioGovernanceDecisionSchema.parse({
        id: ID,
        action: "CREATE_NEW_ATLAS_SPECIALIST",
        status: "APPROVED",
        applicationId: null,
        sourceAgentId: null,
        capabilityId: null,
        rationale: "must not mutate",
        decidedBy: "owner",
        decidedAt: AT,
        fabricCatalogMutated: true,
        knowledgeIngested: false,
      }),
    ).toThrow();
  });

  it("requires Owner plus a separate catalog change for specialist creation and adapt", () => {
    expect(requiresOwnerAndCatalogChange("CREATE_NEW_ATLAS_SPECIALIST")).toBe(true);
    expect(requiresOwnerAndCatalogChange("ADAPT_INTO_EXISTING")).toBe(true);
    expect(requiresOwnerAndCatalogChange("ADAPT_INTO_EXISTING_ATLAS_CAPABILITY")).toBe(true);
    expect(requiresOwnerAndCatalogChange("KEEP_SOURCE_SPECIFIC")).toBe(false);
    expect(requiresOwnerAndCatalogChange("IMPORT_KNOWLEDGE_ONLY")).toBe(false);
  });

  it("requires applicationIds on every conflict record", () => {
    expect(() =>
      portfolioConflictSchema.parse({
        id: ID,
        key: "C_MISSING_APPS",
        status: "OPEN",
        summary: "Conflict without applicationIds must not parse",
        sourceAgentIds: [ID],
        canonicalCapabilityId: null,
      }),
    ).toThrow();
    const parsed = portfolioConflictSchema.parse({
      id: ID,
      key: "C_WITH_APPS",
      status: "OPEN",
      summary: "Conflict names the applications in scope",
      sourceAgentIds: [ID],
      applicationIds: [ID],
      canonicalCapabilityId: null,
    });
    expect(parsed.applicationIds).toEqual([ID]);
  });

  it("requires full commit SHA on provenance", () => {
    const snapshot = portfolioGovernanceSnapshotSchema.parse(emptyInput());
    expect(snapshot.version).toBe(1);
    expect(() =>
      portfolioGovernanceSnapshotSchema.parse({
        ...emptyInput(),
        applications: [
          {
            id: ID,
            slug: "x",
            name: "X",
            role: "SOURCE",
            sourceRepository: "github/x",
            sourceBranch: "main",
            sourceCommit: "abc123",
            managedSystemId: null,
            notes: "short sha forbidden",
          },
        ],
      }),
    ).toThrow(/full commit SHA|regex/i);
  });

  it("merges an empty overlay onto an empty snapshot without creating Fabric agents", () => {
    const seed = emptyPortfolioSnapshot(AT);
    const merged = mergePortfolioSnapshot(seed, emptyOverlay(AT));
    expect(merged.fabricAgentRefs).toEqual([]);
    expect(merged.sourceAgents).toEqual([]);
    expect(merged.safety.fabricCatalogWritableFromPortfolio).toBe(false);
    expect(merged.knowledgeRecords).toEqual([]);
  });
});

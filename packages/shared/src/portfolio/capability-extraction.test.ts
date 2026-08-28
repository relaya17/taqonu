/**
 * Phase 11.3 — Capability Extraction Tests
 *
 * 15 required tests proving:
 * 1. Capabilities are extracted from actual implementation evidence.
 * 2. Agent names alone cannot create a capability classification.
 * 3. Inputs and outputs are represented correctly.
 * 4. Tools are represented correctly.
 * 5. READ/WRITE behavior remains descriptive source information.
 * 6. External communication is represented separately.
 * 7. External authority is represented separately.
 * 8. Application context is preserved.
 * 9. Source provenance remains attached.
 * 10. Evidence remains separate from runtime.
 * 11. Source permissions do not become Atlas permissions.
 * 12. No SourceAgent is added to FABRIC_AGENT_CATALOG.
 * 13. No sibling application is executed.
 * 14. No secrets or credentials are ingested.
 * 15. Empty or insufficient evidence produces UNKNOWN rather than invented capability data.
 */
import { describe, expect, it } from "vitest";
import { FABRIC_AGENT_IDS, FABRIC_AGENT_CATALOG } from "../constants/agents.js";
import { loadSeedSnapshot } from "./index.js";

describe("Phase 11.3 — Capability Extraction", () => {
  const snapshot = loadSeedSnapshot();

  // TEST 1: Capabilities are extracted from actual implementation evidence
  it("extracts capabilities from implementation evidence, not invented data", () => {
    for (const cap of snapshot.capabilities) {
      expect(cap.purpose.length).toBeGreaterThan(0);
      expect(cap.domain.length).toBeGreaterThan(0);
      const agent = snapshot.sourceAgents.find((a) => a.id === cap.sourceAgentId);
      expect(agent).toBeDefined();
      expect(agent!.provenance.sourcePath.length).toBeGreaterThan(0);
    }
  });

  // TEST 2: Agent names alone cannot create a capability classification
  it("does not classify capabilities from agent names alone", () => {
    const securityAgent = snapshot.sourceAgents.find((a) => a.sourceKey === "agent.security");
    expect(securityAgent).toBeDefined();
    const secCap = snapshot.capabilities.find((c) => c.sourceAgentId === securityAgent!.id);
    expect(secCap).toBeDefined();
    expect(secCap!.domain).toBe("physical-security");
    expect(secCap!.canonicalCapabilityId).toBeNull();
    expect(secCap!.applicationContext).toContain("physical");
    expect(secCap!.applicationContext).toContain("NOT software AuthZ");
  });

  // TEST 3: Inputs and outputs are represented correctly
  it("represents inputs and outputs correctly for each capability", () => {
    for (const cap of snapshot.capabilities) {
      expect(typeof cap.inputs).toBe("string");
      expect(typeof cap.outputs).toBe("string");
      expect(cap.inputs.length).toBeGreaterThan(0);
      expect(cap.outputs.length).toBeGreaterThan(0);
    }
    const invoiceDraft = snapshot.capabilities.find((c) => c.name === "invoice-draft-no-invent");
    expect(invoiceDraft!.inputs).toContain("deal");
    expect(invoiceDraft!.outputs).toContain("invoice draft");
  });

  // TEST 4: Tools are represented correctly
  it("represents tools correctly for each capability", () => {
    for (const cap of snapshot.capabilities) {
      expect(Array.isArray(cap.tools)).toBe(true);
    }
    const chatTools = snapshot.capabilities.find((c) => c.name === "resident-chat-tools");
    expect(chatTools!.tools).toContain("createTicket");
    expect(chatTools!.tools).toContain("createReminder");
    expect(chatTools!.tools).toContain("getBalance");
  });

  // TEST 5: READ/WRITE behavior remains descriptive source information
  it("keeps readAccess/writeAccess as descriptive source info, not Atlas permissions", () => {
    for (const cap of snapshot.capabilities) {
      expect(Array.isArray(cap.readAccess)).toBe(true);
      expect(Array.isArray(cap.writeAccess)).toBe(true);
    }
    const chatTools = snapshot.capabilities.find((c) => c.name === "resident-chat-tools");
    expect(chatTools!.readAccess).toContain("tenant-balance");
    expect(chatTools!.writeAccess).toContain("tickets");
    expect(chatTools!.writeAccess).toContain("reminders");
    const preview = snapshot.capabilities.find((c) => c.name === "preview-not-send");
    expect(preview!.writeAccess).toEqual([]);
  });

  // TEST 6: External communication is represented separately
  it("represents external communication separately from other fields", () => {
    for (const cap of snapshot.capabilities) {
      expect(Array.isArray(cap.externalCommunication)).toBe(true);
    }
    const preview = snapshot.capabilities.find((c) => c.name === "preview-not-send");
    expect(preview!.externalCommunication).toEqual([]);
    expect(preview!.applicationContext).toContain("preview only");
  });

  // TEST 7: External authority is represented separately
  it("represents external authority separately and accurately", () => {
    for (const cap of snapshot.capabilities) {
      expect(typeof cap.externalAuthority).toBe("boolean");
    }
    const vms = snapshot.capabilities.find((c) => c.name === "facility-vms");
    expect(vms!.externalAuthority).toBe(true);
    const sentinel = snapshot.capabilities.find((c) => c.name === "platform-sentinel");
    expect(sentinel!.externalAuthority).toBe(false);
  });

  // TEST 8: Application context is preserved
  it("preserves application context for each capability", () => {
    for (const cap of snapshot.capabilities) {
      expect(typeof cap.applicationContext).toBe("string");
    }
    const hotelCap = snapshot.capabilities.find((c) => c.name === "hotel-front-door");
    expect(hotelCap!.applicationContext).toContain("HotelOS");
    const brokerCap = snapshot.capabilities.find((c) => c.name === "desk-intent-route");
    expect(brokerCap!.applicationContext).toContain("BrokerOS");
    const lexCap = snapshot.capabilities.find((c) => c.name === "question-validator");
    expect(lexCap!.applicationContext).toContain("LexStudy");
  });

  // TEST 9: Source provenance remains attached
  it("keeps source provenance attached to source agents", () => {
    for (const cap of snapshot.capabilities) {
      const agent = snapshot.sourceAgents.find((a) => a.id === cap.sourceAgentId);
      expect(agent).toBeDefined();
      expect(agent!.provenance.sourceRepository.length).toBeGreaterThan(0);
      expect(agent!.provenance.sourceBranch.length).toBeGreaterThan(0);
      expect(agent!.provenance.sourceCommit).toMatch(/^[0-9a-f]{40}$/i);
      expect(agent!.provenance.sourcePath.length).toBeGreaterThan(0);
    }
  });

  // TEST 10: Evidence remains separate from runtime
  it("keeps evidence separate from runtime status", () => {
    const agentsWithEvidence = new Set(
      snapshot.evidence.filter((e) => e.sourceAgentId).map((e) => e.sourceAgentId),
    );
    for (const agentId of agentsWithEvidence) {
      const agent = snapshot.sourceAgents.find((a) => a.id === agentId);
      expect(agent).toBeDefined();
      expect(agent!.runtimeStatus.state).toMatch(/^(UNKNOWN|NOT_PROBED)$/);
    }
  });

  // TEST 11: Source permissions do not become Atlas permissions
  it("ensures source permissions never become Atlas permissions", () => {
    for (const perm of snapshot.sourcePermissions) {
      expect(perm.atlasInheritance).toBe("NONE");
    }
    const writePerms = snapshot.sourcePermissions.filter((p) => p.sourceAuthority === "WRITE_SOURCE");
    expect(writePerms.length).toBeGreaterThan(0);
    for (const perm of writePerms) {
      expect(perm.atlasInheritance).toBe("NONE");
    }
  });

  // TEST 12: No SourceAgent is added to FABRIC_AGENT_CATALOG
  it("does not add any SourceAgent to FABRIC_AGENT_CATALOG", () => {
    const fabricKeys = new Set(FABRIC_AGENT_IDS);
    for (const agent of snapshot.sourceAgents) {
      expect(fabricKeys.has(agent.sourceKey as string)).toBe(false);
      expect(agent.atlasPromotionBlocked).toBe(true);
    }
    expect(Object.keys(FABRIC_AGENT_CATALOG)).toHaveLength(16);
  });

  // TEST 13: No sibling application is executed
  it("does not execute any sibling application (all runtimes UNKNOWN/NOT_PROBED)", () => {
    for (const agent of snapshot.sourceAgents) {
      expect(agent.runtimeStatus.state).toMatch(/^(UNKNOWN|NOT_PROBED)$/);
      expect(agent.runtimeStatus.probeKind).toBe("NONE");
      expect(agent.runtimeStatus.lastProbed == null).toBe(true);
    }
  });

  // TEST 14: No secrets or credentials are ingested
  it("does not ingest secrets or credentials", () => {
    for (const cap of snapshot.capabilities) {
      expect(cap.readAccess.every((r) => !r.includes("secret"))).toBe(true);
      expect(cap.readAccess.every((r) => !r.includes("credential"))).toBe(true);
      expect(cap.readAccess.every((r) => !r.includes(".env"))).toBe(true);
      expect(cap.readAccess.every((r) => !r.includes("private_key"))).toBe(true);
    }
    for (const perm of snapshot.sourcePermissions) {
      expect(perm.description.toLowerCase()).not.toContain("inherit secret");
      expect(perm.description.toLowerCase()).not.toContain("copy credential");
    }
  });

  // TEST 15: Empty or insufficient evidence produces UNKNOWN rather than invented data
  it("produces UNKNOWN for insufficient evidence, not invented data", () => {
    const identityCatalog = snapshot.sourceAgents.find((a) => a.sourceKey === "CF-IDENTITY-CATALOG");
    expect(identityCatalog).toBeDefined();
    expect(identityCatalog!.implementationClass).toBe("IDENTITY_CARD");
    const catalogOnlyAgents = snapshot.sourceAgents.filter(
      (a) => a.implementationClass === "CATALOG_ONLY" || a.implementationClass === "IDENTITY_CARD",
    );
    expect(catalogOnlyAgents.length).toBeGreaterThan(0);
    const unknownAgents = snapshot.sourceAgents.filter((a) => a.implementationClass === "UNKNOWN");
    for (const agent of unknownAgents) {
      expect(agent.verificationStatus).toBe("UNVERIFIED");
    }
    for (const cap of snapshot.capabilities) {
      if (cap.scope === "UNKNOWN") {
        expect(cap.canonicalCapabilityId).toBeNull();
      }
    }
  });

  // Phase 11.3 Gap Closure verification tests
  describe("gap closure verification", () => {
    it("all IMPLEMENTED agents have capabilities", () => {
      const implementedAgents = snapshot.sourceAgents.filter(
        (a) => a.implementationClass === "IMPLEMENTED",
      );
      const agentsWithCaps = new Set(snapshot.capabilities.map((c) => c.sourceAgentId));
      for (const agent of implementedAgents) {
        expect(agentsWithCaps.has(agent.id)).toBe(true);
      }
    });

    it("all PARTIAL agents have capabilities", () => {
      const partialAgents = snapshot.sourceAgents.filter((a) => a.implementationClass === "PARTIAL");
      const agentsWithCaps = new Set(snapshot.capabilities.map((c) => c.sourceAgentId));
      for (const agent of partialAgents) {
        expect(agentsWithCaps.has(agent.id)).toBe(true);
      }
    });

    it("CATALOG_ONLY agents correctly have no capabilities", () => {
      const catalogOnlyAgents = snapshot.sourceAgents.filter(
        (a) => a.implementationClass === "CATALOG_ONLY",
      );
      const agentsWithCaps = new Set(snapshot.capabilities.map((c) => c.sourceAgentId));
      for (const agent of catalogOnlyAgents) {
        expect(agentsWithCaps.has(agent.id)).toBe(false);
      }
      expect(catalogOnlyAgents.length).toBe(6);
    });

    it("STUB agents (non-implemented) have no capabilities", () => {
      const stubAgents = snapshot.sourceAgents.filter((a) => a.implementationClass === "STUB");
      const agentsWithCaps = new Set(snapshot.capabilities.map((c) => c.sourceAgentId));
      const stubsWithoutCaps = stubAgents.filter((a) => !agentsWithCaps.has(a.id));
      expect(stubsWithoutCaps.length).toBe(2);
    });

    it("exactly 44 capabilities exist for 44 capability-bearing agents", () => {
      expect(snapshot.capabilities.length).toBe(44);
      const uniqueAgents = new Set(snapshot.capabilities.map((c) => c.sourceAgentId));
      expect(uniqueAgents.size).toBe(44);
    });

    it("BrokerOS TRANSACTION_AGENT has capability", () => {
      const txAgent = snapshot.sourceAgents.find((a) => a.sourceKey === "TRANSACTION_AGENT");
      expect(txAgent).toBeDefined();
      const cap = snapshot.capabilities.find((c) => c.sourceAgentId === txAgent!.id);
      expect(cap).toBeDefined();
      expect(cap!.name).toBe("deal-resolution");
    });

    it("Vantera VAN-AG-002 has capability", () => {
      const ventos = snapshot.sourceAgents.find((a) => a.sourceKey === "VAN-AG-002");
      expect(ventos).toBeDefined();
      const cap = snapshot.capabilities.find((c) => c.sourceAgentId === ventos!.id);
      expect(cap).toBeDefined();
      expect(cap!.name).toBe("tenant-executive-snapshot");
    });

    it("all HotelOS IMPLEMENTED/PARTIAL agents have capabilities", () => {
      const hotelApp = snapshot.applications.find((a) => a.slug === "hotelos");
      const hotelAgents = snapshot.sourceAgents.filter(
        (a) =>
          a.applicationId === hotelApp!.id &&
          (a.implementationClass === "IMPLEMENTED" || a.implementationClass === "PARTIAL"),
      );
      const agentsWithCaps = new Set(snapshot.capabilities.map((c) => c.sourceAgentId));
      for (const agent of hotelAgents) {
        expect(agentsWithCaps.has(agent.id)).toBe(true);
      }
      expect(hotelAgents.length).toBe(16);
    });

    it("all CaseFlow IMPLEMENTED agents have capabilities", () => {
      const cfApp = snapshot.applications.find((a) => a.slug === "caseflow");
      const cfAgents = snapshot.sourceAgents.filter(
        (a) => a.applicationId === cfApp!.id && a.implementationClass === "IMPLEMENTED",
      );
      const agentsWithCaps = new Set(snapshot.capabilities.map((c) => c.sourceAgentId));
      for (const agent of cfAgents) {
        expect(agentsWithCaps.has(agent.id)).toBe(true);
      }
    });

    it("all LexStudy IMPLEMENTED agents have capabilities", () => {
      const lexApp = snapshot.applications.find((a) => a.slug === "lexstudy");
      const lexAgents = snapshot.sourceAgents.filter(
        (a) => a.applicationId === lexApp!.id && a.implementationClass === "IMPLEMENTED",
      );
      const agentsWithCaps = new Set(snapshot.capabilities.map((c) => c.sourceAgentId));
      for (const agent of lexAgents) {
        expect(agentsWithCaps.has(agent.id)).toBe(true);
      }
    });
  });

  // Additional architectural boundary tests
  describe("architectural boundaries", () => {
    it("SourceAgent ≠ FabricAgent — no identity conversion", () => {
      for (const agent of snapshot.sourceAgents) {
        expect(agent.atlasPromotionBlocked).toBe(true);
        expect(FABRIC_AGENT_IDS).not.toContain(agent.sourceKey);
      }
    });

    it("Capability ≠ Permission — capabilities describe, permissions control", () => {
      const capCount = snapshot.capabilities.length;
      const permCount = snapshot.sourcePermissions.length;
      expect(capCount).not.toBe(permCount);
      for (const cap of snapshot.capabilities) {
        expect("atlasInheritance" in cap).toBe(false);
      }
      for (const perm of snapshot.sourcePermissions) {
        expect("tools" in perm).toBe(false);
        expect("readAccess" in perm).toBe(false);
      }
    });

    it("Capability ≠ RuntimeStatus — capabilities are static extraction", () => {
      for (const cap of snapshot.capabilities) {
        expect("runtimeStatus" in cap).toBe(false);
        expect("probeKind" in cap).toBe(false);
      }
    });

    it("Evidence ≠ RuntimeStatus — evidence is documentation, not probe result", () => {
      for (const ev of snapshot.evidence) {
        expect(ev.kind).not.toBe("RUNTIME_PROBE");
        expect(ev.authorityRank).toMatch(
          /^(ARCHITECTURE_DOCUMENT|SOURCE_CODE|TEST_FILE|API_SCHEMA|CONFIGURATION|AUTOMATED_VERIFIED_TEST)$/,
        );
      }
    });

    it("SourceAgent ≠ Canonical Atlas Agent — mapping is optional, not identity", () => {
      const canonicals = new Map(
        snapshot.canonicalCapabilities.map((c) => [c.id, c]),
      );
      for (const cap of snapshot.capabilities) {
        if (cap.canonicalCapabilityId) {
          const canonical = canonicals.get(cap.canonicalCapabilityId);
          expect(canonical).toBeDefined();
        }
      }
      const unmappedCount = snapshot.capabilities.filter((c) => c.canonicalCapabilityId === null).length;
      expect(unmappedCount).toBeGreaterThan(0);
    });
  });
});

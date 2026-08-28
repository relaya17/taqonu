import { describe, expect, it } from "vitest";
import { FABRIC_AGENT_IDS } from "../constants/agents.js";
import {
  allSourceRuntimesUnknownOrNotProbed,
  loadSeedSnapshot,
  projectPortfolioInventory,
  sourceWriteNeverInherited,
} from "./index.js";

describe("Phase 11.2 application + source-agent inventory", () => {
  const snapshot = loadSeedSnapshot();
  const view = projectPortfolioInventory(snapshot);

  it("projects the same application records — not a second registry", () => {
    expect(view.applications).toBe(snapshot.applications);
    expect(view.notAnAgentRegistry).toBe(true);
    expect(view.executionRegistry).toBe("FABRIC_AGENT_CATALOG");
    expect(snapshot.applications).toHaveLength(6);
    expect(snapshot.applications.map((a) => a.slug)).toEqual([
      "atlas",
      "vantera",
      "hotelos",
      "caseflow",
      "brokeros",
      "lexstudy",
    ]);
  });

  it("inventories Vantera source agents without treating them as Fabric agents", () => {
    const vantera = snapshot.applications.find((a) => a.slug === "vantera");
    const vanteraAgents = snapshot.sourceAgents.filter(
      (a) => a.applicationId === vantera?.id,
    );
    expect(vanteraAgents).toHaveLength(3);
    expect(vanteraAgents.map((a) => a.sourceKey)).toEqual([
      "VAN-AG-001",
      "VAN-AG-002",
      "VAN-AG-003",
    ]);
    for (const agent of vanteraAgents) {
      expect(agent.atlasPromotionBlocked).toBe(true);
      expect("fabricAgentId" in agent).toBe(false);
      expect(FABRIC_AGENT_IDS).not.toContain(agent.sourceKey);
    }
  });

  it("keeps every source runtime UNKNOWN / NOT_PROBED unless proven", () => {
    expect(allSourceRuntimesUnknownOrNotProbed(snapshot)).toBe(true);
    for (const agent of snapshot.sourceAgents) {
      expect(agent.runtimeStatus.state).toBe("UNKNOWN");
      expect(agent.runtimeStatus.probeKind).toBe("NONE");
      expect(agent.runtimeStatus.probedAt).toBeNull();
    }
  });

  it("never assigns a FabricAgentId and never inherits source WRITE", () => {
    expect(view.sourceAgentRows.every((row) => row.fabricAgentId === null)).toBe(true);
    expect(view.sourceAgentRows.map((row) => row.sourceAgent)).toEqual(snapshot.sourceAgents);
    expect(sourceWriteNeverInherited(snapshot)).toBe(true);
    expect(snapshot.safety.ingestEnabled).toBe(false);
    expect(snapshot.safety.sourceExecutionEnabled).toBe(false);
    // Phase 11.15: 4 knowledge records were Owner-approved and ingested
    // ingestEnabled remains false to prevent unapproved future ingestion
    const ingestedCount = snapshot.knowledgeRecords.filter((r) => r.ingested).length;
    expect(ingestedCount).toBe(4);
    expect(snapshot.knowledgeRecords.every((r) => r.ingestEnabled === false)).toBe(true);
    expect(FABRIC_AGENT_IDS).toHaveLength(16);
  });

  it("joins implementation, capabilities, verification, runtime, provenance, evidence, and decisions", () => {
    expect(view.sourceAgentRows.length).toBe(snapshot.sourceAgents.length);
    expect(view.sourceAgentRows.length).toBeGreaterThan(40);
    for (const row of view.sourceAgentRows) {
      expect(row.sourceAgent.implementationClass.length).toBeGreaterThan(0);
      expect(row.sourceAgent.verificationStatus.length).toBeGreaterThan(0);
      expect(row.runtimeLabel).toMatch(/UNKNOWN \/ NOT_PROBED/);
      expect(row.provenanceLabel).toContain(row.sourceAgent.provenance.sourceRepository);
      expect(row.application?.id).toBe(row.sourceAgent.applicationId);
      expect(row.application?.slug).not.toBe("ORCHESTRATOR");
    }
  });
});

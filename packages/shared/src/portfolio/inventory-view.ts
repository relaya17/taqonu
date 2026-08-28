/**
 * Phase 11.2 owner inventory view.
 * Projects the Portfolio Governance snapshot. Does not create a second registry,
 * does not copy Application / SourceAgent records, and never assigns FabricAgentId.
 */
import type {
  PortfolioApplication,
  PortfolioGovernanceSnapshot,
  PortfolioSourceAgent,
} from "../schemas/portfolio-governance.schema.js";

export type PortfolioSourceAgentRow = {
  readonly sourceAgent: PortfolioSourceAgent;
  readonly application: PortfolioApplication | null;
  readonly capabilityNames: readonly string[];
  readonly evidenceCount: number;
  readonly evidenceKinds: readonly string[];
  readonly governanceDecision: string;
  readonly fabricAgentId: null;
  readonly runtimeLabel: string;
  readonly provenanceLabel: string;
};

export type PortfolioInventoryView = {
  readonly applications: readonly PortfolioApplication[];
  readonly sourceAgentRows: readonly PortfolioSourceAgentRow[];
  readonly notAnAgentRegistry: true;
  readonly executionRegistry: "FABRIC_AGENT_CATALOG";
};

export function projectPortfolioInventory(
  snapshot: PortfolioGovernanceSnapshot,
): PortfolioInventoryView {
  const appsById = new Map(snapshot.applications.map((app) => [app.id, app]));
  const capsByAgent = new Map<string, string[]>();
  for (const cap of snapshot.capabilities) {
    const list = capsByAgent.get(cap.sourceAgentId) ?? [];
    list.push(cap.name);
    capsByAgent.set(cap.sourceAgentId, list);
  }
  const evidenceByAgent = new Map<string, string[]>();
  for (const ev of snapshot.evidence) {
    if (!ev.sourceAgentId) continue;
    const list = evidenceByAgent.get(ev.sourceAgentId) ?? [];
    list.push(ev.kind);
    evidenceByAgent.set(ev.sourceAgentId, list);
  }
  const decisionByAgent = new Map<string, string>();
  for (const d of snapshot.governanceDecisions) {
    if (!d.sourceAgentId) continue;
    decisionByAgent.set(d.sourceAgentId, `${d.action} / ${d.status}`);
  }

  return {
    applications: snapshot.applications,
    sourceAgentRows: snapshot.sourceAgents.map((sourceAgent) => {
      const evidenceKinds = evidenceByAgent.get(sourceAgent.id) ?? [];
      const p = sourceAgent.provenance;
      return {
        sourceAgent,
        application: appsById.get(sourceAgent.applicationId) ?? null,
        capabilityNames: capsByAgent.get(sourceAgent.id) ?? [],
        evidenceCount: evidenceKinds.length,
        evidenceKinds,
        governanceDecision: decisionByAgent.get(sourceAgent.id) ?? "NONE",
        fabricAgentId: null,
        runtimeLabel: `${sourceAgent.runtimeStatus.state} / ${sourceAgent.runtimeStatus.probeKind === "NONE" ? "NOT_PROBED" : sourceAgent.runtimeStatus.probeKind}`,
        provenanceLabel: `${p.sourceRepository} @ ${p.sourceCommit.slice(0, 12)} · ${p.sourcePath}`,
      };
    }),
    notAnAgentRegistry: true,
    executionRegistry: "FABRIC_AGENT_CATALOG",
  };
}

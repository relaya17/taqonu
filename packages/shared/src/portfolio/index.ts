import { FABRIC_AGENT_IDS } from "../constants/agents.js";
import {
  requiresOwnerAndCatalogChange,
  type GovernanceDecisionAction,
} from "../constants/portfolio-governance.js";
import {
  portfolioGovernanceOverlaySchema,
  portfolioGovernanceSnapshotSchema,
  type PortfolioGovernanceDecision,
  type PortfolioGovernanceOverlay,
  type PortfolioGovernanceSnapshot,
  type PortfolioSourceAgent,
} from "../schemas/portfolio-governance.schema.js";
import { buildPortfolioSeedSnapshot } from "./seed.js";
export {
  projectPortfolioInventory,
  type PortfolioInventoryView,
  type PortfolioSourceAgentRow,
} from "./inventory-view.js";

export const PORTFOLIO_OVERLAY_META_KEY = "portfolio.governance.overlay.v1";

export function emptyOverlay(now = new Date().toISOString()): PortfolioGovernanceOverlay {
  return portfolioGovernanceOverlaySchema.parse({
    version: 1,
    updatedAt: now,
    governanceDecisions: [],
    auditEvents: [],
  });
}

export function emptyPortfolioSnapshot(
  now = new Date().toISOString(),
): PortfolioGovernanceSnapshot {
  return portfolioGovernanceSnapshotSchema.parse({
    version: 1,
    extractedAt: now,
    applications: [],
    sourceAgents: [],
    sourceCodeRecords: [],
    knowledgeRecords: [],
    capabilities: [],
    canonicalCapabilities: [],
    fabricAgentRefs: [],
    sourcePermissions: [],
    atlasPermissions: [],
    evidence: [],
    dedupRelations: [],
    conflicts: [],
    governanceDecisions: [],
    auditEvents: [],
  });
}

export function mergePortfolioSnapshot(
  seed: PortfolioGovernanceSnapshot,
  overlay: PortfolioGovernanceOverlay,
): PortfolioGovernanceSnapshot {
  const byId = new Map(seed.governanceDecisions.map((d) => [d.id, d]));
  for (const d of overlay.governanceDecisions) {
    byId.set(d.id, d);
  }
  return portfolioGovernanceSnapshotSchema.parse({
    ...seed,
    governanceDecisions: [...byId.values()],
    auditEvents: [...seed.auditEvents, ...overlay.auditEvents],
  });
}

export function loadSeedSnapshot(): PortfolioGovernanceSnapshot {
  return buildPortfolioSeedSnapshot();
}

/**
 * Owner/operator decision. Never mutates FABRIC_AGENT_CATALOG.
 * CREATE_NEW / ADAPT stay pending a separate catalog code change.
 */
export function applyGovernanceDecision(input: {
  readonly snapshot: PortfolioGovernanceSnapshot;
  readonly overlay: PortfolioGovernanceOverlay;
  readonly action: GovernanceDecisionAction;
  readonly verdict: "APPROVED" | "DENIED";
  readonly rationale: string;
  readonly actorId: string;
  readonly applicationId?: string | null;
  readonly sourceAgentId?: string | null;
  readonly capabilityId?: string | null;
  readonly now?: string;
}): {
  readonly overlay: PortfolioGovernanceOverlay;
  readonly decision: PortfolioGovernanceDecision;
} {
  const now = input.now ?? new Date().toISOString();
  if (input.sourceAgentId) {
    const agent = input.snapshot.sourceAgents.find((a) => a.id === input.sourceAgentId);
    if (!agent) {
      throw new Error("Unknown source agent — cannot decide");
    }
    if (!agent.atlasPromotionBlocked) {
      throw new Error("Source agent must remain promotion-blocked");
    }
  }

  const pendingFabric =
    input.verdict === "APPROVED" && requiresOwnerAndCatalogChange(input.action);
  const decision: PortfolioGovernanceDecision = {
    id: globalThis.crypto.randomUUID(),
    action: input.action,
    status:
      input.verdict === "DENIED"
        ? "DENIED"
        : pendingFabric
          ? "APPROVED_PENDING_FABRIC_CHANGE"
          : "APPROVED",
    applicationId: input.applicationId ?? null,
    sourceAgentId: input.sourceAgentId ?? null,
    capabilityId: input.capabilityId ?? null,
    rationale: input.rationale,
    decidedBy: input.actorId,
    decidedAt: now,
    fabricCatalogMutated: false,
    knowledgeIngested: false,
  };

  const overlay: PortfolioGovernanceOverlay = {
    version: 1,
    updatedAt: now,
    governanceDecisions: [...input.overlay.governanceDecisions, decision],
    auditEvents: [
      ...input.overlay.auditEvents,
      {
        id: globalThis.crypto.randomUUID(),
        at: now,
        type: "portfolio.governance.decided",
        actorId: input.actorId,
        payload: {
          action: input.action,
          verdict: input.verdict,
          status: decision.status,
          sourceAgentId: decision.sourceAgentId,
          fabricCatalogMutated: false,
          knowledgeIngested: false,
          ingestExecuted: false,
          catalogCodeChangeRequired: pendingFabric,
        },
      },
    ],
  };

  return {
    overlay: portfolioGovernanceOverlaySchema.parse(overlay),
    decision,
  };
}

export function sourceAgentCannotBecomeFabric(
  agent: PortfolioSourceAgent,
  fabricIds: readonly string[] = FABRIC_AGENT_IDS,
): boolean {
  return agent.atlasPromotionBlocked && !fabricIds.includes(agent.sourceKey);
}

export function sourceWriteNeverInherited(
  snapshot: PortfolioGovernanceSnapshot,
): boolean {
  return snapshot.sourcePermissions.every((p) => p.atlasInheritance === "NONE");
}

export function atlasPermissionsNeverFromSource(
  snapshot: PortfolioGovernanceSnapshot,
): boolean {
  return snapshot.atlasPermissions.every(
    (p) => p.inheritedFromSourceAgentId === null && p.source === "FABRIC_CATALOG",
  );
}

export function sourceCodeNeverCopied(
  snapshot: PortfolioGovernanceSnapshot,
): boolean {
  return snapshot.sourceCodeRecords.every(
    (r) => r.copiedIntoAtlas === false && r.bytesCopied === 0,
  );
}

export function knowledgeNeverIngestedInRecords(
  snapshot: PortfolioGovernanceSnapshot,
): boolean {
  return snapshot.knowledgeRecords.every(
    (r) => r.ingested === false && r.ingestEnabled === false,
  );
}

export function fabricRefsAreNotAnExecutionRegistry(
  snapshot: PortfolioGovernanceSnapshot,
): boolean {
  return snapshot.fabricAgentRefs.every(
    (r) =>
      r.executableViaPortfolioGovernance === false && r.isExecutionRegistry === false,
  );
}

export function allSourceRuntimesUnknownOrNotProbed(
  snapshot: PortfolioGovernanceSnapshot,
): boolean {
  return snapshot.sourceAgents.every(
    (a) =>
      (a.runtimeStatus.state === "UNKNOWN" || a.runtimeStatus.state === "NOT_PROBED") &&
      a.runtimeStatus.probeKind === "NONE" &&
      a.runtimeStatus.probedAt === null,
  );
}

export function verificationDistinctFromRuntime(
  snapshot: PortfolioGovernanceSnapshot,
): boolean {
  return snapshot.sourceAgents.every((a) => {
    if (a.verificationStatus !== "VERIFIED") return true;
    return (
      (a.runtimeStatus.state === "UNKNOWN" || a.runtimeStatus.state === "NOT_PROBED") &&
      a.runtimeStatus.probeKind === "NONE" &&
      a.runtimeStatus.probedAt === null
    );
  });
}

export function noKnowledgeIngested(
  snapshot: PortfolioGovernanceSnapshot,
): boolean {
  return snapshot.governanceDecisions.every((d) => d.knowledgeIngested === false);
}

export function noFabricCatalogMutation(
  snapshot: PortfolioGovernanceSnapshot,
): boolean {
  return snapshot.governanceDecisions.every((d) => d.fabricCatalogMutated === false);
}

export function buildPortfolioSummary(snapshot: PortfolioGovernanceSnapshot) {
  const ingestedKnowledgeCount = snapshot.knowledgeRecords.filter(
    (r) => r.ingested,
  ).length;
  return {
    version: snapshot.version,
    extractedAt: snapshot.extractedAt,
    applicationCount: snapshot.applications.length,
    sourceAgentCount: snapshot.sourceAgents.length,
    capabilityCount: snapshot.capabilities.length,
    canonicalCapabilityCount: snapshot.canonicalCapabilities.length,
    fabricCanonicalCount: snapshot.canonicalCapabilities.filter(
      (c) => c.kind === "FABRIC_RUNTIME",
    ).length,
    knowledgeOnlyCanonicalCount: snapshot.canonicalCapabilities.filter(
      (c) => c.kind === "KNOWLEDGE_ONLY",
    ).length,
    sourcePermissionCount: snapshot.sourcePermissions.length,
    atlasPermissionCount: snapshot.atlasPermissions.length,
    sourceCodeRecordCount: snapshot.sourceCodeRecords.length,
    knowledgeRecordCount: snapshot.knowledgeRecords.length,
    ingestedKnowledgeCount,
    fabricAgentRefCount: snapshot.fabricAgentRefs.length,
    conflictCount: snapshot.conflicts.length,
    dedupRelationCount: snapshot.dedupRelations.length,
    proposedDecisionCount: snapshot.governanceDecisions.filter(
      (d) => d.status === "PROPOSED",
    ).length,
    pendingFabricChangeCount: snapshot.governanceDecisions.filter(
      (d) => d.status === "APPROVED_PENDING_FABRIC_CHANGE",
    ).length,
    executionRegistry: "FABRIC_AGENT_CATALOG" as const,
    controlPlaneAgentDefinitionsAreNotExecution: true,
    knowledgeIngested: ingestedKnowledgeCount > 0,
    fabricCatalogMutated: false,
    ingestEnabled: false,
    sourceExecutionEnabled: false,
    sourceRuntimeDefault: "UNKNOWN" as const,
    allSourceRuntimesUnknown: allSourceRuntimesUnknownOrNotProbed(snapshot),
    sourceWriteNeverInherited: sourceWriteNeverInherited(snapshot),
    atlasPermissionsNeverFromSource: atlasPermissionsNeverFromSource(snapshot),
    sourceCodeNeverCopied: sourceCodeNeverCopied(snapshot),
    knowledgeNeverIngestedInRecords: knowledgeNeverIngestedInRecords(snapshot),
    fabricRefsAreNotAnExecutionRegistry: fabricRefsAreNotAnExecutionRegistry(snapshot),
    verificationDistinctFromRuntime: verificationDistinctFromRuntime(snapshot),
    safety: snapshot.safety,
  };
}

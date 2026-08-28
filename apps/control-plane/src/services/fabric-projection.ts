/**
 * Fabric catalog projection for Control Plane oversight.
 *
 * This is NOT an execution registry and MUST NOT become one.
 * Agents that actually execute inside Atlas are listed only in
 * FABRIC_AGENT_CATALOG (packages/shared). AGENT_DEFINITIONS remains the
 * legacy 9-item oversight list for backward-compatible GET /api/v1/agents.
 */
import {
  FABRIC_AGENT_CATALOG,
  FABRIC_AGENT_IDS,
  type FabricAgentId,
} from "@atlas/shared";

export const FABRIC_EXECUTION_REGISTRY = "FABRIC_AGENT_CATALOG" as const;

export interface FabricProjectionItem {
  readonly agentId: FabricAgentId;
  readonly displayName: string;
  readonly catalogStatus: "LAB";
  readonly canWriteCode: boolean;
  readonly allowedTools: readonly string[];
  readonly forbiddenTools: readonly string[];
  readonly executionEnabledByThisProjection: false;
}

export interface FabricProjection {
  readonly kind: "FABRIC_PROJECTION";
  readonly executionAuthority: typeof FABRIC_EXECUTION_REGISTRY;
  readonly notAnExecutionRegistry: true;
  readonly defaultCatalogStatus: "LAB";
  readonly items: readonly FabricProjectionItem[];
}

export function getFabricProjection(): FabricProjection {
  return {
    kind: "FABRIC_PROJECTION",
    executionAuthority: FABRIC_EXECUTION_REGISTRY,
    notAnExecutionRegistry: true,
    defaultCatalogStatus: "LAB",
    items: FABRIC_AGENT_IDS.map((id) => {
      const def = FABRIC_AGENT_CATALOG[id];
      return {
        agentId: id,
        displayName: def.title,
        catalogStatus: "LAB" as const,
        canWriteCode: def.canWriteCode,
        allowedTools: [...def.allowedTools],
        forbiddenTools: [...def.forbiddenTools],
        executionEnabledByThisProjection: false as const,
      };
    }),
  };
}

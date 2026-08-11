import {
  FABRIC_AGENT_CATALOG,
  FABRIC_AGENT_IDS,
  type FabricAgentId,
  type FabricAgentDefinition,
} from "@atlas/shared";

export function listFabricAgents(): FabricAgentDefinition[] {
  return FABRIC_AGENT_IDS.map((id) => FABRIC_AGENT_CATALOG[id]);
}

export function getFabricAgent(id: FabricAgentId): FabricAgentDefinition {
  return FABRIC_AGENT_CATALOG[id];
}

import {
  FABRIC_AGENT_CATALOG,
  FABRIC_AGENT_IDS,
  registeredAgentSchema,
  type FabricAgentId,
  type RegisteredAgent,
} from "@atlas/shared";

function basePermissions(id: FabricAgentId): RegisteredAgent["permissions"] {
  const common: RegisteredAgent["permissions"] = ["READ_REPO", "READ_EVIDENCE"];
  if (id === "ORCHESTRATOR") return [...common, "ORCHESTRATE", "ESCALATE"];
  if (id === "JUDGE") return [...common, "JUDGE", "ESCALATE"];
  if (id === "RESEARCHER") return [...common, "CALL_EXTERNAL", "WRITE_EVIDENCE"];
  if (
    id === "CODE_ENGINEER" ||
    id === "DEBUGGER" ||
    id === "TEST_ENGINEER"
  ) {
    return [...common, "PROPOSE_PATCH", "WRITE_EVIDENCE"];
  }
  return [...common, "WRITE_EVIDENCE"];
}

/** Phase 1 — central Agent Registry (contracts only, no `any`). */
export function buildRegisteredAgent(id: FabricAgentId): RegisteredAgent {
  const def = FABRIC_AGENT_CATALOG[id];
  return registeredAgentSchema.parse({
    id: def.id,
    name: def.title,
    version: "1.0.0",
    status: "LAB",
    capabilities: def.specialty
      .split("·")
      .map((s) => s.trim().toLowerCase().replace(/\s+/g, "_"))
      .filter(Boolean)
      .slice(0, 8),
    tools: [...def.allowedTools],
    forbiddenTools: [...def.forbiddenTools],
    permissions: basePermissions(id),
    inputSchema: {
      type: "object",
      required: ["request"],
      properties: {
        request: { type: "string" },
        evidencePackageIds: { type: "array", items: { type: "string" } },
        projectId: { type: ["string", "null"] },
      },
    },
    outputSchema: {
      type: "object",
      required: ["summary", "evidence", "epistemicState"],
      properties: {
        summary: { type: "string" },
        evidence: { type: "array" },
        epistemicState: { type: "string" },
        insufficientEvidence: { type: "boolean" },
      },
    },
    evidencePolicy: {
      minAuthority: id === "JUDGE" || id === "SECURITY" ? 0.7 : 0.4,
      requireFreshness: id === "RESEARCHER" || id === "SECURITY",
      allowInsufficient: true,
      refuseHallucination: true,
    },
    riskLevel: def.riskLevel,
    costBudgetUsd: def.maxCostUsd,
    timeoutMs: def.timeoutMs,
    evaluationSuite: def.evaluationSuite,
    canWriteCode: def.canWriteCode,
    trustLevel: "LAB",
  });
}

export function listRegisteredAgents(): RegisteredAgent[] {
  return FABRIC_AGENT_IDS.map(buildRegisteredAgent);
}

export function getRegisteredAgent(id: FabricAgentId): RegisteredAgent {
  return buildRegisteredAgent(id);
}

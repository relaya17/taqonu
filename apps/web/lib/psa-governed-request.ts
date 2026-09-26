import { FABRIC_AGENT_IDS, type FabricAgentId } from "@atlas/shared";

const FABRIC = new Set<string>(FABRIC_AGENT_IDS);

/**
 * PSA request body for the existing governed proposal route.
 * The specialist id is a Fabric catalog id. The PSA id is not accepted.
 * The attached evidence is the user's own statement, marked PROPOSED.
 */
export function buildPsaGovernedRequest(input: {
  readonly specialistId: string;
  readonly ownerId: string;
  readonly projectId: string;
  readonly reason: string;
  readonly now: string;
  readonly taskId: string;
  readonly evidenceId: string;
}) {
  if (!FABRIC.has(input.specialistId) || input.specialistId.startsWith("psa:")) {
    throw new Error("Request requires a Fabric specialist id");
  }
  const reason = input.reason.trim();
  if (!reason) {
    throw new Error("Request reason is required");
  }
  return {
    agentId: input.specialistId as FabricAgentId,
    taskId: input.taskId,
    projectId: input.projectId,
    action: { entityType: "RECORD", action: "READ" },
    inputs: { request: reason },
    claims: [reason],
    evidence: [
      {
        id: input.evidenceId,
        ownerId: input.ownerId,
        projectId: input.projectId,
        source: "psa.request",
        sourceType: "USER" as const,
        sourceId: null,
        uri: null,
        excerpt: reason,
        version: null,
        observedAt: input.now,
        createdAt: input.now,
        confidence: 0.4,
        epistemicState: "PROPOSED" as const,
        category: "DECISIONS" as const,
        classification: "INTERNAL" as const,
        authorityRank: "DEVELOPER_STATEMENT" as const,
        metadata: { kind: "psa.request" },
      },
    ],
    confidence: 0.4,
    rationale: reason,
  };
}

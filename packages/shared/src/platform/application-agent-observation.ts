/**
 * CTRL-018 — observed vs expected application Agent IDs.
 *
 * Expected is an application-owned declaration (operator acting for that app).
 * Atlas does not invent, first-see, or promote IDs into Fabric.
 * Classification is observational: it must not change authorization.
 */

import { FABRIC_AGENT_IDS } from "../constants/agents.js";
import { applicationOwnedAgentId } from "./application-preflight.js";

export const APPLICATION_AGENT_OBSERVATIONS = [
  "EXPECTED",
  "UNEXPECTED",
  "UNKNOWN",
] as const;

export type ApplicationAgentObservation =
  (typeof APPLICATION_AGENT_OBSERVATIONS)[number];

const FABRIC = new Set<string>(FABRIC_AGENT_IDS);

/**
 * Reserved identities are CTRL-014 impersonation, not CTRL-018 UNEXPECTED.
 */
export function isReservedApplicationAgentId(
  value: string | null | undefined,
): boolean {
  const agentId = applicationOwnedAgentId(value);
  if (!agentId) return false;
  return (
    agentId.startsWith("psa:") ||
    agentId.startsWith("cp:") ||
    FABRIC.has(agentId)
  );
}

/**
 * Parse an application-owned Expected declaration.
 * `undefined` / missing → no declaration (`null`).
 * Present (including empty / whitespace) → a set (possibly empty).
 */
export function parseApplicationExpectedAgentIds(
  raw: string | undefined,
): readonly string[] | null {
  if (raw === undefined) return null;
  const ids = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return ids;
}

export function classifyApplicationAgentObservation(input: {
  readonly observedAgentId: string | null | undefined;
  readonly expectedAgentIds: readonly string[] | null;
}): {
  readonly observation: ApplicationAgentObservation | null;
  readonly reserved: boolean;
  readonly observedAgentId: string | null;
} {
  const observedAgentId = applicationOwnedAgentId(input.observedAgentId);
  if (isReservedApplicationAgentId(observedAgentId)) {
    return { observation: null, reserved: true, observedAgentId };
  }
  if (observedAgentId === null) {
    return { observation: "UNKNOWN", reserved: false, observedAgentId };
  }
  if (input.expectedAgentIds === null || input.expectedAgentIds.length === 0) {
    return { observation: "UNKNOWN", reserved: false, observedAgentId };
  }
  if (input.expectedAgentIds.includes(observedAgentId)) {
    return { observation: "EXPECTED", reserved: false, observedAgentId };
  }
  return { observation: "UNEXPECTED", reserved: false, observedAgentId };
}

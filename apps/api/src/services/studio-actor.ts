/**
 * Actor classification for Studio writes. This is a header check.
 * It does not open a terminal and must not import the PTY module.
 * ask-agent and governed execution stay free of that module.
 */
export function isAgentActorRequest(headers: Record<string, unknown>): boolean {
  const actor = String(headers["x-atlas-actor-kind"] ?? "").trim().toUpperCase();
  const agentId = String(headers["x-atlas-agent-id"] ?? "").trim();
  return actor === "AGENT" || agentId.length > 0;
}

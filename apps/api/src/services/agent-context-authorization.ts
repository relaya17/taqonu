import {
  personalSupervisingAgentId,
  type Memory,
  type ProjectStateSnapshot,
} from "@atlas/shared";
import { osStore } from "../store/os-store.js";
import { memoryIsVisibleToAgent } from "./memory-pipeline.js";

/**
 * Stage 4 (approved 2026-09-26): identity and context boundary for the
 * human-initiated assistant runs (`POST /api/v1/agent/runs`,
 * `POST /api/v1/conversation/message`).
 *
 * The acting identity is derived from the authenticated session only:
 * `psa:<session owner>`. It is never taken from the request body, query,
 * a client-selected agent id, or a self-asserted header.
 */
export type AssistantRunIdentity = {
  /** Server-derived acting agent identity. */
  readonly agentId: string;
  readonly actorKind: "AGENT";
  /** The authenticated human the run acts for. */
  readonly onBehalfOfUserId: string;
  /** Owner boundary for memory: always the session owner, never "all owners". */
  readonly ownerId: string;
};

export function assistantRunIdentity(sessionOwnerId: string): AssistantRunIdentity {
  const ownerId = sessionOwnerId.trim();
  if (ownerId.length === 0) {
    throw new Error("assistantRunIdentity requires an authenticated session owner");
  }
  return {
    agentId: personalSupervisingAgentId(ownerId),
    actorKind: "AGENT",
    onBehalfOfUserId: ownerId,
    ownerId,
  };
}

/** Snapshot slices whose summary copies memory statements (state reconciliation). */
const MEMORY_DERIVED_SLICES = new Set(["TASKS", "RISKS"]);
const MEMORY_DERIVED_TYPES = new Set(["TASK", "GOAL", "BUG"]);
const SUMMARY_SEPARATOR = " · ";
export const WITHHELD_SNAPSHOT_SUMMARY =
  "Withheld from agent context: memory-derived content not authorized for this identity.";

function reconciliationMemories(projectId: string): Memory[] {
  return [...osStore.getMemories(projectId), ...osStore.getMemories("global")].filter(
    (memory) => MEMORY_DERIVED_TYPES.has(memory.type),
  );
}

/**
 * A reconciled snapshot copies TASK/GOAL/BUG memory statements into the TASKS
 * and RISKS slice summaries without memory ids. Before a snapshot enters an
 * agent/LLM context, remove every memory-derived statement that the acting
 * identity may not read under the memory visibility contract. Non-memory
 * content (open tasks, known risks, docs, decisions) is kept. The stored
 * snapshot itself is never modified.
 */
export function authorizeSnapshotForAgentContext(
  snapshot: ProjectStateSnapshot | null,
  agentId: string,
): ProjectStateSnapshot | null {
  if (!snapshot) return null;
  const candidates = reconciliationMemories(snapshot.projectId);
  const permitted = new Set<string>();
  const withheld = new Set<string>();
  for (const memory of candidates) {
    if (memoryIsVisibleToAgent(memory, agentId)) permitted.add(memory.statement);
    else withheld.add(memory.statement);
  }
  const slices = snapshot.slices.map((slice) => {
    if (!MEMORY_DERIVED_SLICES.has(slice.key)) return slice;
    const parts = slice.summary.split(SUMMARY_SEPARATOR);
    const kept = parts.filter((part) => !withheld.has(part) || permitted.has(part));
    if (kept.length === parts.length) return slice;
    return {
      ...slice,
      summary: kept.length > 0 ? kept.join(SUMMARY_SEPARATOR) : WITHHELD_SNAPSHOT_SUMMARY,
    };
  });
  return { ...snapshot, slices };
}

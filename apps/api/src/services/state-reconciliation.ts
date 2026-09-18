import {
  parseEvidenceRecord,
  SYSTEM_OWNER_ID,
  type Decision,
  type EvidenceRecord,
  type Memory,
  type ProjectStateSnapshot,
} from "@atlas/shared";
import {
  buildObservationFromSyncPayload,
  observationToEvidenceDrafts,
} from "@atlas/integrations-github";
import { reconcileProjectState } from "@atlas/state";
import { osStore } from "../store/os-store.js";
import { getProjectOwnerId } from "./project-access.js";
import { resolveEvidenceOwnerId } from "./write-owner.js";

/**
 * Memories that may enter a persisted project snapshot.
 *
 * `"global"` is the store key for memories with `projectId: null` — it is
 * not a cross-tenant bulletin board. Retrieve/export already owner-filter
 * that pool (A3). Reconciliation previously loaded every owner's global
 * rows, and TASKS/RISKS copy `statement` into the snapshot the project
 * owner later reads.
 *
 * Keep: all memories already stored under this project id (write-gated to
 * owner/admin), the project owner's unscoped memories, and SYSTEM actor
 * memories. Omit: other tenants' global memories.
 */
function memoriesForProjectReconciliation(projectId: string): Memory[] {
  const projectOwnerId = getProjectOwnerId(projectId);
  const onProject = osStore.getMemories(projectId);
  const globalVisible = osStore.getMemories("global").filter((memory) => {
    if (memory.ownerId === SYSTEM_OWNER_ID) return true;
    return projectOwnerId !== null && memory.ownerId === projectOwnerId;
  });
  return [...onProject, ...globalVisible];
}

function decisionsForProjectReconciliation(projectId: string): Decision[] {
  const projectOwnerId = getProjectOwnerId(projectId);
  const onProject = osStore.getDecisions(projectId);
  const globalVisible = osStore.getDecisions("global").filter((decision) => {
    if (!decision.ownerId) return false;
    if (decision.ownerId === SYSTEM_OWNER_ID) return true;
    return projectOwnerId !== null && decision.ownerId === projectOwnerId;
  });
  return [...onProject, ...globalVisible];
}

export function ingestGitHubSync(
  projectId: string,
  payload: Parameters<typeof buildObservationFromSyncPayload>[0],
  ownerId?: string,
): {
  observation: ReturnType<typeof buildObservationFromSyncPayload>;
  evidence: EvidenceRecord[];
} {
  const observation = buildObservationFromSyncPayload(payload);
  osStore.setGitHubObservation(projectId, observation);

  const drafts = observationToEvidenceDrafts(observation);
  const now = new Date().toISOString();
  const resolvedOwnerId = resolveEvidenceOwnerId({
    requestOwnerId: ownerId,
    projectId,
  });
  const evidence = drafts.map((draft) =>
    parseEvidenceRecord({
      id: crypto.randomUUID(),
      ownerId: resolvedOwnerId,
      projectId,
      source: draft.source,
      sourceType: draft.sourceType,
      sourceId: draft.sourceId,
      uri: draft.uri,
      excerpt: draft.excerpt,
      version: draft.version,
      observedAt: draft.observedAt,
      createdAt: now,
      confidence: draft.confidence,
      epistemicState: draft.epistemicState,
      category: draft.category,
      metadata: draft.metadata,
    }),
  );

  osStore.addEvidence(projectId, evidence);
  osStore.recordEvent({
    type: "github.sync.completed",
    projectId,
    fullName: observation.fullName,
    evidenceCount: evidence.length,
    occurredAt: now,
  });

  return { observation, evidence };
}

export function runStateReconciliation(projectId: string): ProjectStateSnapshot {
  const result = reconcileProjectState({
    projectId,
    observations: osStore.getObservations(projectId),
    evidence: osStore.getEvidence(projectId),
    claims: osStore.getClaims(projectId),
    memories: memoriesForProjectReconciliation(projectId),
    decisions: decisionsForProjectReconciliation(projectId),
    openTasks: osStore.openTasks.get(projectId) ?? [
      "Keep GitHub sync current",
      "Capture architectural decisions with evidence",
    ],
  });

  osStore.setSnapshot(result.snapshot);
  osStore.recordEvent({
    ...result.domainEvent,
    occurredAt: new Date().toISOString(),
  });

  return result.snapshot;
}

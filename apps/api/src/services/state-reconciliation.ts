import {
  evidenceRecordSchema,
  type EvidenceRecord,
  type ProjectStateSnapshot,
} from "@atlas/shared";
import {
  buildObservationFromSyncPayload,
  observationToEvidenceDrafts,
} from "@atlas/integrations-github";
import { reconcileProjectState } from "@atlas/state";
import { osStore } from "../store/os-store.js";

const OWNER_ID = "00000000-0000-4000-8000-000000000001";

export function ingestGitHubSync(
  projectId: string,
  payload: Parameters<typeof buildObservationFromSyncPayload>[0],
): {
  observation: ReturnType<typeof buildObservationFromSyncPayload>;
  evidence: EvidenceRecord[];
} {
  const observation = buildObservationFromSyncPayload(payload);
  osStore.setGitHubObservation(projectId, observation);

  const drafts = observationToEvidenceDrafts(observation);
  const now = new Date().toISOString();
  const evidence = drafts.map((draft) =>
    evidenceRecordSchema.parse({
      id: crypto.randomUUID(),
      ownerId: OWNER_ID,
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
    memories: [
      ...osStore.getMemories(projectId),
      ...osStore.getMemories("global"),
    ],
    decisions: [
      ...osStore.getDecisions(projectId),
      ...osStore.getDecisions("global"),
    ],
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

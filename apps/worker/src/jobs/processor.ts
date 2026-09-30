import { reconcileProjectState, type ReconciliationInput } from "@atlas/state";
import type { Logger } from "@atlas/observability";

export type WorkerJobKind =
  | "github.initial_sync"
  | "github.webhook_ingest"
  | "state.reconcile"
  // GAP-APP-02: intentionally inert placeholders, not implemented, no callers enqueue them yet — see the fallthrough in processJob().
  | "embeddings.generate"
  | "memory.extract";

export interface WorkerJob {
  readonly id: string;
  readonly kind: WorkerJobKind;
  readonly payload: ReconciliationInput | Readonly<Record<string, string>>;
  readonly createdAt: string;
}

export function processJob(
  job: WorkerJob,
  logger: Logger,
): { readonly ok: boolean; readonly detail: string } {
  if (job.kind === "state.reconcile") {
    const input = job.payload as ReconciliationInput;
    
    // Validate required fields before processing
    if (!input || !Array.isArray(input.claims) || !Array.isArray(input.observations)) {
      logger.warn("state_reconcile_invalid_payload", {
        jobId: job.id,
        hasClaims: Array.isArray(input?.claims),
        hasObservations: Array.isArray(input?.observations),
      });
      return {
        ok: false,
        detail: "invalid payload: missing claims or observations array",
      };
    }

    const result = reconcileProjectState(input);
    logger.info("state_reconciled", {
      jobId: job.id,
      projectId: result.domainEvent.projectId,
      snapshotId: result.domainEvent.snapshotId,
      overall: result.domainEvent.overallEpistemicState,
      conflicts: result.domainEvent.conflictCount,
    });
    return {
      ok: true,
      detail: `snapshot=${result.snapshot.id}; overall=${result.snapshot.overallEpistemicState}`,
    };
  }

  // Deliberate no-op for every other declared kind, including the
  // GAP-APP-02 placeholders ("embeddings.generate"/"memory.extract") —
  // reserved for a possible future async entry point to the existing
  // packages/embeddings / MEMORY_EXTRACTION capabilities, not currently
  // wired. This is intentional, not a missing implementation.
  logger.info("job_acknowledged", { jobId: job.id, kind: job.kind });
  return { ok: true, detail: `acknowledged:${job.kind}` };
}

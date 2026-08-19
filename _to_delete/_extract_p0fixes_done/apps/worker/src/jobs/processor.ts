import { reconcileProjectState, type ReconciliationInput } from "@atlas/state";
import type { Logger } from "@atlas/observability";

export type WorkerJobKind =
  | "github.initial_sync"
  | "github.webhook_ingest"
  | "state.reconcile"
  | "embeddings.generate"
  | "memory.extract";

export interface WorkerJob {
  readonly id: string;
  readonly kind: WorkerJobKind;
  readonly payload: ReconciliationInput | Readonly<Record<string, string>>;
  readonly createdAt: string;
  /** Number of processing attempts already made for this job (0 = never attempted). */
  readonly retryCount: number;
  /** Epoch ms before which this job must not be (re)attempted; used for retry backoff. */
  readonly nextAttemptAt: number;
}

/**
 * Processes a single job. This function is synchronous and may THROW on a
 * bad/unexpected payload (e.g. `reconcileProjectState` rejecting malformed
 * `state.reconcile` input) — that is intentional and expected. Callers
 * (currently only the run loop in `../index.ts`) are responsible for
 * catching that throw and applying retry/dead-letter handling; this
 * function itself does not know about retries.
 */
export function processJob(
  job: WorkerJob,
  logger: Logger,
): { readonly ok: boolean; readonly detail: string } {
  if (job.kind === "state.reconcile") {
    const input = job.payload as ReconciliationInput;
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

  logger.info("job_acknowledged", { jobId: job.id, kind: job.kind });
  return { ok: true, detail: `acknowledged:${job.kind}` };
}

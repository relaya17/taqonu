import { AtlasError } from "@atlas/shared";
import { loadServerEnv } from "@atlas/config";
import { createLogger, type Logger } from "@atlas/observability";
import { processJob, type WorkerJob } from "./jobs/processor.js";
import {
  loadPendingJobs,
  persistJob,
  markJobRunning,
  markJobCompleted,
  markJobFailed,
  updateJobRetry,
  getQueueStats,
  cleanupOldJobs,
  type PersistedJob,
} from "./queue-persistence.js";

const MAX_JOB_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1_000;

/** In-memory queue backed by durable persistence. */
const queue: PersistedJob[] = [];

/**
 * Enqueue a job with durable persistence.
 * Jobs survive process crashes and are recovered on restart.
 */
export function enqueue(job: Omit<WorkerJob, "id" | "createdAt">): PersistedJob {
  const full: PersistedJob = {
    ...job,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    retryCount: 0,
    nextAttemptAt: 0,
    status: "PENDING",
  };
  queue.push(full);
  persistJob(full);
  return full;
}

function backoffMs(retryCount: number): number {
  return BASE_BACKOFF_MS * 2 ** (retryCount - 1);
}

export const queueLength = () => queue.length;

export { getQueueStats };

const runOnce = (logger: Logger): void => {
  const job = queue[0];
  if (!job) return;
  if (job.nextAttemptAt > Date.now()) return;
  queue.shift();

  markJobRunning(job.id);

  try {
    processJob(job, logger);
    markJobCompleted(job.id);
  } catch (error) {
    const nextRetry = job.retryCount + 1;
    const message = error instanceof Error ? error.message : String(error);
    if (nextRetry >= MAX_JOB_ATTEMPTS) {
      logger.error("job_permanently_failed", {
        jobId: job.id,
        kind: job.kind,
        attempts: nextRetry,
        error: message,
      });
      markJobFailed(job.id, message);
      return;
    }
    logger.warn("job_failed_will_retry", {
      jobId: job.id,
      kind: job.kind,
      attempts: nextRetry,
      error: message,
    });
    const nextAttemptAt = Date.now() + backoffMs(nextRetry);
    const retryJob: PersistedJob = {
      ...job,
      retryCount: nextRetry,
      nextAttemptAt,
      status: "PENDING",
      lastError: message,
    };
    queue.push(retryJob);
    updateJobRetry(job.id, nextRetry, nextAttemptAt, message);
  }
};

/**
 * Recover pending jobs from disk on startup.
 */
function recoverPendingJobs(logger: Logger): number {
  const pending = loadPendingJobs();
  for (const job of pending) {
    queue.push(job);
  }
  if (pending.length > 0) {
    logger.info("queue_recovery", {
      recoveredJobs: pending.length,
      note: "Recovered pending jobs from previous run",
    });
  }
  return pending.length;
}

async function main(): Promise<void> {
  const env = loadServerEnv();
  const logger = createLogger({
    service: "atlas-worker",
    level: env.LOG_LEVEL,
  });

  // Recover any pending jobs from previous run (crash recovery)
  const recovered = recoverPendingJobs(logger);

  logger.info("worker_started", {
    product: env.APP_NAME,
    codename: env.PRODUCT_CODENAME,
    recoveredJobs: recovered,
    note: "Processes state.reconcile jobs from GitHub sync evidence. Durable queue with crash recovery.",
  });

  // Periodic cleanup of old completed/failed jobs
  setInterval(() => {
    const removed = cleanupOldJobs(100);
    if (removed > 0) {
      logger.debug("queue_cleanup", { removedJobs: removed });
    }
  }, 60_000 * 10); // Every 10 minutes

  setInterval(() => {
    if (queue.length === 0) {
      logger.debug("worker_idle");
      return;
    }
    runOnce(logger);
  }, 2_000);
}

main().catch((error: unknown) => {
  const message =
    error instanceof AtlasError
      ? `${error.code}: ${error.message}`
      : error instanceof Error
        ? error.message
        : "unknown startup error";
  console.error(JSON.stringify({ level: "error", message, service: "atlas-worker" }));
  process.exit(1);
});

export { runOnce };

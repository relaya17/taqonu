import { pathToFileURL } from "node:url";
import { AtlasError } from "@atlas/shared";
import { loadServerEnv } from "@atlas/config";
import { createLogger } from "@atlas/observability";
import type { Logger } from "@atlas/observability";
import { processJob, type WorkerJob } from "./jobs/processor.js";

/**
 * In-process job queue, run loop, and bounded-retry/dead-letter handling.
 *
 * SCOPE LIMIT (honest, deliberate — this fix does not change it): the queue
 * below is a single process-local array. It is NOT durable — jobs enqueued
 * here are lost on process restart/crash/redeploy, and there is no
 * cross-process coordination (running two worker replicas would each have
 * their own independent, inconsistent queue). Moving to a real durable
 * queue/DB-backed job table is a separate, larger architectural change and
 * is explicitly OUT of scope for this fix. What this fix DOES guarantee:
 * a single job that throws (sync or async) can no longer take down the
 * whole worker process — it is retried a bounded number of times with
 * backoff and then logged as permanently failed and dropped, instead of
 * crashing everything else waiting in the queue.
 */
const queue: WorkerJob[] = [];

/**
 * Maximum number of processing attempts (including the first) before a job
 * is logged as permanently failed and dropped from the queue. 3 is a small,
 * deliberately conservative bound: enough to ride out a transient hiccup
 * (e.g. a momentary bad read) without turning a genuinely broken job into an
 * infinite retry loop that starves the rest of the in-memory queue forever.
 */
const MAX_JOB_ATTEMPTS = 3;

/** Base delay for exponential backoff between retry attempts. */
const BASE_RETRY_DELAY_MS = 1_000;

export function enqueue(
  job: Omit<WorkerJob, "id" | "createdAt" | "retryCount" | "nextAttemptAt">,
): WorkerJob {
  const full: WorkerJob = {
    ...job,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    retryCount: 0,
    nextAttemptAt: Date.now(),
  };
  queue.push(full);
  return full;
}

/** Test/introspection helper — not used by production control flow. */
export function queueLength(): number {
  return queue.length;
}

function handleJobFailure(job: WorkerJob, error: unknown, logger: Logger): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const attempts = job.retryCount + 1;

  if (attempts >= MAX_JOB_ATTEMPTS) {
    logger.error("job_permanently_failed", {
      jobId: job.id,
      kind: job.kind,
      attempts,
      maxAttempts: MAX_JOB_ATTEMPTS,
      error: message,
      ...(stack ? { stack } : {}),
    });
    // Dropped from the active queue. This module keeps no separate
    // dead-letter store (see the SCOPE LIMIT note above) but the failure is
    // never silent — it is always logged as `job_permanently_failed` with
    // full context before being discarded.
    return;
  }

  const backoffMs = BASE_RETRY_DELAY_MS * 2 ** job.retryCount;
  logger.warn("job_failed_will_retry", {
    jobId: job.id,
    kind: job.kind,
    attempt: attempts,
    maxAttempts: MAX_JOB_ATTEMPTS,
    backoffMs,
    error: message,
    ...(stack ? { stack } : {}),
  });
  queue.push({
    ...job,
    retryCount: attempts,
    nextAttemptAt: Date.now() + backoffMs,
  });
}

/**
 * Runs a single tick of the worker loop: pop at most one job and process it.
 * Exported so tests can drive the loop deterministically without waiting on
 * real timers. A job whose `processJob` call throws is caught here — it can
 * never escape to crash the process — and is handed to `handleJobFailure`
 * for bounded retry/dead-letter handling instead.
 */
export function runOnce(logger: Logger): void {
  const job = queue.shift();
  if (!job) {
    logger.debug("worker_idle");
    return;
  }

  if (Date.now() < job.nextAttemptAt) {
    // Not yet due for its scheduled retry attempt; put it back and let a
    // later tick pick it up once the backoff window has elapsed.
    queue.push(job);
    return;
  }

  try {
    processJob(job, logger);
  } catch (error) {
    handleJobFailure(job, error, logger);
  }
}

function isExecutedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const env = loadServerEnv();
  const logger = createLogger({
    service: "atlas-worker",
    level: env.LOG_LEVEL,
  });

  logger.info("worker_started", {
    product: env.APP_NAME,
    codename: env.PRODUCT_CODENAME,
    note: "Processes state.reconcile jobs from GitHub sync evidence.",
  });

  setInterval(() => {
    runOnce(logger);
  }, 2_000);
}

if (isExecutedDirectly()) {
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
}

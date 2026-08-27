import { AtlasError } from "@atlas/shared";
import { loadServerEnv } from "@atlas/config";
import { createLogger } from "@atlas/observability";
import { processJob, type WorkerJob } from "./jobs/processor.js";

const queue: WorkerJob[] = [];

export function enqueue(job: Omit<WorkerJob, "id" | "createdAt">): WorkerJob {
  const full: WorkerJob = {
    ...job,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  queue.push(full);
  return full;
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
    const job = queue.shift();
    if (!job) {
      logger.debug("worker_idle");
      return;
    }
    processJob(job, logger);
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

export { queueLength, runOnce };

const queueLength = () => queue.length;
const runOnce = async (logger: any, job: any = {}) => { await processJob(logger, job); };

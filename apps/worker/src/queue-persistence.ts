/**
 * Durable Job Queue Persistence.
 *
 * Provides crash recovery by persisting queued jobs to disk.
 * On startup, loads pending jobs from the persistence file.
 * On enqueue/complete/fail, updates the file atomically.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import type { WorkerJob } from "./jobs/processor.js";

export interface PersistedJob extends WorkerJob {
  readonly retryCount: number;
  readonly nextAttemptAt: number;
  readonly status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  readonly lastError?: string;
  readonly completedAt?: string;
}

interface QueueFile {
  version: 1;
  jobs: PersistedJob[];
  lastUpdated: string;
}

function defaultQueuePath(): string {
  const fromEnv = process.env.ATLAS_QUEUE_PATH;
  if (fromEnv) return fromEnv;
  const repoRoot = process.env.ATLAS_REPO_ROOT ?? process.cwd();
  return resolve(repoRoot, ".atlas", "worker-queue.json");
}

let queuePath = defaultQueuePath();

export function setQueuePathForTests(path: string): void {
  queuePath = path;
}

export function resetQueuePathForTests(): void {
  queuePath = defaultQueuePath();
}

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadQueueFile(): QueueFile {
  try {
    if (!existsSync(queuePath)) {
      return { version: 1, jobs: [], lastUpdated: new Date().toISOString() };
    }
    const raw = readFileSync(queuePath, "utf8");
    const parsed = JSON.parse(raw) as QueueFile;
    return {
      version: 1,
      jobs: parsed.jobs ?? [],
      lastUpdated: parsed.lastUpdated ?? new Date().toISOString(),
    };
  } catch {
    return { version: 1, jobs: [], lastUpdated: new Date().toISOString() };
  }
}

function saveQueueFile(data: QueueFile): void {
  ensureDir(queuePath);
  const tmpPath = `${queuePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
  try {
    try {
      renameSync(tmpPath, queuePath);
    } catch {
      // Windows cannot rename over an existing file — same fallback as store-io.
      copyFileSync(tmpPath, queuePath);
      unlinkSync(tmpPath);
    }
  } catch (error) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // ignore leftover temp cleanup
    }
    throw error;
  }
}

/**
 * Load all pending jobs from persistence (for crash recovery).
 */
export function loadPendingJobs(): PersistedJob[] {
  const file = loadQueueFile();
  // Reset any "RUNNING" jobs back to PENDING (they were interrupted)
  return file.jobs
    .filter(j => j.status === "PENDING" || j.status === "RUNNING")
    .map(j => j.status === "RUNNING" ? { ...j, status: "PENDING" as const } : j);
}

/**
 * Persist a new job to the queue file.
 */
export function persistJob(job: PersistedJob): void {
  const file = loadQueueFile();
  const existing = file.jobs.findIndex(j => j.id === job.id);
  if (existing >= 0) {
    file.jobs[existing] = job;
  } else {
    file.jobs.push(job);
  }
  file.lastUpdated = new Date().toISOString();
  saveQueueFile(file);
}

/**
 * Mark a job as running.
 */
export function markJobRunning(jobId: string): void {
  const file = loadQueueFile();
  const job = file.jobs.find(j => j.id === jobId);
  if (job) {
    (job as { status: string }).status = "RUNNING";
    file.lastUpdated = new Date().toISOString();
    saveQueueFile(file);
  }
}

/**
 * Mark a job as completed and remove from pending.
 */
export function markJobCompleted(jobId: string): void {
  const file = loadQueueFile();
  const job = file.jobs.find(j => j.id === jobId);
  if (job) {
    (job as { status: string; completedAt?: string }).status = "COMPLETED";
    (job as { completedAt?: string }).completedAt = new Date().toISOString();
    file.lastUpdated = new Date().toISOString();
    saveQueueFile(file);
  }
}

/**
 * Mark a job as permanently failed.
 */
export function markJobFailed(jobId: string, error: string): void {
  const file = loadQueueFile();
  const job = file.jobs.find(j => j.id === jobId);
  if (job) {
    (job as { status: string; lastError?: string; completedAt?: string }).status = "FAILED";
    (job as { lastError?: string }).lastError = error;
    (job as { completedAt?: string }).completedAt = new Date().toISOString();
    file.lastUpdated = new Date().toISOString();
    saveQueueFile(file);
  }
}

/**
 * Update job retry state.
 */
export function updateJobRetry(jobId: string, retryCount: number, nextAttemptAt: number, error: string): void {
  const file = loadQueueFile();
  const job = file.jobs.find(j => j.id === jobId);
  if (job) {
    (job as { status: string; retryCount: number; nextAttemptAt: number; lastError?: string }).status = "PENDING";
    (job as { retryCount: number }).retryCount = retryCount;
    (job as { nextAttemptAt: number }).nextAttemptAt = nextAttemptAt;
    (job as { lastError?: string }).lastError = error;
    file.lastUpdated = new Date().toISOString();
    saveQueueFile(file);
  }
}

/**
 * Get queue statistics.
 */
export function getQueueStats(): {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  total: number;
} {
  const file = loadQueueFile();
  return {
    pending: file.jobs.filter(j => j.status === "PENDING").length,
    running: file.jobs.filter(j => j.status === "RUNNING").length,
    completed: file.jobs.filter(j => j.status === "COMPLETED").length,
    failed: file.jobs.filter(j => j.status === "FAILED").length,
    total: file.jobs.length,
  };
}

/**
 * Clean up old completed/failed jobs (keep last N).
 */
export function cleanupOldJobs(keepCount = 100): number {
  const file = loadQueueFile();
  const active = file.jobs.filter(j => j.status === "PENDING" || j.status === "RUNNING");
  const terminal = file.jobs
    .filter(j => j.status === "COMPLETED" || j.status === "FAILED")
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  
  const kept = terminal.slice(0, keepCount);
  const removed = terminal.length - kept.length;
  
  file.jobs = [...active, ...kept];
  file.lastUpdated = new Date().toISOString();
  saveQueueFile(file);
  
  return removed;
}

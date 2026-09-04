import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import {
  cleanupOldJobs,
  getQueueStats,
  loadPendingJobs,
  markJobCompleted,
  markJobFailed,
  markJobRunning,
  persistJob,
  resetQueuePathForTests,
  setQueuePathForTests,
  updateJobRetry,
  type PersistedJob,
} from "./queue-persistence.js";

const testQueuePath = resolve(
  process.cwd(),
  ".atlas-test",
  "queue-persistence-test.json",
);

function job(overrides: Partial<PersistedJob> = {}): PersistedJob {
  return {
    id: "job-1",
    kind: "state.reconcile",
    payload: {},
    createdAt: "2026-09-04T00:00:00.000Z",
    retryCount: 0,
    nextAttemptAt: 0,
    status: "PENDING",
    ...overrides,
  };
}

function leftoverTmpFiles(): string[] {
  const dir = dirname(testQueuePath);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.startsWith("queue-persistence-test.json") && name.endsWith(".tmp"));
}

function cleanupTestQueue(): void {
  if (existsSync(testQueuePath)) unlinkSync(testQueuePath);
  for (const name of leftoverTmpFiles()) {
    unlinkSync(resolve(dirname(testQueuePath), name));
  }
}

function readQueueFile(): { version: number; jobs: PersistedJob[] } {
  return JSON.parse(readFileSync(testQueuePath, "utf8")) as {
    version: number;
    jobs: PersistedJob[];
  };
}

describe("queue-persistence", () => {
  beforeEach(() => {
    mkdirSync(dirname(testQueuePath), { recursive: true });
    cleanupTestQueue();
    setQueuePathForTests(testQueuePath);
  });

  afterEach(() => {
    resetQueuePathForTests();
    cleanupTestQueue();
  });

  it("returns no pending jobs when the queue file is missing", () => {
    expect(loadPendingJobs()).toEqual([]);
    expect(getQueueStats()).toEqual({
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      total: 0,
    });
  });

  it("persists a job atomically and reloads it as pending", () => {
    persistJob(job());

    expect(existsSync(testQueuePath)).toBe(true);
    expect(leftoverTmpFiles()).toEqual([]);

    const pending = loadPendingJobs();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe("job-1");
    expect(pending[0]?.status).toBe("PENDING");
    expect(readQueueFile().version).toBe(1);
  });

  it("upserts a job with the same id instead of duplicating it", () => {
    persistJob(job({ retryCount: 0 }));
    persistJob(job({ retryCount: 2, lastError: "transient" }));

    expect(readQueueFile().jobs).toHaveLength(1);
    expect(readQueueFile().jobs[0]?.retryCount).toBe(2);
    expect(readQueueFile().jobs[0]?.lastError).toBe("transient");
  });

  it("resets interrupted RUNNING jobs to PENDING on recovery", () => {
    persistJob(job({ id: "running", status: "RUNNING" }));
    persistJob(job({ id: "pending", status: "PENDING" }));

    const recovered = loadPendingJobs();
    expect(recovered.map((row) => row.id).sort()).toEqual(["pending", "running"]);
    expect(recovered.every((row) => row.status === "PENDING")).toBe(true);

    // On-disk RUNNING row is left as-is until the next persist; recovery maps it.
    expect(readQueueFile().jobs.find((row) => row.id === "running")?.status).toBe(
      "RUNNING",
    );
  });

  it("does not recover COMPLETED or FAILED jobs as pending", () => {
    persistJob(job({ id: "done", status: "COMPLETED" }));
    persistJob(job({ id: "dead", status: "FAILED", lastError: "boom" }));
    persistJob(job({ id: "live", status: "PENDING" }));

    const recovered = loadPendingJobs();
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.id).toBe("live");
  });

  it("marks running, completed, and failed statuses on disk", () => {
    persistJob(job());

    markJobRunning("job-1");
    expect(readQueueFile().jobs[0]?.status).toBe("RUNNING");
    expect(getQueueStats().running).toBe(1);

    markJobCompleted("job-1");
    const completed = readQueueFile().jobs[0];
    expect(completed?.status).toBe("COMPLETED");
    expect(completed?.completedAt).toBeTruthy();
    expect(loadPendingJobs()).toEqual([]);

    persistJob(job({ id: "job-2" }));
    markJobFailed("job-2", "permanent");
    const failed = readQueueFile().jobs.find((row) => row.id === "job-2");
    expect(failed?.status).toBe("FAILED");
    expect(failed?.lastError).toBe("permanent");
    expect(failed?.completedAt).toBeTruthy();
    expect(getQueueStats().failed).toBe(1);
  });

  it("ignores status updates for unknown job ids", () => {
    persistJob(job());
    markJobRunning("missing");
    markJobCompleted("missing");
    markJobFailed("missing", "nope");
    updateJobRetry("missing", 1, 99, "nope");

    expect(readQueueFile().jobs).toHaveLength(1);
    expect(readQueueFile().jobs[0]?.status).toBe("PENDING");
    expect(readQueueFile().jobs[0]?.retryCount).toBe(0);
  });

  it("writes retry backoff back to PENDING", () => {
    persistJob(job({ status: "RUNNING" }));
    updateJobRetry("job-1", 2, 1_700_000_000_000, "boom");

    const updated = readQueueFile().jobs[0];
    expect(updated?.status).toBe("PENDING");
    expect(updated?.retryCount).toBe(2);
    expect(updated?.nextAttemptAt).toBe(1_700_000_000_000);
    expect(updated?.lastError).toBe("boom");
  });

  it("cleanupOldJobs keeps active jobs and the newest terminal jobs", () => {
    persistJob(job({ id: "active", status: "PENDING" }));
    persistJob(
      job({
        id: "old-done",
        status: "COMPLETED",
        completedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    persistJob(
      job({
        id: "new-done",
        status: "COMPLETED",
        completedAt: "2026-06-01T00:00:00.000Z",
      }),
    );
    persistJob(
      job({
        id: "new-fail",
        status: "FAILED",
        completedAt: "2026-07-01T00:00:00.000Z",
      }),
    );

    const removed = cleanupOldJobs(2);
    expect(removed).toBe(1);

    const ids = readQueueFile().jobs.map((row) => row.id).sort();
    expect(ids).toEqual(["active", "new-done", "new-fail"]);
    expect(ids).not.toContain("old-done");
    expect(getQueueStats().pending).toBe(1);
  });

  it("treats a corrupt queue file as an empty queue", () => {
    writeFileSync(testQueuePath, "{not-json", "utf8");
    expect(loadPendingJobs()).toEqual([]);
    persistJob(job());
    expect(loadPendingJobs()).toHaveLength(1);
  });
});

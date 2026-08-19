import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "@atlas/observability";
import type { WorkerJob } from "./jobs/processor.js";

/**
 * `processJob` is mocked here so these tests exercise only the run loop's
 * retry/backoff/dead-letter behavior in ./index.ts -- not the real
 * reconciliation logic in @atlas/state (that's covered separately by
 * ./jobs/processor.test.ts).
 */
const processJobMock =
  vi.fn<(job: WorkerJob, logger: Logger) => { readonly ok: boolean; readonly detail: string }>();

vi.mock("./jobs/processor.js", () => ({
  processJob: (job: WorkerJob, logger: Logger) => processJobMock(job, logger),
}));

function createRecordingLogger(): {
  logger: Logger;
  calls: Record<"debug" | "info" | "warn" | "error", { message: string; fields?: unknown }[]>;
} {
  const calls: Record<"debug" | "info" | "warn" | "error", { message: string; fields?: unknown }[]> = {
    debug: [],
    info: [],
    warn: [],
    error: [],
  };
  const logger: Logger = {
    debug: (message, fields) => {
      calls.debug.push({ message, fields });
    },
    info: (message, fields) => {
      calls.info.push({ message, fields });
    },
    warn: (message, fields) => {
      calls.warn.push({ message, fields });
    },
    error: (message, fields) => {
      calls.error.push({ message, fields });
    },
    child: () => logger,
  };
  return { logger, calls };
}

describe("worker run loop (retry, backoff, dead-letter)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    processJobMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not crash the process when a job throws, and retries it", async () => {
    const { enqueue, runOnce, queueLength } = await import("./index.js");
    const { logger } = createRecordingLogger();
    processJobMock.mockImplementation(() => {
      throw new Error("boom");
    });

    enqueue({ kind: "state.reconcile", payload: {} });

    expect(() => runOnce(logger)).not.toThrow();
    expect(processJobMock).toHaveBeenCalledTimes(1);
    // Failed job is re-enqueued for a bounded retry, not dropped immediately.
    expect(queueLength()).toBe(1);
  });

  it("retries a permanently-failing job up to the max attempts, then logs it dead-letter and drops it", async () => {
    const { enqueue, runOnce, queueLength } = await import("./index.js");
    const { logger, calls } = createRecordingLogger();
    processJobMock.mockImplementation(() => {
      throw new Error("boom");
    });

    enqueue({ kind: "state.reconcile", payload: {} });

    // Attempt 1: fails, scheduled for retry with backoff.
    runOnce(logger);
    expect(processJobMock).toHaveBeenCalledTimes(1);
    expect(queueLength()).toBe(1);

    // Not due yet -- runOnce should not re-attempt before the backoff window.
    runOnce(logger);
    expect(processJobMock).toHaveBeenCalledTimes(1);

    // Attempt 2: fails again, backoff grows.
    vi.advanceTimersByTime(1_000);
    runOnce(logger);
    expect(processJobMock).toHaveBeenCalledTimes(2);
    expect(queueLength()).toBe(1);

    // Attempt 3: exhausts MAX_JOB_ATTEMPTS -- permanently failed and dropped.
    vi.advanceTimersByTime(2_000);
    runOnce(logger);
    expect(processJobMock).toHaveBeenCalledTimes(3);
    expect(queueLength()).toBe(0);

    expect(calls.warn).toHaveLength(2);
    expect(calls.warn.every((entry) => entry.message === "job_failed_will_retry")).toBe(true);
    expect(calls.error).toHaveLength(1);
    expect(calls.error[0]?.message).toBe("job_permanently_failed");
  });

  it("succeeds on retry for a job that throws once then would succeed, without crashing", async () => {
    const { enqueue, runOnce, queueLength } = await import("./index.js");
    const { logger, calls } = createRecordingLogger();
    let attempts = 0;
    processJobMock.mockImplementation(() => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("transient failure");
      }
      return { ok: true, detail: "ok" };
    });

    enqueue({ kind: "state.reconcile", payload: {} });

    expect(() => runOnce(logger)).not.toThrow();
    expect(queueLength()).toBe(1);

    vi.advanceTimersByTime(1_000);
    expect(() => runOnce(logger)).not.toThrow();
    expect(queueLength()).toBe(0);

    expect(processJobMock).toHaveBeenCalledTimes(2);
    expect(calls.error).toHaveLength(0);
  });

  it("keeps processing subsequent queued jobs after an earlier job throws", async () => {
    const { enqueue, runOnce, queueLength } = await import("./index.js");
    const { logger } = createRecordingLogger();
    processJobMock.mockImplementation((job: WorkerJob) => {
      if (job.kind === "state.reconcile") {
        throw new Error("boom");
      }
      return { ok: true, detail: `acknowledged:${job.kind}` };
    });

    enqueue({ kind: "state.reconcile", payload: {} });
    enqueue({ kind: "github.webhook_ingest", payload: {} });

    // First tick: pops the failing job, catches it, re-enqueues it.
    expect(() => runOnce(logger)).not.toThrow();
    expect(queueLength()).toBe(2);

    // Second tick: pops the still-healthy second job and processes it fine --
    // proof that one bad job does not block/crash the rest of the queue.
    expect(() => runOnce(logger)).not.toThrow();
    expect(queueLength()).toBe(1);
    expect(processJobMock).toHaveBeenCalledTimes(2);
  });

  it("enqueue keeps its existing input shape (kind + payload only) for callers", async () => {
    const { enqueue } = await import("./index.js");
    const job = enqueue({ kind: "embeddings.generate", payload: { foo: "bar" } });
    expect(job.kind).toBe("embeddings.generate");
    expect(job.payload).toEqual({ foo: "bar" });
    expect(typeof job.id).toBe("string");
    expect(typeof job.createdAt).toBe("string");
    expect(job.retryCount).toBe(0);
  });
});

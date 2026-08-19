import { describe, expect, it } from "vitest";
import type { Logger } from "@atlas/observability";
import { processJob, type WorkerJob } from "./processor.js";

function createSilentLogger(): Logger {
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };
  return logger;
}

function baseJob(overrides: Partial<WorkerJob>): WorkerJob {
  return {
    id: "job-1",
    kind: "memory.extract",
    payload: {},
    createdAt: new Date().toISOString(),
    retryCount: 0,
    nextAttemptAt: Date.now(),
    ...overrides,
  };
}

describe("processJob", () => {
  it("acknowledges non-reconcile job kinds without throwing", () => {
    const job = baseJob({ kind: "github.webhook_ingest", payload: { foo: "bar" } });
    const result = processJob(job, createSilentLogger());
    expect(result.ok).toBe(true);
    expect(result.detail).toBe("acknowledged:github.webhook_ingest");
  });

  it("throws synchronously on malformed state.reconcile payload", () => {
    // This is the realistic P0 failure mode: a bad/incomplete reconcile
    // payload makes reconcileProjectState throw. processJob does NOT catch
    // this itself -- that is the run loop's job (see ../index.ts).
    const job = baseJob({ kind: "state.reconcile", payload: {} });
    expect(() => processJob(job, createSilentLogger())).toThrow();
  });
});

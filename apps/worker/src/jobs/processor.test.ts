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

  it("rejects malformed state.reconcile payload without throwing", () => {
    const job = baseJob({ kind: "state.reconcile", payload: {} });
    const result = processJob(job, createSilentLogger());
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/invalid payload/i);
  });
});

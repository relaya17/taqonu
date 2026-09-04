import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerTool, resetToolRegistryForTests } from "@atlas/agent-core";
import { resolveAgentIdentity } from "./agent-runtime-authz.js";
import {
  executeGovernedAction,
  resetGovernedIdempotencyForTests,
} from "./governed-execution.js";
import { setAuditLogPathForTests } from "./audit-log.js";
import { resetApprovalsForTests } from "./approvals-test-store.js";
import { getMemoryStats, PERFORMANCE_LIMITS } from "./performance-limits.js";

const OWNER = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";

const getProject = vi.fn();
vi.mock("../store/os-store.js", () => ({
  osStore: {
    getProject: (...args: unknown[]) => getProject(...args),
  },
}));

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

describe("measured governed execution performance", () => {
  let dir: string;
  let projectRoot: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "atlas-perf-"));
    projectRoot = mkdtempSync(join(tmpdir(), "atlas-perf-root-"));
    setAuditLogPathForTests(join(dir, "audit.ndjson"));
    delete process.env.ATLAS_SKIP_AUDIT_LOG;
    resetToolRegistryForTests();
    resetApprovalsForTests();
    resetGovernedIdempotencyForTests();
    getProject.mockReturnValue({ id: PROJECT, ownerId: OWNER });
    registerTool({
      name: "knowledge_search",
      run: async () => "observation: ok",
    });
  });

  afterEach(() => {
    setAuditLogPathForTests(null);
    resetToolRegistryForTests();
    resetApprovalsForTests();
    rmSync(dir, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("measures sequential and concurrent executeGovernedAction latency", async () => {
    const identity = resolveAgentIdentity({
      fabricAgentId: "RESEARCHER",
      sessionOwnerId: OWNER,
      projectId: PROJECT,
    });
    const base = {
      identity,
      toolName: "knowledge_search",
      toolArgs: { query: "q" },
      artifact: "artifact",
      entityType: "DOCUMENT" as const,
      action: "READ" as const,
      sourceContext: { origin: "user_message" as const, trustLevel: "trusted" as const },
      projectRoot,
      routeLabel: "test.performance.measure",
    };

    const sequentialMs: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const started = performance.now();
      const result = await executeGovernedAction({
        ...base,
        requestId: `ffffffff-ffff-4fff-8fff-${i.toString().padStart(12, "0")}`,
        idempotencyKey: `seq-${i}`,
      });
      sequentialMs.push(performance.now() - started);
      expect(result.status).toBe("EXECUTED");
    }

    const concurrentStarted = performance.now();
    const concurrent = await Promise.all(
      Array.from({ length: 8 }, async (_, i) => {
        const started = performance.now();
        const result = await executeGovernedAction({
          ...base,
          requestId: `eeeeeeee-eeee-4eee-8eee-${i.toString().padStart(12, "0")}`,
          idempotencyKey: `conc-${i}`,
        });
        return { status: result.status, ms: performance.now() - started };
      }),
    );
    const concurrentWallMs = performance.now() - concurrentStarted;
    expect(concurrent.every((row) => row.status === "EXECUTED")).toBe(true);

    const memory = getMemoryStats();
    const seqP50 = percentile(sequentialMs, 50);
    const seqP95 = percentile(sequentialMs, 95);
    const concP95 = percentile(
      concurrent.map((row) => row.ms),
      95,
    );
    const measurement = {
      sequentialN: sequentialMs.length,
      sequentialP50Ms: Math.round(seqP50),
      sequentialP95Ms: Math.round(seqP95),
      concurrentN: concurrent.length,
      concurrentP95Ms: Math.round(concP95),
      concurrentWallMs: Math.round(concurrentWallMs),
      heapUsedMb: memory.heapUsedMb,
      rssMb: memory.rssMb,
      redisRequired: false,
    };

    expect(seqP95).toBeLessThan(5_000);
    expect(concP95).toBeLessThan(8_000);
    expect(concurrentWallMs).toBeLessThan(15_000);
    expect(PERFORMANCE_LIMITS.maxConcurrentDispatches).toBeGreaterThan(0);
    expect(memory.heapUsedMb).toBeGreaterThan(0);
    expect(measurement.redisRequired).toBe(false);
    expect(measurement.sequentialN).toBe(12);
    expect(measurement.concurrentN).toBe(8);
  });
});

import { describe, expect, it } from "vitest";
import { PERFORMANCE_LIMITS } from "./performance-limits.js";

describe("performance limits (existing in-process architecture)", () => {
  it("documents the process-local concurrency and timeout ceilings", () => {
    expect(PERFORMANCE_LIMITS.maxConcurrentDispatches).toBeGreaterThan(0);
    expect(PERFORMANCE_LIMITS.httpTimeoutMs).toBeGreaterThan(0);
    expect(PERFORMANCE_LIMITS.llmTimeoutMs).toBeGreaterThan(PERFORMANCE_LIMITS.httpTimeoutMs);
    expect(PERFORMANCE_LIMITS.maxBodyBytes).toBeGreaterThan(0);
    expect(PERFORMANCE_LIMITS.dbPoolSize).toBeGreaterThan(0);
  });
});

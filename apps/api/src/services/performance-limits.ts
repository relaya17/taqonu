/**
 * Stage 18 — Performance Limits and Timeouts.
 *
 * Centralized configuration for connection pools, query timeouts,
 * and resource limits. These are sensible defaults for Atlas; override
 * via environment variables for production tuning.
 */

export interface PerformanceLimits {
  /** Max concurrent database connections per pool */
  readonly dbPoolSize: number;
  /** Database query timeout in milliseconds */
  readonly dbQueryTimeoutMs: number;
  /** HTTP client timeout for external calls */
  readonly httpTimeoutMs: number;
  /** LLM API timeout (generous for long generations) */
  readonly llmTimeoutMs: number;
  /** Max request body size in bytes */
  readonly maxBodyBytes: number;
  /** Max concurrent agent dispatches */
  readonly maxConcurrentDispatches: number;
  /** Memory warning threshold (MB) */
  readonly memoryWarningMb: number;
  /** Max items per batch operation */
  readonly maxBatchSize: number;
}

function envInt(key: string, defaultValue: number): number {
  const val = process.env[key];
  if (!val) return defaultValue;
  const parsed = parseInt(val, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

export const PERFORMANCE_LIMITS: PerformanceLimits = Object.freeze({
  dbPoolSize: envInt("ATLAS_DB_POOL_SIZE", 10),
  dbQueryTimeoutMs: envInt("ATLAS_DB_QUERY_TIMEOUT_MS", 30_000),
  httpTimeoutMs: envInt("ATLAS_HTTP_TIMEOUT_MS", 15_000),
  llmTimeoutMs: envInt("ATLAS_LLM_TIMEOUT_MS", 120_000),
  maxBodyBytes: envInt("ATLAS_MAX_BODY_BYTES", 10 * 1024 * 1024), // 10MB
  maxConcurrentDispatches: envInt("ATLAS_MAX_CONCURRENT_DISPATCHES", 5),
  memoryWarningMb: envInt("ATLAS_MEMORY_WARNING_MB", 512),
  maxBatchSize: envInt("ATLAS_MAX_BATCH_SIZE", 100),
});

/** Check if memory usage is above warning threshold */
export function isMemoryPressureHigh(): boolean {
  const usage = process.memoryUsage();
  const heapMb = usage.heapUsed / (1024 * 1024);
  return heapMb > PERFORMANCE_LIMITS.memoryWarningMb;
}

/** Get current memory usage stats */
export function getMemoryStats() {
  const usage = process.memoryUsage();
  return {
    heapUsedMb: Math.round(usage.heapUsed / (1024 * 1024)),
    heapTotalMb: Math.round(usage.heapTotal / (1024 * 1024)),
    rssMb: Math.round(usage.rss / (1024 * 1024)),
    externalMb: Math.round(usage.external / (1024 * 1024)),
    warningThresholdMb: PERFORMANCE_LIMITS.memoryWarningMb,
    isPressureHigh: isMemoryPressureHigh(),
  };
}

/** Create an AbortSignal with timeout */
export function timeoutSignal(timeoutMs: number): AbortSignal {
  return AbortSignal.timeout(timeoutMs);
}

/** Wrap a promise with a timeout */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string,
): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`${operation} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]);
}

/**
 * R13 — measurement helpers only. Not a performance subsystem and not a budget.
 * Callers time existing Control operations; this file only records samples.
 */

export type ControlMeasurementClass =
  | "unit_test_local_process"
  | "local_runtime"
  | "database_runtime"
  | "production";

export interface TimingSummary {
  readonly path: string;
  readonly measurementClass: ControlMeasurementClass;
  readonly warmup: number;
  readonly n: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly samplesMs: readonly number[];
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) {
    throw new Error("percentile requires at least one sample");
  }
  if (!Number.isFinite(p) || p < 0 || p > 100) {
    throw new Error("percentile p must be in 0..100");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  const value = sorted[index];
  if (value === undefined) {
    throw new Error("percentile index out of range");
  }
  return value;
}

export function summarizeTimings(input: {
  readonly path: string;
  readonly measurementClass: ControlMeasurementClass;
  readonly warmup: number;
  readonly samplesMs: readonly number[];
}): TimingSummary {
  if (input.samplesMs.length === 0) {
    throw new Error("summarizeTimings requires at least one sample");
  }
  if (input.samplesMs.some((ms) => !Number.isFinite(ms) || ms < 0)) {
    throw new Error("summarizeTimings rejects non-finite or negative samples");
  }
  const sum = input.samplesMs.reduce((acc, ms) => acc + ms, 0);
  return {
    path: input.path,
    measurementClass: input.measurementClass,
    warmup: input.warmup,
    n: input.samplesMs.length,
    minMs: Math.min(...input.samplesMs),
    maxMs: Math.max(...input.samplesMs),
    meanMs: sum / input.samplesMs.length,
    p50Ms: percentile(input.samplesMs, 50),
    p95Ms: percentile(input.samplesMs, 95),
    samplesMs: input.samplesMs,
  };
}

export function timeSync(fn: () => void): number {
  const started = performance.now();
  fn();
  return performance.now() - started;
}

export async function timeAsync(fn: () => Promise<void>): Promise<number> {
  const started = performance.now();
  await fn();
  return performance.now() - started;
}

export async function collectAsyncSamples(input: {
  readonly warmup: number;
  readonly n: number;
  readonly run: () => Promise<void>;
}): Promise<number[]> {
  for (let i = 0; i < input.warmup; i += 1) {
    await input.run();
  }
  const samples: number[] = [];
  for (let i = 0; i < input.n; i += 1) {
    samples.push(await timeAsync(input.run));
  }
  return samples;
}

export function collectSyncSamples(input: {
  readonly warmup: number;
  readonly n: number;
  readonly run: () => void;
}): number[] {
  for (let i = 0; i < input.warmup; i += 1) {
    input.run();
  }
  const samples: number[] = [];
  for (let i = 0; i < input.n; i += 1) {
    samples.push(timeSync(input.run));
  }
  return samples;
}

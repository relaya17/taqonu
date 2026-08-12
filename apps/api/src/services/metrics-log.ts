import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { MetricSample } from "@atlas/observability";

let pathOverride: string | null = null;

/** Test helper — point metrics NDJSON at a temp path. */
export function setMetricsLogPathForTests(path: string | null): void {
  pathOverride = path;
}

/** Resolve `.atlas/metrics/metrics.ndjson` (or ATLAS_METRICS_LOG_PATH). */
export function resolveMetricsLogPath(): string {
  if (pathOverride) return pathOverride;
  const fromEnv = process.env.ATLAS_METRICS_LOG_PATH?.trim();
  if (fromEnv) return resolve(fromEnv);

  const storeEnv = process.env.ATLAS_STORE_PATH?.trim();
  if (storeEnv) {
    return join(dirname(resolve(storeEnv)), "metrics", "metrics.ndjson");
  }

  let dir = process.cwd();
  for (;;) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) {
      return resolve(dir, ".atlas", "metrics", "metrics.ndjson");
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return resolve(process.cwd(), ".atlas", "metrics", "metrics.ndjson");
    }
    dir = parent;
  }
}

/** Append one metric sample to durable NDJSON (never truncates). */
export function appendMetricsLogLine(sample: MetricSample): void {
  if (process.env.ATLAS_SKIP_METRICS_LOG === "1") return;
  const path = resolveMetricsLogPath();
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(sample)}\n`, "utf8");
}

/** Read the last N durable metric samples. */
export function readMetricsLogTail(limit = 200): MetricSample[] {
  const path = resolveMetricsLogPath();
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    const slice = lines.slice(-Math.max(1, limit));
    const out: MetricSample[] = [];
    for (const line of slice) {
      try {
        const parsed = JSON.parse(line) as MetricSample;
        if (parsed && typeof parsed.name === "string") out.push(parsed);
      } catch {
        // skip corrupt line
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function countMetricsLogLines(): number {
  const path = resolveMetricsLogPath();
  if (!existsSync(path)) return 0;
  try {
    const raw = readFileSync(path, "utf8");
    return raw.split("\n").filter((l) => l.trim().length > 0).length;
  } catch {
    return 0;
  }
}

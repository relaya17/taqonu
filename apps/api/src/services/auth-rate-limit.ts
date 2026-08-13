/** Simple per-key sliding window for auth endpoints (in-process). */
const buckets = new Map<string, number[]>();

export function assertAuthRateLimit(input: {
  key: string;
  limit: number;
  windowMs: number;
}): void {
  const now = Date.now();
  const prev = buckets.get(input.key) ?? [];
  const recent = prev.filter((t) => now - t < input.windowMs);
  if (recent.length >= input.limit) {
    const err = new Error("RATE_LIMITED");
    throw err;
  }
  recent.push(now);
  buckets.set(input.key, recent);
  if (buckets.size > 5_000) {
    // opportunistic cleanup
    for (const [k, times] of buckets) {
      const kept = times.filter((t) => now - t < input.windowMs);
      if (!kept.length) buckets.delete(k);
      else buckets.set(k, kept);
    }
  }
}

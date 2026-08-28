/**
 * Stage 18 — Response Cache for expensive read operations.
 *
 * Simple LRU cache with TTL for API responses. Does not cache mutations.
 * This is process-local; for distributed deployments, use Redis/Memcached.
 */

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  hitCount: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  maxSize: number;
}

export class ResponseCache<T = unknown> {
  private readonly cache = new Map<string, CacheEntry<T>>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(
    private readonly maxSize: number = 1000,
    private readonly defaultTtlMs: number = 60_000,
  ) {}

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }
    entry.hitCount++;
    this.hits++;
    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
      hitCount: 0,
    });
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  invalidate(key: string): boolean {
    return this.cache.delete(key);
  }

  invalidatePattern(pattern: RegExp): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  stats(): CacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      size: this.cache.size,
      maxSize: this.maxSize,
    };
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestExpiry = Infinity;
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt < oldestExpiry) {
        oldestExpiry = entry.expiresAt;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.evictions++;
    }
  }
}

/** Global read cache for expensive queries. */
export const readCache = new ResponseCache(500, 30_000);

/** Cache key builder for consistent namespacing. */
export function cacheKey(namespace: string, ...parts: (string | number)[]): string {
  return `${namespace}:${parts.join(":")}`;
}

/** Helper: get-or-compute with caching. */
export async function cached<T>(
  key: string,
  compute: () => Promise<T>,
  ttlMs?: number,
): Promise<T> {
  const existing = readCache.get(key) as T | undefined;
  if (existing !== undefined) return existing;
  const value = await compute();
  readCache.set(key, value, ttlMs);
  return value;
}

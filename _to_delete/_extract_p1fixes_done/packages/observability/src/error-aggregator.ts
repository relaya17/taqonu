/**
 * Structured error aggregation for the API process.
 *
 * Errors are deduplicated by a (code, normalized-message) key rather than
 * by full message or stack trace: two occurrences of the same logical
 * failure ("NOT_FOUND: project abc123 not found" vs. "NOT_FOUND: project
 * def456 not found") should collapse into one aggregate entry, not
 * fragment into one bucket per distinct id/timestamp/uuid embedded in the
 * message. Stack traces are deliberately excluded from the dedup key (and
 * from what we retain) — they vary line-to-line across otherwise-identical
 * failures and would defeat aggregation entirely, and retaining them
 * per-occurrence would grow unbounded.
 */

export interface ErrorOccurrenceSample {
  readonly at: string;
  readonly message: string;
  readonly requestId?: string;
  readonly context?: Readonly<Record<string, unknown>>;
}

export interface ErrorAggregateEntry {
  readonly key: string;
  readonly code: string;
  readonly count: number;
  readonly firstSeen: string;
  readonly lastSeen: string;
  /** Capped, most-recent-last sample of occurrences (see ERROR_AGGREGATOR_SAMPLE_CAP). */
  readonly samples: readonly ErrorOccurrenceSample[];
}

export interface ErrorAggregateSummary {
  readonly totalUniqueErrors: number;
  readonly totalOccurrences: number;
  readonly entries: readonly ErrorAggregateEntry[];
}

/** Max recent-occurrence samples retained per dedup key. */
export const ERROR_AGGREGATOR_SAMPLE_CAP = 20;

/**
 * Normalize a message for dedup-key purposes by stripping the
 * high-cardinality bits (uuids, numeric ids, bare numbers) that would
 * otherwise make every occurrence of the "same" error look distinct.
 */
export function normalizeErrorMessage(message: string): string {
  return message
    .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, "<uuid>")
    // Collapse any token containing at least one digit (bare numbers like
    // "4821" as well as alphanumeric ids like "abc123") into a placeholder,
    // so messages that differ only by an embedded id/timestamp still dedup.
    .replace(/\b\w*\d\w*\b/g, "<id>")
    .trim()
    .slice(0, 200);
}

export function buildErrorKey(code: string, message: string): string {
  return `${code}::${normalizeErrorMessage(message)}`;
}

interface MutableEntry {
  code: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  samples: ErrorOccurrenceSample[];
}

function toEntry(key: string, entry: MutableEntry): ErrorAggregateEntry {
  return {
    key,
    code: entry.code,
    count: entry.count,
    firstSeen: entry.firstSeen,
    lastSeen: entry.lastSeen,
    samples: [...entry.samples],
  };
}

export class ErrorAggregator {
  private readonly entries = new Map<string, MutableEntry>();
  private readonly sampleCap: number;

  constructor(sampleCap: number = ERROR_AGGREGATOR_SAMPLE_CAP) {
    this.sampleCap = Math.max(1, sampleCap);
  }

  record(
    code: string,
    message: string,
    extra?: { readonly requestId?: string; readonly context?: Readonly<Record<string, unknown>> },
  ): ErrorAggregateEntry {
    const key = buildErrorKey(code, message);
    const now = new Date().toISOString();
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { code, count: 0, firstSeen: now, lastSeen: now, samples: [] };
      this.entries.set(key, entry);
    }
    entry.count += 1;
    entry.lastSeen = now;
    entry.samples.push({
      at: now,
      message,
      ...(extra?.requestId !== undefined ? { requestId: extra.requestId } : {}),
      ...(extra?.context !== undefined ? { context: extra.context } : {}),
    });
    if (entry.samples.length > this.sampleCap) {
      entry.samples.splice(0, entry.samples.length - this.sampleCap);
    }
    return toEntry(key, entry);
  }

  get(key: string): ErrorAggregateEntry | undefined {
    const entry = this.entries.get(key);
    return entry ? toEntry(key, entry) : undefined;
  }

  /** All aggregate entries, sorted by occurrence count descending (most frequent first). */
  list(): readonly ErrorAggregateEntry[] {
    return [...this.entries.entries()]
      .map(([key, entry]) => toEntry(key, entry))
      .sort((a, b) => b.count - a.count);
  }

  summary(): ErrorAggregateSummary {
    const entries = this.list();
    return {
      totalUniqueErrors: entries.length,
      totalOccurrences: entries.reduce((sum, e) => sum + e.count, 0),
      entries,
    };
  }

  reset(): void {
    this.entries.clear();
  }
}

/** Process-wide default aggregator, shared by the error-handler middleware. */
export const defaultErrorAggregator = new ErrorAggregator();

/** Read the current aggregate state of the process-wide default aggregator. */
export function getErrorAggregateSummary(): ErrorAggregateSummary {
  return defaultErrorAggregator.summary();
}

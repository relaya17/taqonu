import type { DomainEvent, EpistemicState, Memory } from "@atlas/shared";

const VERIFIED_FAILURE_STATES = new Set<EpistemicState>([
  "OBSERVED",
  "VERIFIED",
  "CONFLICTED",
]);

export type RecurrenceEvidenceRef = {
  readonly kind: "domain-event" | "memory";
  readonly id: string;
};

export type RecurrenceRecommendation = {
  readonly signature: string;
  readonly occurrences: number;
  readonly epistemicState: "INFERRED";
  readonly recommendation: string;
  readonly eventIds: readonly string[];
  readonly memories: readonly {
    readonly id: string;
    readonly epistemicState: string;
    readonly statement: string;
  }[];
  readonly evidenceRefs: readonly RecurrenceEvidenceRef[];
};

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function failedCheckId(payload: Record<string, unknown>): string | null {
  const checks = payload.checks;
  if (!Array.isArray(checks)) return null;
  for (const check of checks) {
    if (typeof check === "string" && check.endsWith(":fail")) {
      const id = check.slice(0, -":fail".length).trim();
      if (id) return id;
    }
    if (check && typeof check === "object" && "passed" in check) {
      const row = check as { passed?: unknown; id?: unknown };
      if (row.passed === false) {
        const id = text(row.id);
        if (id) return id;
      }
    }
  }
  return null;
}

function failureSignature(payload: Record<string, unknown>): string | null {
  const issue = text(payload.sourceIssueId) ?? text(payload.findingId);
  if (issue) return `finding:${issue}`;
  const check = failedCheckId(payload);
  if (check) return `check:${check}`;
  const patchId = text(payload.patchId);
  if (
    patchId &&
    (payload.ok === false || payload.patchVerifyStatus === "FAIL")
  ) {
    return `patch:${patchId}`;
  }
  return null;
}

function isVerifiedFailure(event: DomainEvent): boolean {
  if (event.type !== "evaluation.completed") return false;
  if (!VERIFIED_FAILURE_STATES.has(event.epistemicState)) return false;
  const payload = event.payload;
  return (
    payload.ok === false ||
    payload.patchVerifyStatus === "FAIL" ||
    payload.remediationResult === "NOT_FIXED"
  );
}

function memoryMentions(memory: Memory, signature: string): boolean {
  const key = signature.slice(signature.indexOf(":") + 1);
  if (key.length < 4) return false;
  if (memory.sourceId === key) return true;
  if (memory.reason.some((reason) => reason.includes(key))) return true;
  if (
    memory.evidence.some(
      (item) =>
        item.reference.includes(key) || (item.excerpt?.includes(key) ?? false),
    )
  ) {
    return true;
  }
  return memory.statement.includes(key);
}

/**
 * Verified failure events → same signature twice → stored memory cited as-is
 * → an INFERRED recommendation with evidence ids.
 * This does not retrieve by similarity and does not rewrite epistemic state.
 */
export function detectRecurringFailures(input: {
  readonly ownerId: string;
  readonly projectId?: string | null;
  readonly events: readonly DomainEvent[];
  readonly memories: readonly Memory[];
}): RecurrenceRecommendation[] {
  const projectId = input.projectId ?? null;
  const grouped = new Map<string, DomainEvent[]>();
  const ordered = [...input.events].sort((a, b) =>
    a.occurredAt.localeCompare(b.occurredAt),
  );
  for (const event of ordered) {
    if (event.ownerId !== input.ownerId) continue;
    if (projectId && event.projectId !== projectId) continue;
    if (!isVerifiedFailure(event)) continue;
    const signature = failureSignature(event.payload);
    if (!signature) continue;
    const bucket = grouped.get(signature) ?? [];
    bucket.push(event);
    grouped.set(signature, bucket);
  }

  const recommendations: RecurrenceRecommendation[] = [];
  for (const [signature, events] of grouped) {
    if (events.length < 2) continue;
    const key = signature.slice(signature.indexOf(":") + 1);
    const memories = input.memories.filter(
      (memory) =>
        memory.ownerId === input.ownerId &&
        (projectId === null ||
          memory.projectId === null ||
          memory.projectId === projectId) &&
        memoryMentions(memory, signature),
    );
    const eventIds = events.map((event) => event.id);
    const evidenceRefs: RecurrenceEvidenceRef[] = [
      ...eventIds.map((id) => ({ kind: "domain-event" as const, id })),
      ...memories.map((memory) => ({ kind: "memory" as const, id: memory.id })),
    ];
    recommendations.push({
      signature,
      occurrences: events.length,
      epistemicState: "INFERRED",
      recommendation:
        memories.length > 0
          ? `Verified failure ${key} recurred ${events.length} times. ${memories.length} stored memory record(s) mention it. This recommendation is INFERRED.`
          : `Verified failure ${key} recurred ${events.length} times. No stored memory mentions it. This recommendation is INFERRED.`,
      eventIds,
      memories: memories.map((memory) => ({
        id: memory.id,
        epistemicState: memory.epistemicState,
        statement: memory.statement,
      })),
      evidenceRefs,
    });
  }
  return recommendations;
}

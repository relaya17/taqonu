import {
  STUB_OWNER_ID,
  domainEventSchema,
  type DomainEvent,
  type DomainEventType,
  type EpistemicState,
  type Memory,
  type MemoryType,
} from "@atlas/shared";
import { osStore } from "../store/os-store.js";

/**
 * Event → Observation → Claim → Decision → Evidence → Evaluation → Resolution
 * MVP: typed append + classify + approve + retrieve budget (ADR-004 / ADR-014 §6).
 */
export function appendDomainEvent(input: {
  type: DomainEventType;
  projectId?: string | null;
  epistemicState?: EpistemicState;
  payload: Record<string, unknown>;
  correlationId?: string;
  causationId?: string | null;
}): DomainEvent {
  const now = new Date().toISOString();
  const event = domainEventSchema.parse({
    id: crypto.randomUUID(),
    type: input.type,
    occurredAt: now,
    ownerId: STUB_OWNER_ID,
    projectId: input.projectId ?? null,
    correlationId: input.correlationId ?? crypto.randomUUID(),
    causationId: input.causationId ?? null,
    epistemicState: input.epistemicState ?? "OBSERVED",
    payload: input.payload,
  });
  osStore.appendDomainEvent(event);
  return event;
}

/** Heuristic classifier — does not invent FACT from thin prompts. */
export function classifyMemoryType(statement: string): {
  type: MemoryType;
  confidence: number;
  reason: string;
} {
  const s = statement.toLowerCase();
  if (/decid|החלט|قرر|adr\b|we will use|נשתמש/.test(s)) {
    return { type: "DECISION", confidence: 0.75, reason: "decision language" };
  }
  if (/prefer|העדפ|يفضل|always use|never use/.test(s)) {
    return { type: "PREFERENCE", confidence: 0.7, reason: "preference language" };
  }
  if (/bug|defect|regression|תקלה|באג|خلل/.test(s)) {
    return { type: "BUG", confidence: 0.72, reason: "defect language" };
  }
  if (/architect|boundary|שכבה|طبقة|monolith|microservice/.test(s)) {
    return {
      type: "ARCHITECTURE",
      confidence: 0.7,
      reason: "architecture language",
    };
  }
  if (/lesson|learned|למדנו|تعلّم|next time/.test(s)) {
    return { type: "LESSON", confidence: 0.68, reason: "lesson language" };
  }
  if (/todo|task|צריך|يجب|should implement/.test(s)) {
    return { type: "TASK", confidence: 0.65, reason: "task language" };
  }
  if (/happened|occurred|deployed|קרה|وقع/.test(s)) {
    return { type: "EVENT", confidence: 0.65, reason: "event language" };
  }
  return {
    type: "PROJECT_STATE",
    confidence: 0.55,
    reason: "default project-state bucket",
  };
}

/** Mark older ACTIVE memories STALE when a newer verified-ish statement arrives. */
export function supersedeMatchingMemories(input: {
  projectId: string | null;
  statementContains: string;
  newerMemoryId: string;
}): number {
  const key = input.projectId ?? "global";
  const memories = osStore.getMemories(key);
  const needle = input.statementContains.trim().toLowerCase();
  if (needle.length < 4) return 0;
  let count = 0;
  const next = memories.map((m) => {
    if (
      m.id === input.newerMemoryId ||
      m.status !== "ACTIVE" ||
      !m.statement.toLowerCase().includes(needle)
    ) {
      return m;
    }
    count += 1;
    return {
      ...m,
      status: "SUPERSEDED" as const,
      supersededBy: input.newerMemoryId,
      epistemicState:
        m.epistemicState === "FACT" || m.epistemicState === "VERIFIED"
          ? ("STALE" as const)
          : m.epistemicState,
      updatedAt: new Date().toISOString(),
    };
  });
  if (count > 0) {
    osStore.replaceMemories(key, next);
    appendDomainEvent({
      type: "memory.superseded",
      projectId: input.projectId,
      epistemicState: "STALE",
      payload: {
        newerMemoryId: input.newerMemoryId,
        supersededCount: count,
        needle,
      },
    });
  }
  return count;
}

/** Human/system approval: PROPOSED/INFERRED → CONFIRMED (never silent FACT). */
export function approveMemory(input: {
  memoryId: string;
  projectId?: string | null;
}): Memory | null {
  const key = input.projectId ?? null;
  const allKeys =
    key !== null
      ? [key, "global"]
      : [...osStore.memories.keys()];
  for (const k of allKeys) {
    const list = [...osStore.getMemories(k)];
    const idx = list.findIndex((m) => m.id === input.memoryId);
    if (idx < 0) continue;
    const current = list[idx]!;
    const nextEpistemic: EpistemicState =
      current.epistemicState === "PROPOSED" ||
      current.epistemicState === "INFERRED" ||
      current.epistemicState === "UNVERIFIED" ||
      current.epistemicState === "ASSUMED"
        ? "CONFIRMED"
        : current.epistemicState === "OBSERVED"
          ? "CONFIRMED"
          : current.epistemicState;
    const updated: Memory = {
      ...current,
      epistemicState: nextEpistemic,
      observationMode:
        nextEpistemic === "CONFIRMED" ? "CONFIRMED" : current.observationMode,
      confidence: Math.min(0.95, current.confidence + 0.1),
      updatedAt: new Date().toISOString(),
      reason: [
        ...current.reason,
        "pipeline:approved",
      ].slice(-12),
    };
    list[idx] = updated;
    osStore.replaceMemories(k, list);
    appendDomainEvent({
      type: "memory.created",
      projectId: updated.projectId,
      epistemicState: updated.epistemicState,
      payload: { memoryId: updated.id, action: "approve" },
    });
    return updated;
  }
  return null;
}

/** Retrieve ACTIVE memories with a hard budget (token/cost control). */
export function retrieveMemories(input: {
  projectId?: string | null;
  query?: string;
  budget?: number;
}): { items: Memory[]; budget: number; truncated: boolean } {
  const budget = Math.max(1, Math.min(input.budget ?? 12, 40));
  const key = input.projectId ?? null;
  const pools: Memory[] = [];
  if (key) {
    pools.push(...osStore.getMemories(key));
  }
  pools.push(...osStore.getMemories("global"));
  for (const [k, list] of osStore.memories.entries()) {
    if (k === key || k === "global") continue;
    if (!input.projectId) pools.push(...list);
  }
  const q = (input.query ?? "").trim().toLowerCase();
  const active = pools.filter((m) => m.status === "ACTIVE");
  const ranked = active
    .map((m) => {
      let score = m.confidence;
      if (m.epistemicState === "FACT" || m.epistemicState === "VERIFIED") {
        score += 0.2;
      } else if (m.epistemicState === "CONFIRMED" || m.epistemicState === "OBSERVED") {
        score += 0.12;
      } else if (m.epistemicState === "PROPOSED") {
        score -= 0.15;
      }
      if (q && m.statement.toLowerCase().includes(q)) score += 0.25;
      if (m.priority === "CRITICAL") score += 0.15;
      if (m.priority === "HIGH") score += 0.08;
      return { m, score };
    })
    .sort((a, b) => b.score - a.score);
  const items = ranked.slice(0, budget).map((r) => r.m);
  return {
    items,
    budget,
    truncated: ranked.length > budget,
  };
}

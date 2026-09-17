import {
  SYSTEM_OWNER_ID,
  domainEventSchema,
  memoryEpistemicAfterAction,
  memorySchema,
  type DomainEvent,
  type DomainEventType,
  type EpistemicState,
  type Memory,
  type MemoryType,
  type QaPortfolioPattern,
} from "@atlas/shared";
import { domainEventBus, redactSecrets } from "@atlas/agent-core";
import {
  cosineSimilarity,
  resolveEmbeddingProvider,
  safeEmbed,
  type EmbeddingEnv,
  type EmbeddingKind,
  type EmbeddingProvider,
} from "@atlas/embeddings";
import { osStore } from "../store/os-store.js";

/** Evidence-tagged memory slice for agent payloads — never silent FACT merge. */
export type MemoryContextItem = {
  id: string;
  type: Memory["type"];
  statement: string;
  epistemicState: EpistemicState;
  confidence: number;
  category: Memory["category"];
  source: string;
  evidence: Memory["evidence"];
  scope: Memory["scope"];
  projectId: string | null;
  priority: Memory["priority"];
};

export type MemoryContextPayload = {
  items: MemoryContextItem[];
  budget: number;
  truncated: boolean;
  /** Retrieval envelope: OBSERVED from store; item tags stay as-is. */
  epistemicState: "OBSERVED" | "INFERRED";
  note: string;
};

const MEMORY_CONTEXT_NOTE =
  "Memories are evidence-tagged by epistemicState — do not silently merge as FACT.";

/** Cosine weight when a semantic (non-hash) embedding provider is configured. */
const SEMANTIC_COSINE_WEIGHT = 0.45;
/** Weak token-overlap signal from the lexical-hash fallback — never called semantic. */
const LEXICAL_HASH_COSINE_WEIGHT = 0.08;

export type MemoryRetrievalEmbeddingKind = EmbeddingKind | "none";

export type MemoryRetrieveInput = {
  projectId?: string | null;
  query?: string;
  budget?: number;
  /** P0 tenant-isolation fix: scope retrieval to this caller (admins omit). */
  ownerId?: string;
  /**
   * Per-agent scoping (P1 fix): the single agent (kernel catalog id /
   * plugin id) asking for memory. When a memory has a non-empty
   * `allowedAgents` list, it is only returned when this matches one of
   * those ids. Optional and backward-compatible: omitting it (and
   * `requestingAgentIds` below) is a strict no-op for this filter --
   * `allowedAgents`-restricted memories stay visible exactly as before
   * this field existed (see `isVisibleToAgent()` for the exact rule).
   */
  requestingAgentId?: string;
  /**
   * When the caller is a multi-agent surface (plan/dispatch) rather than a
   * single specialist, pass the participating agent ids here. A memory is
   * visible if ANY candidate is in its `allowedAgents` list — the
   * OR-generalization of `requestingAgentId` (a list of one id is
   * equivalent to passing that id via `requestingAgentId`).
   */
  requestingAgentIds?: readonly string[];
  /** Injected provider (tests / explicit wiring). Wins over `embeddingEnv`. */
  embeddingProvider?: EmbeddingProvider;
  /** Used to resolve HTTP vs hash fallback when `embeddingProvider` is omitted. */
  embeddingEnv?: EmbeddingEnv;
};

export function toMemoryContextItem(memory: Memory): MemoryContextItem {
  return {
    id: memory.id,
    type: memory.type,
    statement: memory.statement,
    epistemicState: memory.epistemicState,
    confidence: memory.confidence,
    category: memory.category,
    source: memory.source,
    evidence: memory.evidence,
    scope: memory.scope,
    projectId: memory.projectId,
    priority: memory.priority,
  };
}

/** Budgeted retrieve + evidence-tagged context for agent plan/dispatch/runs. */
export async function buildMemoryContext(
  input: MemoryRetrieveInput,
): Promise<MemoryContextPayload & { memories: Memory[] }> {
  const retrieved = await retrieveMemories(input);
  const hasInferred = retrieved.items.some(
    (m) =>
      m.epistemicState === "INFERRED" ||
      m.epistemicState === "PROPOSED" ||
      m.epistemicState === "ASSUMED" ||
      m.epistemicState === "UNVERIFIED",
  );
  return {
    items: retrieved.items.map(toMemoryContextItem),
    budget: retrieved.budget,
    truncated: retrieved.truncated,
    epistemicState: hasInferred ? "INFERRED" : "OBSERVED",
    note: MEMORY_CONTEXT_NOTE,
    memories: retrieved.items,
  };
}

/**
 * Seed INFERRED portfolio-scope memories from QA patterns seen in ≥2 projects.
 * Idempotent per patternKey (ACTIVE global memories). WRITE approval gates untouched.
 */
export function seedPortfolioPatternMemories(
  patterns: readonly Pick<
    QaPortfolioPattern,
    | "id"
    | "patternKey"
    | "title"
    | "summary"
    | "projectIds"
    | "findingIds"
    | "epistemicState"
  >[],
): Memory[] {
  const eligible = patterns.filter((p) => p.projectIds.length >= 2);
  if (eligible.length === 0) return [];

  const existing = osStore.getMemories("global");
  const seenKeys = new Set(
    existing
      .filter((m) => m.status === "ACTIVE")
      .flatMap((m) =>
        m.reason
          .filter((r) => r.startsWith("patternKey:"))
          .map((r) => r.slice("patternKey:".length)),
      ),
  );
  const seeded: Memory[] = [];
  const now = new Date().toISOString();

  for (const pattern of eligible) {
    const marker = `patternKey:${pattern.patternKey}`;
    const already =
      seenKeys.has(pattern.patternKey) ||
      existing.some(
        (m) =>
          m.status === "ACTIVE" &&
          (m.sourceId === pattern.id ||
            m.statement.includes(`[${pattern.patternKey}]`)),
      );
    if (already) continue;

    // Secret-redaction gate (matches routes/memory.ts's POST handler): a QA
    // pattern's title/summary is synthesized from finding text that may
    // itself embed a credential/token accidentally captured by a scanner —
    // never persist that raw into a memory statement or evidence excerpt.
    const safeTitle = redactSecrets(pattern.title);
    const safeSummary = redactSecrets(pattern.summary);

    const memory = memorySchema.parse({
      id: crypto.randomUUID(),
      // System-seeded, portfolio-wide insight — not tied to any single
      // request's caller. SYSTEM_OWNER_ID is the explicit platform actor,
      // never the legacy personal-instance stub.
      ownerId: SYSTEM_OWNER_ID,
      type: "LESSON",
      projectId: null,
      statement: `[${pattern.patternKey}] ${safeTitle}: ${safeSummary}`,
      reason: [
        "qa:portfolio-pattern",
        marker,
        `projects:${pattern.projectIds.length}`,
        `patternId:${pattern.id}`,
      ],
      status: "ACTIVE",
      confidence: 0.6,
      category: "GENERATED_REASONING",
      epistemicState: "INFERRED",
      observationMode: "INFERRED",
      source: "qa-portfolio-pattern",
      sourceType: "SYSTEM",
      sourceId: pattern.id,
      evidence: (pattern.findingIds ?? []).slice(0, 8).map((findingId) => ({
        id: crypto.randomUUID(),
        kind: "qa_finding",
        reference: findingId,
        excerpt: safeSummary.slice(0, 400),
      })),
      supersededBy: null,
      validFrom: now,
      validUntil: null,
      observedAt: now,
      createdAt: now,
      updatedAt: now,
      createdBy: "qa-portfolio",
      scope: "GLOBAL",
      priority: "HIGH",
    });
    osStore.addMemory(memory);
    appendDomainEvent({
      type: "memory.created",
      projectId: null,
      ownerId: SYSTEM_OWNER_ID,
      epistemicState: "INFERRED",
      payload: {
        memoryId: memory.id,
        kind: "qa.portfolio_pattern",
        patternKey: pattern.patternKey,
        projectIds: pattern.projectIds,
        note: MEMORY_CONTEXT_NOTE,
      },
    });
    seeded.push(memory);
    seenKeys.add(pattern.patternKey);
  }
  return seeded;
}

/**
 * Event → Observation → Claim → Decision → Evidence → Evaluation → Resolution
 * MVP: typed append + classify + approve + retrieve budget (ADR-004 / ADR-014 §6).
 */
export function appendDomainEvent(input: {
  type: DomainEventType;
  projectId?: string | null;
  /** Tenant or SYSTEM actor. Defaults to SYSTEM_OWNER_ID — never STUB_OWNER_ID. */
  ownerId?: string;
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
    ownerId: input.ownerId ?? SYSTEM_OWNER_ID,
    projectId: input.projectId ?? null,
    correlationId: input.correlationId ?? crypto.randomUUID(),
    causationId: input.causationId ?? null,
    epistemicState:
      input.type === "agent.run.completed"
        ? memoryEpistemicAfterAction()
        : (input.epistemicState ?? "OBSERVED"),
    payload: input.payload,
  });
  osStore.appendDomainEvent(event);
  // Fire-and-forget dispatch to the in-process event bus — subscribers react
  // to the event only *after* it is durably recorded above. A publish that
  // has no subscribers, or a subscriber that throws, must never affect the
  // caller of appendDomainEvent(); failures are only logged.
  if (process.env.ATLAS_SKIP_EVENT_DISPATCH !== "1") {
    void domainEventBus.publish(event).catch((error: unknown) => {
      console.error(
        JSON.stringify({
          level: "error",
          message: "domain_event_dispatch_failed",
          type: event.type,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    });
  }
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
  if (/risk|threat|cve|vulnerability|סיכון|مخاطر/.test(s)) {
    return { type: "PROJECT_STATE", confidence: 0.7, reason: "risk language" };
  }
  if (/insufficient.?evidence|אין ראיה|لا دليل/.test(s)) {
    return {
      type: "LESSON",
      confidence: 0.8,
      reason: "insufficient-evidence discipline",
    };
  }
  return {
    type: "PROJECT_STATE",
    confidence: 0.55,
    reason: "default project-state bucket",
  };
}

/**
 * Mark older ACTIVE memories STALE when a newer verified-ish statement arrives.
 *
 * SECURITY (P0): Only supersedes memories owned by `ownerId`. A tenant cannot
 * supersede another tenant's memories by posting a matching statement.
 */
export function supersedeMatchingMemories(input: {
  ownerId: string;
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
      m.ownerId !== input.ownerId ||
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
      ownerId: input.ownerId,
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

/**
 * Why `approveMemory()` can fail — lets the route explain the *reason*
 * instead of collapsing every rejection into an ambiguous 404:
 *  - "not_found": the memory doesn't exist, or exists under a different
 *    owner. These two cases are deliberately indistinguishable from each
 *    other (no cross-tenant enumeration — see the ownerId doc below), but
 *    ARE distinguishable from the evidence gate below, which is not a
 *    tenancy/existence signal and is safe to explain.
 *  - "no_evidence": the memory exists and is owned by the caller, but has
 *    zero `evidence` entries, so promoting it to CONFIRMED would assert
 *    verification that never happened (evidence-required gate, see below).
 */
export type ApproveMemoryFailureReason = "not_found" | "no_evidence" | "unverified_evidence";

export type ApproveMemoryResult =
  | { memory: Memory; reason?: undefined }
  | { memory: null; reason: ApproveMemoryFailureReason };

/**
 * Human/system approval: PROPOSED/INFERRED → CONFIRMED (never silent FACT).
 *
 * Tenant boundary (P0 fix): `ownerId`, when provided, restricts which
 * memory this call can find (and therefore approve) to ones owned by that
 * caller — the route handler resolves it from the caller's real,
 * server-derived identity, never a client-supplied value. `ownerId` is
 * optional only for trusted internal/system callers (e.g. pipeline-internal
 * code that already validated ownership, or admin callers who intentionally
 * bypass per the same convention used by `scopeMemoriesToCaller` in
 * routes/memory.ts) — every HTTP-facing caller must pass it. When the
 * memory isn't found under the given owner (either it doesn't exist, or it
 * belongs to someone else), this returns `{ memory: null, reason:
 * "not_found" }` exactly like a genuine not-found, so callers can't
 * distinguish "doesn't exist" from "exists but isn't yours" (no
 * cross-tenant enumeration).
 *
 * Evidence-required gate: a memory with zero `evidence` entries can never
 * be promoted to CONFIRMED — CONFIRMED is a claim that a human/system has
 * verified the statement, and there is nothing here to point at as that
 * verification. Returns `{ memory: null, reason: "no_evidence" }` instead
 * (distinct from `"not_found"` — this is not a tenancy signal, so it's safe
 * to surface to the caller).
 *
 * On success, stamps `verifiedBy`/`verifiedAt` (provenance trail — who
 * approved this and when) using the same `ownerId` the caller already
 * authenticated with above; system/admin callers that omit `ownerId` leave
 * `verifiedBy` unset rather than fabricating an identity.
 *
 * Deliberately fetches the *unfiltered* list here (not
 * `osStore.getMemories(k, ownerId)`) and does the ownership check by hand:
 * this function read-modify-writes the whole per-key array via
 * `replaceMemories`, so writing back an ownerId-filtered subset would
 * silently drop every other owner's memories under that project/global key.
 */
export function approveMemory(input: {
  memoryId: string;
  projectId?: string | null;
  ownerId?: string;
}): ApproveMemoryResult {
  const key = input.projectId ?? null;
  const allKeys = key !== null ? [key] : ["global"];
  for (const k of allKeys) {
    const list = [...osStore.getMemories(k)];
    const idx = list.findIndex((m) => m.id === input.memoryId);
    if (idx < 0) continue;
    const current = list[idx]!;
    if (input.ownerId !== undefined && current.ownerId !== input.ownerId) {
      // Exists, but under a different owner — treat identically to
      // "not found" (see doc comment above); do not leak existence.
      continue;
    }
    // Evidence-required gate (see doc comment above): the memory was found
    // and is owned by the caller, but has no evidence backing it, so it is
    // definitively not approvable — return immediately rather than
    // continuing to search other keys (this is the right memory; it just
    // can't be promoted).
    if (current.evidence.length === 0) {
      return { memory: null, reason: "no_evidence" };
    }
    // Verification-required gate: the memory has evidence, but none of it
    // carries a genuine verification signal — USER-sourced evidence alone
    // is not sufficient to promote to CONFIRMED. At least one piece of
    // evidence must be from a verified source (SYSTEM, AGENT, EXTERNAL,
    // CODE, TEST, etc.) to warrant approval.
    const hasVerifiedEvidence = current.evidence.some(
      (e) => e.kind !== "USER" && e.kind !== "CONVERSATION",
    );
    if (!hasVerifiedEvidence) {
      return { memory: null, reason: "unverified_evidence" };
    }
    const nextEpistemic: EpistemicState =
      current.epistemicState === "PROPOSED" ||
      current.epistemicState === "INFERRED" ||
      current.epistemicState === "UNVERIFIED" ||
      current.epistemicState === "ASSUMED"
        ? "CONFIRMED"
        : current.epistemicState === "OBSERVED"
          ? "CONFIRMED"
          : current.epistemicState;
    const now = new Date().toISOString();
    const updated: Memory = {
      ...current,
      epistemicState: nextEpistemic,
      observationMode:
        nextEpistemic === "CONFIRMED" ? "CONFIRMED" : current.observationMode,
      confidence: Math.min(0.95, current.confidence + 0.1),
      updatedAt: now,
      reason: [
        ...current.reason,
        "pipeline:approved",
      ].slice(-12),
      ...(nextEpistemic === "CONFIRMED"
        ? {
            verifiedBy: input.ownerId ?? current.verifiedBy ?? null,
            verifiedAt: now,
          }
        : {}),
    };
    list[idx] = updated;
    osStore.replaceMemories(k, list);
    appendDomainEvent({
      type: "memory.created",
      projectId: updated.projectId,
      ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
      epistemicState: updated.epistemicState,
      payload: { memoryId: updated.id, action: "approve" },
    });
    return { memory: updated };
  }
  return { memory: null, reason: "not_found" };
}

/**
 * Per-agent scoping (P1 fix): true when `memory` may be returned to the
 * requesting agent(s). A memory with no `allowedAgents` set (null/undefined/
 * empty array) is unchanged/default-open — visible to any agent within the
 * existing `ownerId` tenant boundary. A memory that *does* set a non-empty
 * `allowedAgents` list is only visible when at least one identified
 * requester (`requestingAgentId` and/or `requestingAgentIds`) is in that
 * list. When both requester fields are omitted, the memory stays visible:
 * this is the backward-compat guarantee for human-facing callers
 * (conversation, generic agent run, memory list) that never identify an
 * agent. Enforcement only kicks in for callers that opt in by passing
 * requester identity.
 */
function isVisibleToAgent(
  memory: Memory,
  requestingAgentId?: string,
  requestingAgentIds?: readonly string[],
): boolean {
  const allowed = memory.allowedAgents;
  if (!allowed || allowed.length === 0) return true;
  const candidates = [
    ...(requestingAgentId ? [requestingAgentId] : []),
    ...(requestingAgentIds ?? []),
  ];
  if (candidates.length === 0) return true;
  return candidates.some((id) => allowed.includes(id));
}

function heuristicMemoryScore(memory: Memory, queryLower: string): number {
  let score = memory.confidence;
  if (memory.epistemicState === "FACT" || memory.epistemicState === "VERIFIED") {
    score += 0.2;
  } else if (
    memory.epistemicState === "CONFIRMED" ||
    memory.epistemicState === "OBSERVED"
  ) {
    score += 0.12;
  } else if (memory.epistemicState === "PROPOSED") {
    score -= 0.15;
  } else if (memory.epistemicState === "STALE") {
    score -= 0.35;
  }
  if (queryLower && memory.statement.toLowerCase().includes(queryLower)) {
    score += 0.25;
  }
  if (queryLower && memory.reason.some((r) => r.toLowerCase().includes(queryLower))) {
    score += 0.08;
  }
  if (memory.priority === "CRITICAL") score += 0.15;
  if (memory.priority === "HIGH") score += 0.08;
  if (memory.source === "qa-portfolio-pattern") score += 0.18;
  if (memory.source === "demo-seed") score += 0.05;
  // Recency boost (ISO timestamps sort lexicographically)
  const ageBoost = Math.min(
    0.1,
    Math.max(0, (Date.parse(memory.updatedAt) - Date.parse("2020-01-01")) / 1e13),
  );
  return score + ageBoost;
}

function memoryEmbedText(memory: Memory): string {
  return `${memory.statement}\n${memory.reason.join(" ")}`;
}

/**
 * Retrieve ACTIVE memories with a hard budget (token/cost control).
 *
 * Isolation (project / owner / agent) runs at the data layer before any
 * embedding or ranking. A denied memory cannot surface via cosine score.
 *
 * Ranking: heuristic fields always apply. When a query is present, cosine
 * similarity is added from the configured embedding provider. Hash-trick
 * vectors are an explicit `lexical-hash` fallback — never labeled semantic.
 */
export async function retrieveMemories(input: MemoryRetrieveInput): Promise<{
  items: Memory[];
  budget: number;
  truncated: boolean;
  embeddingKind: MemoryRetrievalEmbeddingKind;
}> {
  const budget = Math.max(1, Math.min(input.budget ?? 12, 40));
  const key = input.projectId ?? null;
  const pools: Memory[] = [];
  if (key) {
    pools.push(
      ...osStore
        .getMemories(key, input.ownerId)
        .filter((m) => m.projectId === key),
    );
  } else {
    pools.push(
      ...osStore
        .getMemories("global", input.ownerId)
        .filter((m) => m.projectId == null),
    );
  }
  const query = (input.query ?? "").trim();
  const queryLower = query.toLowerCase();
  const active = pools
    .filter((m) => m.status === "ACTIVE")
    .filter((m) =>
      isVisibleToAgent(m, input.requestingAgentId, input.requestingAgentIds),
    );

  let embeddingKind: MemoryRetrievalEmbeddingKind = "none";
  let queryVec: readonly number[] | null = null;
  const memoryVecs: Array<readonly number[] | null> = active.map(() => null);

  if (query.length > 0 && active.length > 0) {
    const provider =
      input.embeddingProvider ?? resolveEmbeddingProvider(input.embeddingEnv ?? {});
    try {
      const vectors = await safeEmbed(provider, [
        query,
        ...active.map(memoryEmbedText),
      ]);
      queryVec = vectors[0] ?? null;
      for (let i = 0; i < active.length; i += 1) {
        memoryVecs[i] = vectors[i + 1] ?? null;
      }
      embeddingKind = provider.kind;
    } catch {
      queryVec = null;
      embeddingKind = "none";
    }
  }

  const ranked = active
    .map((m, index) => {
      let score = heuristicMemoryScore(m, queryLower);
      const memoryVec = memoryVecs[index];
      if (queryVec && memoryVec) {
        const similarity = cosineSimilarity(queryVec, memoryVec);
        if (embeddingKind === "semantic") {
          score += similarity * SEMANTIC_COSINE_WEIGHT;
        } else if (embeddingKind === "lexical-hash") {
          score += Math.max(0, similarity) * LEXICAL_HASH_COSINE_WEIGHT;
        }
      }
      return { m, score };
    })
    .sort((a, b) => b.score - a.score);
  const items = ranked.slice(0, budget).map((r) => r.m);
  return {
    items,
    budget,
    truncated: ranked.length > budget,
    embeddingKind,
  };
}

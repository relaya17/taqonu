import {
  STUB_OWNER_ID,
  domainEventSchema,
  memorySchema,
  type DomainEvent,
  type DomainEventType,
  type EpistemicState,
  type EvidenceSourceType,
  type Memory,
  type MemoryEvidence,
  type MemoryType,
  type QaPortfolioPattern,
} from "@atlas/shared";
import { domainEventBus, redactSecrets } from "@atlas/agent-core";
import { cosineSimilarity, embedTextLocalSync } from "@atlas/embeddings";
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
export function buildMemoryContext(input: {
  projectId?: string | null;
  query?: string;
  budget?: number;
  /** P0 tenant-isolation fix: scope retrieval to this caller (admins omit). */
  ownerId?: string;
  /**
   * Per-agent scoping (P1 fix): the agent (kernel catalog id / plugin id)
   * asking for memory. When a memory has a non-empty `allowedAgents` list,
   * it is only returned when this matches one of those ids. Optional —
   * omit for callers that don't know/care which agent is asking; those
   * memories are simply excluded (see `retrieveMemories()` for the exact
   * filtering rule, including its backward-compat behavior).
   */
  requestingAgentId?: string;
}): MemoryContextPayload & { memories: Memory[] } {
  const retrieved = retrieveMemories(input);
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
      // request's caller. STUB_OWNER_ID marks system-owned memories, same
      // convention already used for domain-event ownerId above.
      ownerId: STUB_OWNER_ID,
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

/**
 * Evidence-gate verification-signal check (Gate 3 strengthening): true when
 * `evidence.kind` — case/whitespace-normalized — names one of
 * `evidenceSourceTypeSchema`'s inherently-verified source kinds (an
 * automated, system-observed result: TEST_RUN, CI, STAGING, PRODUCTION), as
 * opposed to something a person merely typed or asserted (USER,
 * CONVERSATION, or any other free-text `kind` a caller chose).
 *
 * `MemoryEvidence` (memory.schema.ts) is the lightweight
 * `{id, kind, reference, excerpt}` shape backing `Memory.evidence` — unlike
 * `evidenceRecordSchema`/`claimSchema` (evidence.schema.ts, the separate
 * Evidence/Claim pipeline referenced in the `Event → Observation → Claim →
 * Decision → Evidence → Evaluation → Resolution` comment above
 * `appendDomainEvent()`), it does not carry a `sourceType` or
 * `verificationMatrix` field, so `kind` — the closest thing it has to a
 * provenance tag — doubles as the verification signal here. Match is exact
 * (not fuzzy/substring) and case-insensitive, so a producer can't
 * accidentally satisfy this by, say, mentioning "ci" inside an unrelated
 * free-text kind like "discussion".
 */
const INHERENTLY_VERIFIED_EVIDENCE_KINDS: ReadonlySet<string> = new Set<EvidenceSourceType>([
  "TEST_RUN",
  "CI",
  "STAGING",
  "PRODUCTION",
]);

function hasVerificationSignal(evidence: MemoryEvidence): boolean {
  return INHERENTLY_VERIFIED_EVIDENCE_KINDS.has(evidence.kind.trim().toUpperCase());
}

/**
 * Why `approveMemory()` can fail — lets the route explain the *reason*
 * instead of collapsing every rejection into an ambiguous 404:
 *  - "not_found": the memory doesn't exist, or exists under a different
 *    owner. These two cases are deliberately indistinguishable from each
 *    other (no cross-tenant enumeration — see the ownerId doc below), but
 *    ARE distinguishable from either evidence-gate reason below, neither of
 *    which is a tenancy/existence signal, so both are safe to explain.
 *  - "no_evidence": the memory exists and is owned by the caller, but has
 *    zero `evidence` entries, so promoting it to CONFIRMED would assert
 *    verification that never happened (evidence-required gate, see below).
 *  - "unverified_evidence": the memory exists, is owned by the caller, and
 *    has at least one `evidence` entry — but none of them carry a genuine
 *    verification signal (see `hasVerificationSignal()`). A memory backed
 *    only by, e.g., a bare USER/CONVERSATION assertion has *evidence* in
 *    the literal sense (the array isn't empty) but nothing that was
 *    actually checked, so it cannot clear the same bar `"no_evidence"`
 *    protects. Distinct from `"no_evidence"` so callers/UIs can tell
 *    "there's nothing here at all" apart from "there's something here, but
 *    none of it was verified" — both are equally safe to surface, for the
 *    same reason `"no_evidence"` is: this is a content signal, not a
 *    tenancy/existence one.
 */
export type ApproveMemoryFailureReason =
  | "not_found"
  | "no_evidence"
  | "unverified_evidence";

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
 * Evidence-*verified* gate (Gate 3 strengthening — stricter than merely
 * non-empty): even with ≥1 `evidence` entry, at least one of them must carry
 * a genuine verification signal per `hasVerificationSignal()` — a bare
 * USER/CONVERSATION-style assertion is not, by itself, enough to promote a
 * memory to CONFIRMED, because nothing about it was actually checked.
 * Returns `{ memory: null, reason: "unverified_evidence" }` instead (see the
 * `ApproveMemoryFailureReason` doc comment above for why this is distinct
 * from, and equally safe to surface as, `"no_evidence"`).
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
    // Evidence-*verified* gate (see doc comment above): non-empty is not
    // enough on its own — at least one entry must carry a genuine
    // verification signal, or this is just an unchecked assertion wearing
    // an "evidence" label. Same early-return rationale as the check above.
    if (!current.evidence.some(hasVerificationSignal)) {
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
      epistemicState: updated.epistemicState,
      payload: { memoryId: updated.id, action: "approve" },
    });
    return { memory: updated };
  }
  return { memory: null, reason: "not_found" };
}

/** One evidence entry's provenance, resolved into an auditable, read-only shape. */
export type MemoryProvenanceEntry = {
  evidenceId: string;
  kind: string;
  /** Linkage back to whatever record `kind` names — a finding id, PR
   *  number, commit SHA, etc. Passed through verbatim: `MemoryEvidence`
   *  (memory.schema.ts) already carries this as a free-text `reference`
   *  string, and this resolver doesn't invent a stronger link than that. */
  reference: string;
  excerpt: string | null;
  /** Same judgment `approveMemory()`'s evidence-verified gate applies to
   *  this entry — see `hasVerificationSignal()`. */
  hasVerificationSignal: boolean;
};

/** Full evidence-provenance chain for one memory — "why does Atlas believe this". */
export type MemoryProvenance = {
  memoryId: string;
  epistemicState: EpistemicState;
  evidenceCount: number;
  verifiedEvidenceCount: number;
  /** True iff `approveMemory()`'s evidence-verified gate would currently
   *  pass for this memory (regardless of its current epistemicState) — lets
   *  a caller check "would this clear the bar" without calling approveMemory
   *  and mutating anything. */
  meetsApprovalEvidenceBar: boolean;
  entries: MemoryProvenanceEntry[];
};

/**
 * Read-only "why does Atlas believe this" trace (evidence provenance chain):
 * resolves `memory.evidence` into a structured, auditable form — every
 * entry's `kind`/`reference`/`excerpt` plus the same verification-signal
 * judgment the approval gate uses, so a reviewer (human or another service)
 * can see *why* a memory did or didn't clear that gate without re-deriving
 * the logic themselves. "Never confuse remembering with proving": this
 * function only surfaces what `MemoryEvidence` already carries (no store
 * lookups, no mutation, no invented fields) — it is purely a read/derive
 * projection of `memory`, safe to call on any memory regardless of who owns
 * it (callers are responsible for their own tenant-scoping, exactly like
 * `toMemoryContextItem()` above).
 */
export function resolveMemoryProvenance(memory: Memory): MemoryProvenance {
  const entries: MemoryProvenanceEntry[] = memory.evidence.map((evidence) => ({
    evidenceId: evidence.id,
    kind: evidence.kind,
    reference: evidence.reference,
    excerpt: evidence.excerpt ?? null,
    hasVerificationSignal: hasVerificationSignal(evidence),
  }));
  const verifiedEvidenceCount = entries.filter(
    (entry) => entry.hasVerificationSignal,
  ).length;
  return {
    memoryId: memory.id,
    epistemicState: memory.epistemicState,
    evidenceCount: entries.length,
    verifiedEvidenceCount,
    meetsApprovalEvidenceBar: verifiedEvidenceCount > 0,
    entries,
  };
}

/**
 * Per-agent scoping (P1 fix): true when `memory` may be returned to
 * `requestingAgentId`. A memory with no `allowedAgents` set (null/undefined/
 * empty array) is unchanged/default-open — visible to any agent within the
 * existing `ownerId` tenant boundary. A memory that *does* set a non-empty
 * `allowedAgents` list is only visible to agents in that list — but ONLY
 * when the caller actually identifies itself via `requestingAgentId`. When
 * `requestingAgentId` is omitted, the memory stays visible regardless of
 * `allowedAgents`: this is the backward-compat guarantee the task requires
 * — the overwhelming majority of existing `retrieveMemories()` /
 * `buildMemoryContext()` callers never pass `requestingAgentId` at all, and
 * this filter must be a strict no-op for them, exactly as before this field
 * existed. Enforcement only kicks in for callers that opt in by passing
 * `requestingAgentId`.
 */
function isVisibleToAgent(memory: Memory, requestingAgentId?: string): boolean {
  const allowed = memory.allowedAgents;
  if (!allowed || allowed.length === 0) return true;
  if (!requestingAgentId) return true;
  return allowed.includes(requestingAgentId);
}

/**
 * Weight applied to (clamped, non-negative) cosine similarity between the
 * query embedding and a memory statement's embedding in `retrieveMemories()`.
 * Sized to sit alongside the existing literal-substring bonus (0.25 below)
 * without swamping the epistemic-state / priority / recency terms that also
 * feed that same additive score — see the doc comment on `retrieveMemories()`
 * for the full hybrid-ranking rationale.
 */
const SEMANTIC_SIMILARITY_WEIGHT = 0.22;

/**
 * Per-process cache of local hash-trick statement embeddings, keyed by
 * `${memory.id}:${memory.statement}`. The statement text itself doubles as
 * the content-hash half of the key: an edited statement (e.g. after
 * `approveMemory()`/supersede touches `updatedAt` but leaves `statement`
 * alone in the common case, or a genuine statement edit) produces a
 * different key, so a stale vector is never returned — no separate
 * invalidation bookkeeping needed. Deliberately unbounded/no-eviction: this
 * matches the low-ceremony style of the rest of this scoring pass (nothing
 * else in `retrieveMemories()` memoizes either), and each entry is ~64
 * floats, so it stays cheap even for a large in-process memory pool.
 */
const memoryStatementEmbeddingCache = new Map<string, readonly number[]>();

function getMemoryStatementEmbedding(memory: Memory): readonly number[] {
  const cacheKey = `${memory.id}:${memory.statement}`;
  const cached = memoryStatementEmbeddingCache.get(cacheKey);
  if (cached) return cached;
  const vec = embedTextLocalSync(memory.statement);
  memoryStatementEmbeddingCache.set(cacheKey, vec);
  return vec;
}

/**
 * Retrieve ACTIVE memories with a hard budget (token/cost control).
 *
 * Query ranking is a hybrid, not a replacement: the pre-existing
 * literal-substring bonuses (query as a whole phrase found in `statement` or
 * `reason`) stay exactly as they were — nothing here narrows or filters the
 * candidate pool, so no memory that used to be reachable becomes
 * unreachable. Layered on top, when `query` is non-empty, every ACTIVE
 * candidate also gets a semantic-similarity bonus from
 * `@atlas/embeddings` — a fully local, offline, no-API-key, hash-trick
 * embedding (`embedTextLocalSync`) compared via `cosineSimilarity` — scaled
 * by `SEMANTIC_SIMILARITY_WEIGHT` and clamped to never go negative, so a
 * dissimilar memory is never scored *below* its query-less baseline (every
 * other term in this function is likewise additive-only, never punitive,
 * except the explicit PROPOSED/STALE epistemic penalties above). This lets a
 * query like "why did the deploy fail" surface a memory like "production
 * build broke due to missing env var" even though they share no literal
 * substring — something the substring bonus alone can never do. Note the
 * hash-trick embedding captures token/lexical-level signal rather than
 * trained semantic understanding, so its cross-vocabulary matches are
 * probabilistic, not guaranteed for arbitrary paraphrases (see
 * `packages/embeddings/src/provider.ts`).
 *
 * This only changes *which* memories rank where; it does not touch
 * epistemic-state or evidence-tagging — `toMemoryContextItem()` /
 * `buildMemoryContext()` still pass every returned `Memory` through
 * unchanged, and `MEMORY_CONTEXT_NOTE` still applies to whatever this
 * returns.
 */
export function retrieveMemories(input: {
  projectId?: string | null;
  query?: string;
  budget?: number;
  /** P0 tenant-isolation fix: scope retrieval to this caller (admins omit). */
  ownerId?: string;
  /**
   * Per-agent scoping (P1 fix): the agent (kernel catalog id / plugin id)
   * asking for memory. See `isVisibleToAgent()` for the exact filtering
   * rule. Optional and backward-compatible — omitting it behaves exactly as
   * before for any memory that doesn't set `allowedAgents`.
   */
  requestingAgentId?: string;
}): { items: Memory[]; budget: number; truncated: boolean } {
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
  const q = (input.query ?? "").trim().toLowerCase();
  // Semantic layer (hybrid ranking, see doc comment above): computed once per
  // call, outside the per-memory map below, since it doesn't depend on `m`.
  const qVec = q ? embedTextLocalSync(q) : null;
  // VALIDITY WINDOW (P0.5). `memorySchema` has carried `validFrom`/
  // `validUntil` all along, but retrieval only ever checked `status`. A
  // memory whose validity window has closed while its status is still
  // ACTIVE was therefore retrieved and handed to the LLM as current truth —
  // "the deploy key rotates monthly" outliving the month it described.
  //
  // Status and validity answer different questions: status is "has someone
  // retired this?", validity is "does this apply right now?". A fact can be
  // perfectly un-retired and still no longer true, so both must gate.
  const nowMs = Date.now();
  const withinValidityWindow = (m: Memory): boolean => {
    if (m.validFrom !== null && Date.parse(m.validFrom) > nowMs) return false;
    if (m.validUntil !== null && Date.parse(m.validUntil) <= nowMs) return false;
    return true;
  };

  const active = pools
    .filter((m) => m.status === "ACTIVE")
    .filter(withinValidityWindow)
    .filter((m) => isVisibleToAgent(m, input.requestingAgentId));
  const ranked = active
    .map((m) => {
      let score = m.confidence;
      if (m.epistemicState === "FACT" || m.epistemicState === "VERIFIED") {
        score += 0.2;
      } else if (m.epistemicState === "CONFIRMED" || m.epistemicState === "OBSERVED") {
        score += 0.12;
      } else if (m.epistemicState === "PROPOSED") {
        score -= 0.15;
      } else if (m.epistemicState === "STALE") {
        score -= 0.35;
      }
      if (q && m.statement.toLowerCase().includes(q)) score += 0.25;
      if (q && m.reason.some((r) => r.toLowerCase().includes(q))) score += 0.08;
      if (qVec) {
        const similarity = cosineSimilarity(qVec, getMemoryStatementEmbedding(m));
        // Clamp to non-negative: an unrelated memory must never score below
        // its query-less baseline (additive-bonus shape, see doc comment).
        if (similarity > 0) score += similarity * SEMANTIC_SIMILARITY_WEIGHT;
      }
      if (m.priority === "CRITICAL") score += 0.15;
      if (m.priority === "HIGH") score += 0.08;
      if (m.source === "qa-portfolio-pattern") score += 0.18;
      if (m.source === "demo-seed") score += 0.05;
      // Recency boost (ISO timestamps sort lexicographically)
      const ageBoost = Math.min(
        0.1,
        Math.max(0, (Date.parse(m.updatedAt) - Date.parse("2020-01-01")) / 1e13),
      );
      score += ageBoost;
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

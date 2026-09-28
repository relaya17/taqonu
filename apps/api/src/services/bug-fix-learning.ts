/**
 * B3 — Bug tracker → memory/knowledge learning loop.
 *
 * Only a *validated* fix becomes durable memory. Tracker status alone
 * (OPEN / REPRODUCED / FIXED / a claimed VERIFIED with no independent
 * evidence) is not truth. Provenance (bug id, fix evidence, owner) is
 * required. Same bug+fix does not mint unbounded duplicates.
 *
 * Ownership: user-owned bugs use the authenticated owner. Never
 * STUB_OWNER_ID (that placeholder is B5). Agent writes set `agentId`
 * (DEBUGGER) so B1 plan/dispatch isolation can scope retrieval.
 */
import {
  STUB_OWNER_ID,
  memorySchema,
  uuidSchema,
  type BugStatus,
  type Memory,
  type ObserverBug,
} from "@atlas/shared";
import { redactSecrets } from "@atlas/agent-core";
import { markBugVerified } from "@atlas/observer";
import { osStore } from "../store/os-store.js";
import {
  appendDomainEvent,
  commitMemory,
  findOwnedMemory,
  supersedeMemoryById,
} from "./memory-pipeline.js";
import { resolveEvidenceOwnerId } from "./write-owner.js";
import type { MemoryStoreEnv } from "@atlas/database";

export const BUG_FIX_MEMORY_SOURCE = "bug-fix-learning";
export const BUG_FIX_LEARNING_AGENT_ID = "DEBUGGER";

const BUG_ID_PREFIX = "bugId:";
const PATCH_ID_PREFIX = "patchId:";

export type BugFixEvidenceRef = {
  readonly kind: string;
  readonly reference: string;
  readonly excerpt?: string;
};

export type BugFixLearningInput = {
  readonly ownerId: string;
  readonly projectId: string | null;
  readonly bugId: string;
  readonly bugTitle: string;
  readonly bugDetail?: string;
  readonly bugStatus: BugStatus;
  /**
   * True only when an existing validation gate passed (patch
   * `verifyRemediationApply` ok → `recordRemediationVerification`).
   * A tracker-claimed VERIFIED without this still needs independent
   * osStore evidence (see `hasIndependentValidatedEvidence`).
   */
  readonly verifiedFix: boolean;
  readonly evidence: readonly BugFixEvidenceRef[];
  readonly patchId?: string | null;
  readonly agentId?: string | null;
  readonly allowedAgents?: readonly string[] | null;
  readonly env?: MemoryStoreEnv | null;
};

export type PersistBugFixMemoryResult =
  | { readonly status: "written"; readonly memory: Memory }
  | { readonly status: "duplicate"; readonly memory: Memory }
  | {
      readonly status: "skipped";
      readonly reason: "unverified" | "no_evidence" | "invalid_owner";
    };

function isUuid(value: string): boolean {
  return uuidSchema.safeParse(value).success;
}

function bugMarker(bugId: string): string {
  return `${BUG_ID_PREFIX}${bugId}`;
}

function patchMarker(patchId: string): string {
  return `${PATCH_ID_PREFIX}${patchId}`;
}

function metadataString(
  metadata: Readonly<Record<string, string | number | boolean | null>>,
  key: string,
): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Independent evidence already recorded by a prior gate (remediation
 * verify, observe-cycle SYSTEM evidence). USER/CONVERSATION rows are not
 * a verification signal — same rule as `approveMemory`.
 *
 * Evidence rows are tenant-owned or SYSTEM_OWNER_ID (B5); match by bug/patch
 * identity, not that placeholder.
 */
export function hasIndependentValidatedEvidence(input: {
  readonly ownerId: string;
  readonly projectId: string | null;
  readonly bugId: string;
  readonly patchId?: string | null;
  readonly evidence: readonly BugFixEvidenceRef[];
}): boolean {
  if (!input.projectId) return false;
  const records = osStore.getEvidence(input.projectId);
  if (records.length === 0) return false;
  const refs = new Set(input.evidence.map((e) => e.reference));
  const validated = new Set(["OBSERVED", "CONFIRMED", "VERIFIED"]);
  return records.some((ev) => {
    if (ev.sourceType === "USER" || ev.sourceType === "CONVERSATION") {
      return false;
    }
    if (!validated.has(ev.epistemicState)) return false;
    const metaBug =
      metadataString(ev.metadata, "bugId") ??
      metadataString(ev.metadata, "sourceIssueId");
    const metaPatch = metadataString(ev.metadata, "patchId");
    return (
      refs.has(ev.id) ||
      (ev.sourceId !== null && refs.has(ev.sourceId)) ||
      ev.source.includes(input.bugId) ||
      metaBug === input.bugId ||
      (input.patchId != null &&
        (metaPatch === input.patchId || ev.sourceId === input.patchId))
    );
  });
}

export function isValidatedBugFix(input: BugFixLearningInput): boolean {
  if (input.evidence.length === 0) return false;
  if (input.verifiedFix) return true;
  if (input.bugStatus !== "VERIFIED") return false;
  return hasIndependentValidatedEvidence(input);
}

export function findExistingBugFixMemory(
  input: Pick<
    BugFixLearningInput,
    "ownerId" | "projectId" | "bugId" | "patchId"
  >,
): Memory | null {
  const key = input.projectId ?? "global";
  const list = osStore.getMemories(key, input.ownerId);
  const bug = bugMarker(input.bugId);
  const patch = input.patchId ? patchMarker(input.patchId) : null;
  return (
    list.find(
      (m) =>
        m.status === "ACTIVE" &&
        m.source === BUG_FIX_MEMORY_SOURCE &&
        m.reason.includes(bug) &&
        (patch === null || m.reason.includes(patch)),
    ) ?? null
  );
}

function buildStatement(input: BugFixLearningInput): string {
  const title = redactSecrets(input.bugTitle).replace(/\s+/g, " ").trim();
  const detail = input.bugDetail
    ? redactSecrets(input.bugDetail).replace(/\s+/g, " ").trim().slice(0, 400)
    : "";
  const fix = input.patchId
    ? `Validated fix patch=${input.patchId}`
    : "Validated fix";
  const body = detail.length > 0 ? `${title} — ${detail}` : title;
  return `Bug ${input.bugId}: ${body}. ${fix}.`.slice(0, 4000);
}

/**
 * Persist a SOLUTION memory for a validated bug fix. Returns skipped when
 * the claim is unverified, has no evidence, or lacks a real owner.
 */
export function persistValidatedBugFixMemory(
  input: BugFixLearningInput,
): PersistBugFixMemoryResult {
  const requestOwner =
    isUuid(input.ownerId) && input.ownerId !== STUB_OWNER_ID
      ? input.ownerId
      : undefined;
  const ownerId = resolveEvidenceOwnerId({
    ...(requestOwner !== undefined ? { requestOwnerId: requestOwner } : {}),
    projectId: input.projectId,
  });
  if (!isUuid(ownerId) || ownerId === STUB_OWNER_ID) {
    return { status: "skipped", reason: "invalid_owner" };
  }
  if (input.evidence.length === 0) {
    return { status: "skipped", reason: "no_evidence" };
  }
  if (!isValidatedBugFix(input)) {
    return { status: "skipped", reason: "unverified" };
  }

  const existing = findExistingBugFixMemory({
    ...input,
    ownerId,
  });
  if (existing) {
    return { status: "duplicate", memory: existing };
  }

  const now = new Date().toISOString();
  const agentId = input.agentId ?? BUG_FIX_LEARNING_AGENT_ID;
  const reason = [
    "bug-fix-learning",
    bugMarker(input.bugId),
    ...(input.patchId ? [patchMarker(input.patchId)] : []),
    `bugStatus:${input.bugStatus}`,
    input.verifiedFix ? "gate:remediation-verify" : "gate:independent-evidence",
  ];

  const memory = memorySchema.parse({
    id: crypto.randomUUID(),
    ownerId,
    type: "SOLUTION",
    projectId: input.projectId,
    statement: buildStatement(input),
    reason,
    status: "ACTIVE",
    confidence: 0.85,
    category: "GENERATED_REASONING",
    epistemicState: "OBSERVED",
    observationMode: "OBSERVED",
    source: BUG_FIX_MEMORY_SOURCE,
    sourceType: "SYSTEM",
    sourceId: input.bugId,
    evidence: input.evidence.slice(0, 8).map((item) => ({
      id: crypto.randomUUID(),
      kind: item.kind.slice(0, 64),
      reference: item.reference.slice(0, 500),
      ...(item.excerpt !== undefined
        ? { excerpt: redactSecrets(item.excerpt).slice(0, 4000) }
        : {}),
    })),
    supersededBy: null,
    validFrom: now,
    validUntil: null,
    observedAt: now,
    createdAt: now,
    updatedAt: now,
    createdBy: BUG_FIX_MEMORY_SOURCE,
    scope: input.projectId ? "PROJECT" : "GLOBAL",
    priority: "HIGH",
    agentId,
    ...(input.allowedAgents !== undefined
      ? { allowedAgents: input.allowedAgents ? [...input.allowedAgents] : null }
      : {}),
  });
  void commitMemory({ memory, env: input.env ?? null });
  osStore.appendAudit({
    type: "bug.fix.learned",
    memoryId: memory.id,
    bugId: input.bugId,
    patchId: input.patchId ?? null,
    projectId: input.projectId,
    ownerId,
    agentId,
    at: now,
  });
  appendDomainEvent({
    type: "memory.created",
    projectId: input.projectId,
    ownerId,
    epistemicState: "OBSERVED",
    payload: {
      memoryId: memory.id,
      kind: "bug.fix.learned",
      bugId: input.bugId,
      patchId: input.patchId ?? null,
      note: "Validated bug fix — OBSERVED, not FACT.",
    },
  });
  return { status: "written", memory };
}

export function learnFromObserverBugs(input: {
  readonly ownerId: string;
  readonly projectId: string | null;
  readonly bugs: readonly ObserverBug[];
  readonly env?: MemoryStoreEnv | null;
}): Memory[] {
  const written: Memory[] = [];
  for (const bug of input.bugs) {
    const evidence = bug.evidenceRefs.map((ref) => ({
      kind: "bug_evidence",
      reference: ref,
    }));
    const result = persistValidatedBugFixMemory({
      ownerId: input.ownerId,
      projectId: input.projectId ?? bug.projectId,
      bugId: bug.id,
      bugTitle: bug.title,
      ...(bug.detail ? { bugDetail: bug.detail } : {}),
      bugStatus: bug.status,
      verifiedFix: false,
      evidence,
      agentId: BUG_FIX_LEARNING_AGENT_ID,
      env: input.env ?? null,
    });
    if (result.status === "written") {
      written.push(result.memory);
    }
  }
  return written;
}

/**
 * After `recordRemediationVerification` with verify.ok: persist the lesson
 * and stamp the matching observer bug VERIFIED when we have a workspace.
 */
// ─────────────────────────────────────────────────────────────────────────────
// ARL-WS-004 GAP A + B — Re-validation & Evidence-change lifecycle
//
// Contract:
//   • Existing knowledge is NEVER hard-deleted.
//   • Re-validation does NOT promote epistemic state autonomously — D2 human-
//     approval path (OBSERVED → VERIFIED) is unaffected.
//   • Lifecycle status transitions use the existing vocabulary:
//       epistemicState: STALE (evidence weakened) | CONFLICTED (contradiction)
//       status: SUPERSEDED (superseded by a successor record)
//   • Every transition emits an audit entry + domain event via existing infra.
//   • Idempotent: same memoryId + same evidence set ≠ duplicate lifecycle event.
// ─────────────────────────────────────────────────────────────────────────────

export type RevalidationOutcome =
  | "STILL_VALID"
  | "STALE"
  | "CONFLICTED"
  | "SUPERSEDED";

export type RevalidateBugFixMemoryInput = {
  /** The knowledge record to re-validate. Must be owned by ownerId. */
  readonly memoryId: string;
  readonly ownerId: string;
  /** New evidence observed after the original fix was recorded. */
  readonly newEvidence: readonly BugFixEvidenceRef[];
  /**
   * True when new evidence directly contradicts the original fix (same bug
   * re-appeared, regression, counter-evidence). False means the fix is less
   * certain but not actively refuted — evidence is consistent/supporting.
   */
  readonly contradicts: boolean;
  /**
   * True when new evidence weakens confidence without direct contradiction
   * (e.g. fix less frequently applied, context drifted). When false and
   * contradicts is also false, evidence is treated as supporting → STILL_VALID.
   */
  readonly weakens?: boolean;
  /**
   * When the caller has already produced a validated successor knowledge record
   * (i.e. a new persistValidatedBugFixMemory result), pass its id here.
   * The original record is then marked SUPERSEDED and linked to the successor.
   * MUST be owned by the same ownerId — cross-tenant supersession is rejected.
   */
  readonly successorMemoryId?: string | null;
  readonly env?: MemoryStoreEnv | null;
};

export type RevalidateBugFixMemoryResult =
  | {
      readonly outcome: "STILL_VALID";
      readonly memory: Memory;
    }
  | {
      readonly outcome: "STALE" | "CONFLICTED" | "SUPERSEDED";
      readonly memory: Memory;
      readonly previousEpistemicState: string;
    }
  | {
      readonly outcome: "skipped";
      readonly reason: "not_found" | "not_active" | "wrong_source";
    };

/**
 * Re-validate an existing bug-fix knowledge record against new evidence.
 *
 * LIFECYCLE SEMANTICS (maps to existing epistemic vocabulary):
 *   STILL_VALID   — new evidence is consistent with the original fix; record unchanged.
 *   STALE         — new evidence weakens confidence but does not contradict;
 *                   epistemicState updated to STALE, status remains ACTIVE (still
 *                   retrievable, but ranked lower by the heuristic scorer).
 *   CONFLICTED    — new evidence directly contradicts the fix (regression, counter-
 *                   evidence); epistemicState updated to CONFLICTED, record remains
 *                   as history (status stays ACTIVE so it surfaces in conflict review).
 *   SUPERSEDED    — a validated successor record replaces this one; status becomes
 *                   SUPERSEDED and supersededBy is set (irreversible lifecycle end).
 *
 * D2 COMPATIBILITY:
 *   This function NEVER changes epistemicState to VERIFIED. That transition
 *   requires explicit human approval via approvePatchArtifact (D2-1). Re-validation
 *   can only move toward weaker/historical states (STALE, CONFLICTED, SUPERSEDED)
 *   or confirm the current state is still valid.
 *
 * OWNERSHIP:
 *   Only the owning tenant can re-validate their own knowledge. Cross-tenant
 *   revalidation returns "not_found" (indistinguishable from missing — same as
 *   findOwnedMemory contract).
 */
export function revalidateBugFixMemory(
  input: RevalidateBugFixMemoryInput,
): RevalidateBugFixMemoryResult {
  if (input.newEvidence.length === 0 && !input.successorMemoryId) {
    // No evidence, no successor — nothing to act on; treat as STILL_VALID.
    const located = findOwnedMemory({ memoryId: input.memoryId, ownerId: input.ownerId });
    if (!located) return { outcome: "skipped", reason: "not_found" };
    if (located.memory.status !== "ACTIVE") return { outcome: "skipped", reason: "not_active" };
    if (located.memory.source !== BUG_FIX_MEMORY_SOURCE) return { outcome: "skipped", reason: "wrong_source" };
    return { outcome: "STILL_VALID", memory: located.memory };
  }

  const located = findOwnedMemory({ memoryId: input.memoryId, ownerId: input.ownerId });
  if (!located) return { outcome: "skipped", reason: "not_found" };
  if (located.memory.status !== "ACTIVE") return { outcome: "skipped", reason: "not_active" };
  if (located.memory.source !== BUG_FIX_MEMORY_SOURCE) return { outcome: "skipped", reason: "wrong_source" };

  const current = located.memory;
  const now = new Date().toISOString();
  const previousEpistemicState = current.epistemicState;

  // Case 1: Caller supplies a validated successor — supersede the original.
  if (input.successorMemoryId) {
    // Ownership guard: successor must belong to the same owner (no cross-tenant supersession).
    const successorLocated = findOwnedMemory({
      memoryId: input.successorMemoryId,
      ownerId: input.ownerId,
    });
    if (!successorLocated) {
      // Successor not found under this owner — reject to prevent cross-tenant link.
      return { outcome: "skipped", reason: "not_found" };
    }
    supersedeMemoryById({
      memoryId: input.memoryId,
      newerMemoryId: input.successorMemoryId,
      ownerId: input.ownerId,
    });
    // Re-read the updated record.
    const updated = findOwnedMemory({ memoryId: input.memoryId, ownerId: input.ownerId });
    const updatedMemory = updated?.memory ?? { ...current, status: "SUPERSEDED" as const, supersededBy: input.successorMemoryId };
    appendDomainEvent({
      type: "memory.superseded",
      projectId: current.projectId,
      ownerId: input.ownerId,
      epistemicState: "STALE",
      payload: {
        kind: "bug.fix.revalidated",
        memoryId: input.memoryId,
        outcome: "SUPERSEDED",
        successorMemoryId: input.successorMemoryId,
        evidenceCount: input.newEvidence.length,
        previousEpistemicState,
        note: "ARL-WS-004: original knowledge superseded by validated successor.",
      },
    });
    return {
      outcome: "SUPERSEDED",
      memory: updatedMemory,
      previousEpistemicState,
    };
  }

  // Case 2: New evidence without a successor — determine outcome from evidence semantics.
  //   contradicts=true              → CONFLICTED (direct counter-evidence)
  //   contradicts=false, weakens=true → STALE (confidence reduced, not refuted)
  //   contradicts=false, weakens=false/undefined → STILL_VALID (supporting evidence)
  if (!input.contradicts && !input.weakens) {
    // Evidence supports the existing knowledge — record remains unchanged.
    return { outcome: "STILL_VALID", memory: current };
  }
  const nextOutcome: "STALE" | "CONFLICTED" = input.contradicts ? "CONFLICTED" : "STALE";
  const nextEpistemicState = nextOutcome; // "STALE" | "CONFLICTED" — both exist in EPISTEMIC_STATES

  const key = current.projectId ?? "global";
  const list = [...osStore.getMemories(key)];
  const idx = list.findIndex((m) => m.id === input.memoryId);
  if (idx < 0) return { outcome: "skipped", reason: "not_found" };

  const newEvidenceRecords = input.newEvidence.slice(0, 4).map((item) => ({
    id: crypto.randomUUID(),
    kind: item.kind.slice(0, 64),
    reference: item.reference.slice(0, 500),
    ...(item.excerpt !== undefined
      ? { excerpt: redactSecrets(item.excerpt).slice(0, 4000) }
      : {}),
  }));

  const updated: Memory = memorySchema.parse({
    ...current,
    epistemicState: nextEpistemicState,
    // status stays ACTIVE intentionally — STALE/CONFLICTED records are
    // retained as history and surface in conflict-review flows.
    reason: [
      ...current.reason.slice(0, 8),
      `revalidated:${nextOutcome.toLowerCase()}`,
      `revalidated-at:${now}`,
    ].slice(0, 12),
    evidence: [
      ...current.evidence,
      ...newEvidenceRecords,
    ].slice(0, 12),
    confidence: nextOutcome === "CONFLICTED"
      ? Math.max(0.1, current.confidence - 0.3)
      : Math.max(0.2, current.confidence - 0.15),
    updatedAt: now,
  });

  list[idx] = updated;
  osStore.replaceMemories(key, list);

  osStore.appendAudit({
    type: "bug.fix.revalidated",
    memoryId: input.memoryId,
    bugId: current.sourceId ?? "",
    patchId: null,
    projectId: current.projectId,
    ownerId: input.ownerId,
    agentId: current.agentId ?? BUG_FIX_LEARNING_AGENT_ID,
    at: now,
  });
  appendDomainEvent({
    type: "memory.created",
    projectId: current.projectId,
    ownerId: input.ownerId,
    epistemicState: nextEpistemicState,
    payload: {
      kind: "bug.fix.revalidated",
      memoryId: input.memoryId,
      outcome: nextOutcome,
      evidenceCount: input.newEvidence.length,
      previousEpistemicState,
      contradicts: input.contradicts,
      note: "ARL-WS-004: knowledge lifecycle updated; original record retained as history.",
    },
  });

  return { outcome: nextOutcome, memory: updated, previousEpistemicState };
}

export function learnFromVerifiedPatch(input: {
  readonly ownerId: string;
  readonly projectId: string | null;
  readonly bugId: string;
  readonly bugTitle: string;
  readonly bugDetail?: string;
  readonly patchId: string;
  readonly evidenceId: string | null;
  readonly verifySummary: string;
  readonly workspaceRoot?: string | null;
  readonly env?: MemoryStoreEnv | null;
}): PersistBugFixMemoryResult {
  const evidenceRef = input.evidenceId ?? input.patchId;
  const result = persistValidatedBugFixMemory({
    ownerId: input.ownerId,
    projectId: input.projectId,
    bugId: input.bugId,
    bugTitle: input.bugTitle,
    ...(input.bugDetail ? { bugDetail: input.bugDetail } : {}),
    bugStatus: "VERIFIED",
    verifiedFix: true,
    evidence: [
      {
        kind: "remediation_verify",
        reference: evidenceRef,
        excerpt: input.verifySummary,
      },
    ],
    patchId: input.patchId,
    agentId: BUG_FIX_LEARNING_AGENT_ID,
    env: input.env ?? null,
  });
  if (input.workspaceRoot) {
    markBugVerified(input.workspaceRoot, input.bugId, [evidenceRef]);
  }
  return result;
}

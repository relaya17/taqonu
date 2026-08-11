/** Formal epistemic states — never silently merge categories. ADR-014 v2. */

export const EPISTEMIC_STATES = [
  "FACT",
  "CONFIRMED",
  "VERIFIED",
  "OBSERVED",
  "INFERRED",
  "ASSUMED",
  "PROPOSED",
  "UNVERIFIED",
  "CONTRADICTED",
  "STALE",
  "UNKNOWN",
  "CONFLICTED",
  /** Kernel: refuse confident hallucination — say we don't know. */
  "INSUFFICIENT_EVIDENCE",
] as const;

export type EpistemicState = (typeof EPISTEMIC_STATES)[number];

/** Knowledge category separation (WHAT EXISTS / DECIDED / HAPPENED / NEXT / WORLD / AI). */
export const KNOWLEDGE_CATEGORIES = [
  "REPOSITORY_EVIDENCE",
  "DECISION_MEMORY",
  "EVENT_MEMORY",
  "ROADMAP_TASK",
  "VERIFIED_WEB_KNOWLEDGE",
  "GENERATED_REASONING",
] as const;

export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

/** Data classification for evidence egress (ADR-014). */
export const DATA_CLASSIFICATIONS = [
  "PUBLIC",
  "INTERNAL",
  "CONFIDENTIAL",
  "SECRET",
  "RESTRICTED",
] as const;

export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];

/** Map legacy v1 labels toward Evidence Model v2. */
export const EPISTEMIC_V1_TO_V2: Partial<
  Record<EpistemicState, EpistemicState>
> = {
  CONFIRMED: "VERIFIED",
  CONFLICTED: "CONTRADICTED",
  PROPOSED: "ASSUMED",
};

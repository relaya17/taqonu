import { z } from "zod";
import { uuidSchema, isoDateTimeSchema } from "./common.schema.js";

/**
 * Knowledge Provenance Schema — tracks where knowledge comes from,
 * its authority, freshness, and verification status for Expert Battle.
 *
 * Every knowledge item carries:
 * - Source information (who said this, based on what)
 * - Authority scoring (how trustworthy is the source)
 * - Freshness tracking (how current is it)
 * - Verification status (has it been verified)
 */

/* ─────────────────────────────────────────────────────────────────────────────
   Knowledge Source Types
   ───────────────────────────────────────────────────────────────────────────── */

export const provenanceSourceTypeSchema = z.enum([
  "OFFICIAL_DOCUMENTATION",
  "STANDARDS",
  "CVE_ADVISORY",
  "PROFESSIONAL_BOOKS",
  "ACADEMIC_PAPERS",
  "SOURCE_CODE",
  "ISSUE_TRACKER",
  "COMMUNITY_QA",
  "BLOG_TUTORIAL",
  "LLM_GENERATED",
]);

export type ProvenanceSourceType = z.infer<typeof provenanceSourceTypeSchema>;

export const knowledgeVerificationStatusSchema = z.enum([
  "VERIFIED",
  "PARTIAL",
  "UNVERIFIED",
  "CONTRADICTED",
  "SUPERSEDED",
]);

export type KnowledgeVerificationStatus = z.infer<typeof knowledgeVerificationStatusSchema>;

/* ─────────────────────────────────────────────────────────────────────────────
   Six-Score System
   ───────────────────────────────────────────────────────────────────────────── */

export const knowledgeScoresSchema = z.object({
  /** Source trustworthiness (0-1) */
  authority: z.number().min(0).max(1),
  /** How current the information is (0-1) */
  freshness: z.number().min(0).max(1),
  /** Match to the specific query (0-1) */
  relevance: z.number().min(0).max(1),
  /** Quality of supporting evidence (0-1) */
  evidenceQuality: z.number().min(0).max(1),
  /** Independent corroboration available (0-1) */
  independence: z.number().min(0).max(1),
  /** Verification status */
  verificationStatus: knowledgeVerificationStatusSchema,
});

export type KnowledgeScores = z.infer<typeof knowledgeScoresSchema>;

/* ─────────────────────────────────────────────────────────────────────────────
   Knowledge Item — single piece of knowledge with provenance
   ───────────────────────────────────────────────────────────────────────────── */

export const knowledgeItemSchema = z.object({
  /** Unique identifier for this knowledge item */
  knowledgeId: uuidSchema,
  
  /** The actual claim or fact */
  claim: z.string().min(1).max(2000),
  
  /** Domain this knowledge belongs to */
  domain: z.string().min(1).max(100),
  
  /** Source information */
  source: z.object({
    /** Source name or title */
    name: z.string().min(1).max(500),
    /** Source URL if available */
    url: z.string().url().nullable().default(null),
    /** Type of source */
    type: provenanceSourceTypeSchema,
    /** Version of the source (e.g., "v2.1", "2024 edition") */
    version: z.string().max(50).nullable().default(null),
    /** Author or organization */
    author: z.string().max(200).nullable().default(null),
  }),
  
  /** Temporal information */
  timestamps: z.object({
    /** When this knowledge was created in Atlas */
    createdAt: isoDateTimeSchema,
    /** Original publication date of the source */
    publishedAt: isoDateTimeSchema.nullable().default(null),
    /** Last verification date */
    lastVerifiedAt: isoDateTimeSchema.nullable().default(null),
    /** Last time this knowledge was accessed/used */
    lastSeenAt: isoDateTimeSchema.nullable().default(null),
  }),
  
  /** Six-score system */
  scores: knowledgeScoresSchema,
  
  /** Supporting evidence references */
  evidenceRefs: z.array(z.string().max(500)).max(20).default([]),
  
  /** Known contradictions (other knowledge items that contradict this) */
  contradictions: z.array(uuidSchema).max(10).default([]),
  
  /** If superseded, the ID of the newer knowledge item */
  supersededBy: uuidSchema.nullable().default(null),
  
  /** Agent or expert that introduced this knowledge */
  introducedBy: z.string().max(100).nullable().default(null),
  
  /** Confidence level (0-1) in this knowledge */
  confidence: z.number().min(0).max(1),
  
  /** Tags for categorization */
  tags: z.array(z.string().max(50)).max(20).default([]),
});

export type KnowledgeItem = z.infer<typeof knowledgeItemSchema>;

/* ─────────────────────────────────────────────────────────────────────────────
   Knowledge Query — how agents look up knowledge
   ───────────────────────────────────────────────────────────────────────────── */

export const knowledgeQuerySchema = z.object({
  /** Search query */
  query: z.string().min(1).max(500),
  /** Domain to search in */
  domain: z.string().max(100).nullable().default(null),
  /** Minimum authority score required */
  minAuthority: z.number().min(0).max(1).default(0.5),
  /** Minimum freshness score required */
  minFreshness: z.number().min(0).max(1).default(0.3),
  /** Source types to include */
  sourceTypes: z.array(provenanceSourceTypeSchema).default([]),
  /** Exclude superseded knowledge */
  excludeSuperseded: z.boolean().default(true),
  /** Exclude contradicted knowledge */
  excludeContradicted: z.boolean().default(false),
  /** Maximum results */
  limit: z.number().int().min(1).max(100).default(10),
});

export type KnowledgeQuery = z.infer<typeof knowledgeQuerySchema>;

/* ─────────────────────────────────────────────────────────────────────────────
   Knowledge Update — for knowledge freshness tracking
   ───────────────────────────────────────────────────────────────────────────── */

export const knowledgeUpdateSchema = z.object({
  /** ID of the knowledge item being updated */
  knowledgeId: uuidSchema,
  /** What changed */
  changeType: z.enum([
    "VERIFICATION",
    "CONTRADICTION_FOUND",
    "SUPERSEDED",
    "SCORES_UPDATED",
    "EVIDENCE_ADDED",
    "FRESHNESS_CHECK",
  ]),
  /** Previous state */
  previousScores: knowledgeScoresSchema.nullable().default(null),
  /** New state */
  newScores: knowledgeScoresSchema,
  /** Who made the update */
  updatedBy: z.string().max(100),
  /** When */
  updatedAt: isoDateTimeSchema,
  /** Reason for the update */
  reason: z.string().max(500).nullable().default(null),
});

export type KnowledgeUpdate = z.infer<typeof knowledgeUpdateSchema>;

/* ─────────────────────────────────────────────────────────────────────────────
   Knowledge Conflict — when agents disagree
   ───────────────────────────────────────────────────────────────────────────── */

export const knowledgeConflictSchema = z.object({
  /** Conflict ID */
  conflictId: uuidSchema,
  /** First knowledge item */
  knowledgeIdA: uuidSchema,
  /** Second knowledge item */
  knowledgeIdB: uuidSchema,
  /** Type of conflict */
  conflictType: z.enum([
    "DIRECT_CONTRADICTION",
    "PARTIAL_OVERLAP",
    "VERSION_MISMATCH",
    "TEMPORAL_CONFLICT",
    "AUTHORITY_CONFLICT",
  ]),
  /** Description of the conflict */
  description: z.string().max(1000),
  /** Resolution status */
  resolution: z.enum([
    "UNRESOLVED",
    "A_PREFERRED",
    "B_PREFERRED",
    "BOTH_INVALID",
    "CONTEXT_DEPENDENT",
    "ESCALATED",
  ]).default("UNRESOLVED"),
  /** How the conflict was resolved */
  resolutionReason: z.string().max(500).nullable().default(null),
  /** Who resolved it */
  resolvedBy: z.string().max(100).nullable().default(null),
  /** When */
  createdAt: isoDateTimeSchema,
  resolvedAt: isoDateTimeSchema.nullable().default(null),
});

export type KnowledgeConflict = z.infer<typeof knowledgeConflictSchema>;

/* ─────────────────────────────────────────────────────────────────────────────
   Helper Functions
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Compute composite score from 6 individual scores.
 */
export function computeCompositeKnowledgeScore(scores: KnowledgeScores): number {
  const weights = {
    authority: 0.25,
    freshness: 0.15,
    relevance: 0.20,
    evidenceQuality: 0.20,
    independence: 0.10,
    verification: 0.10,
  };

  const verificationMultiplier =
    scores.verificationStatus === "VERIFIED"
      ? 1.0
      : scores.verificationStatus === "PARTIAL"
        ? 0.7
        : scores.verificationStatus === "CONTRADICTED"
          ? 0.3
          : scores.verificationStatus === "SUPERSEDED"
            ? 0.2
            : 0.4;

  return (
    scores.authority * weights.authority +
    scores.freshness * weights.freshness +
    scores.relevance * weights.relevance +
    scores.evidenceQuality * weights.evidenceQuality +
    scores.independence * weights.independence +
    verificationMultiplier * weights.verification
  );
}

/**
 * Determine if knowledge should be trusted based on scores.
 */
export function isKnowledgeTrustworthy(
  scores: KnowledgeScores,
  minComposite = 0.6,
): boolean {
  if (scores.verificationStatus === "CONTRADICTED") return false;
  if (scores.verificationStatus === "SUPERSEDED") return false;
  return computeCompositeKnowledgeScore(scores) >= minComposite;
}

/**
 * Calculate freshness decay based on publication date.
 */
export function calculateFreshnessDecay(
  publishedAt: string | null,
  now = new Date(),
  halfLifeDays = 365,
): number {
  if (!publishedAt) return 0.5;
  const published = new Date(publishedAt);
  const daysSince = (now.getTime() - published.getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(0, Math.exp(-Math.LN2 * daysSince / halfLifeDays));
}

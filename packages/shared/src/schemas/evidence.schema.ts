import { z } from "zod";
import {
  confidenceSchema,
  epistemicStateSchema,
  isoDateTimeSchema,
  uuidSchema,
} from "./common.schema.js";
import { sourceAuthorityRankSchema } from "./authority.schema.js";
import { DATA_CLASSIFICATIONS } from "../constants/epistemic.js";
import {
  EVIDENCE_CATEGORIES,
  type EvidenceCategory,
} from "../constants/state.js";

export const evidenceSourceTypeSchema = z.enum([
  "GITHUB",
  "REPOSITORY_FILE",
  "COMMIT",
  "PULL_REQUEST",
  "ISSUE",
  "DECISION_LOG",
  "MEMORY",
  "CONVERSATION",
  "CONNECTOR",
  "SYSTEM",
  "USER",
  "ARTIFACT",
  "TEST_RUN",
  "CI",
  "STAGING",
  "PRODUCTION",
]);

export const dataClassificationSchema = z.enum(DATA_CLASSIFICATIONS);

/** Engineering evidence categories — same keys as Current State slices. */
export const evidenceCategorySchema = z.enum(EVIDENCE_CATEGORIES);

export const verificationMatrixSchema = z.object({
  inCode: z.boolean().default(false),
  hasTest: z.boolean().default(false),
  liveVerified: z.boolean().default(false),
});

/**
 * Assign a typed category from provenance signals.
 * This is typed placement, not a silent merge of distinct categories.
 */
export function inferEvidenceCategory(input: {
  category?: string | null;
  sourceType?: string | null;
  source?: string | null;
  metadata?: Readonly<Record<string, string | number | boolean | null>> | null;
}): EvidenceCategory {
  if (
    input.category &&
    (EVIDENCE_CATEGORIES as readonly string[]).includes(input.category)
  ) {
    return input.category as EvidenceCategory;
  }

  const kind = input.metadata?.kind;
  const sourceType = input.sourceType ?? "";
  const source = (input.source ?? "").toLowerCase();

  if (kind === "architecture_doc") return "ARCHITECTURE";
  if (kind === "dependency_manifest") return "DEPENDENCIES";
  if (kind === "security" || source.includes("security")) return "SECURITY";
  if (kind === "risk" || source.includes("risk")) return "RISKS";
  if (kind === "task" || source.includes("task")) return "TASKS";

  if (
    sourceType === "GITHUB" ||
    sourceType === "COMMIT" ||
    sourceType === "PULL_REQUEST" ||
    sourceType === "ISSUE"
  ) {
    return "GIT";
  }
  if (sourceType === "TEST_RUN" || sourceType === "CI") return "TESTS";
  if (sourceType === "PRODUCTION" || sourceType === "STAGING") {
    return "DEPLOYMENT";
  }
  if (sourceType === "DECISION_LOG" || sourceType === "MEMORY") {
    return "DECISIONS";
  }
  if (
    source.includes("supabase") ||
    source.includes("mongodb") ||
    source.includes("mongo") ||
    source.includes("database")
  ) {
    return "DATABASE";
  }
  if (sourceType === "CONNECTOR") {
    if (
      input.metadata?.schema != null ||
      input.metadata?.collectionCount != null ||
      input.metadata?.tableCount != null
    ) {
      return "DATABASE";
    }
  }
  if (source.includes("env") || source.includes("environment")) {
    return "ENVIRONMENT";
  }
  if (sourceType === "REPOSITORY_FILE") return "CODE";
  if (source.includes("vercel") || source.includes("deploy")) {
    return "DEPLOYMENT";
  }

  // Least-wrong typed home for uncategorized legacy SYSTEM/ARTIFACT rows.
  return "CODE";
}

/** First-class evidence record — every important claim points here. */
export const evidenceRecordSchema = z.object({
  id: uuidSchema,
  ownerId: uuidSchema,
  projectId: uuidSchema.nullable(),
  source: z.string().min(1).max(500),
  sourceType: evidenceSourceTypeSchema,
  sourceId: z.string().min(1).max(500).nullable(),
  uri: z.string().max(2000).nullable(),
  excerpt: z.string().max(8000).nullable(),
  version: z.string().max(120).nullable(),
  observedAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  confidence: confidenceSchema,
  epistemicState: epistemicStateSchema,
  /** Typed engineering category — never silently collapsed across slices. */
  category: evidenceCategorySchema,
  classification: dataClassificationSchema.default("INTERNAL"),
  authorityRank: sourceAuthorityRankSchema.default("REPOSITORY_CODE"),
  metadata: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null()]),
  ),
});

export const createEvidenceRecordSchema = z.object({
  projectId: uuidSchema.nullable().optional(),
  source: z.string().min(1).max(500),
  sourceType: evidenceSourceTypeSchema,
  sourceId: z.string().min(1).max(500).nullable().optional(),
  uri: z.string().max(2000).nullable().optional(),
  excerpt: z.string().max(8000).nullable().optional(),
  version: z.string().max(120).nullable().optional(),
  observedAt: isoDateTimeSchema.optional(),
  confidence: confidenceSchema.optional(),
  epistemicState: epistemicStateSchema.default("FACT"),
  category: evidenceCategorySchema.optional(),
  classification: dataClassificationSchema.optional(),
  authorityRank: sourceAuthorityRankSchema.optional(),
  metadata: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional(),
});

export type EvidenceRecord = z.infer<typeof evidenceRecordSchema>;
export type CreateEvidenceRecord = z.infer<typeof createEvidenceRecordSchema>;

export const evidenceByCategoryBucketSchema = z.object({
  category: evidenceCategorySchema,
  items: z.array(evidenceRecordSchema),
});

export type EvidenceByCategoryBucket = z.infer<
  typeof evidenceByCategoryBucketSchema
>;

/** Always emit every category (empty arrays allowed) — never drop a slice. */
export function groupEvidenceByCategory(
  records: readonly EvidenceRecord[],
): EvidenceByCategoryBucket[] {
  const buckets = new Map<EvidenceCategory, EvidenceRecord[]>();
  for (const key of EVIDENCE_CATEGORIES) {
    buckets.set(key, []);
  }
  for (const record of records) {
    const list = buckets.get(record.category);
    if (!list) {
      throw new Error(
        `Unknown evidence category "${String(record.category)}" — refusing silent merge`,
      );
    }
    list.push(record);
  }
  return EVIDENCE_CATEGORIES.map((category) => ({
    category,
    items: buckets.get(category) ?? [],
  }));
}

/**
 * Hard guard: aggregations must preserve per-record categories.
 * Distinct CODE/GIT/SECURITY/… must not collapse into one blob.
 */
export function assertCategoriesPreserved(
  records: readonly EvidenceRecord[],
  grouped: readonly EvidenceByCategoryBucket[],
): void {
  if (grouped.length !== EVIDENCE_CATEGORIES.length) {
    throw new Error(
      "Evidence category rollup omitted categories — silent merge forbidden",
    );
  }

  const flat = grouped.flatMap((bucket) => bucket.items);
  if (flat.length !== records.length) {
    throw new Error(
      "Evidence category rollup lost or duplicated records — silent merge forbidden",
    );
  }

  const byId = new Map(records.map((record) => [record.id, record]));
  for (const bucket of grouped) {
    for (const item of bucket.items) {
      const original = byId.get(item.id);
      if (!original) {
        throw new Error(
          `Unknown evidence ${item.id} in category rollup — silent merge forbidden`,
        );
      }
      if (
        original.category !== bucket.category ||
        item.category !== bucket.category
      ) {
        throw new Error(
          `Silent category merge forbidden: evidence ${item.id} is ${original.category} but placed under ${bucket.category}`,
        );
      }
    }
  }

  const distinct = new Set(records.map((record) => record.category));
  const nonEmpty = grouped
    .filter((bucket) => bucket.items.length > 0)
    .map((bucket) => bucket.category);
  if (nonEmpty.length !== distinct.size) {
    throw new Error(
      "Evidence categories were silently merged or dropped in rollup",
    );
  }
}

/**
 * Parse evidence with required category — infers a typed category when omitted
 * (legacy rows), never invents epistemic FACT.
 */
export function parseEvidenceRecord(
  input: Omit<z.input<typeof evidenceRecordSchema>, "category"> & {
    category?: EvidenceCategory | null;
  },
): EvidenceRecord {
  return evidenceRecordSchema.parse({
    ...input,
    category: inferEvidenceCategory(input),
  });
}

/** A claim that MUST reference evidence and carry an epistemic label (ADR-014). */
export const claimSchema = z.object({
  id: uuidSchema,
  ownerId: uuidSchema,
  projectId: uuidSchema.nullable(),
  statement: z.string().min(1).max(4000),
  epistemicState: epistemicStateSchema,
  confidence: confidenceSchema,
  evidenceIds: z.array(uuidSchema).min(0),
  derivedFrom: z.array(uuidSchema).default([]),
  source: z.string().max(500).nullable().default(null),
  authorityRank: sourceAuthorityRankSchema.default("DEVELOPER_STATEMENT"),
  verification: verificationMatrixSchema.default({
    inCode: false,
    hasTest: false,
    liveVerified: false,
  }),
  observedAt: isoDateTimeSchema.nullable().default(null),
  verifiedAt: isoDateTimeSchema.nullable().default(null),
  expiresAt: isoDateTimeSchema.nullable().default(null),
  asOf: isoDateTimeSchema,
  version: z.string().max(120).nullable(),
  conflictingClaimIds: z.array(uuidSchema).default([]),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const createClaimSchema = z.object({
  projectId: uuidSchema.nullable().optional(),
  statement: z.string().min(1).max(4000),
  epistemicState: epistemicStateSchema,
  confidence: confidenceSchema.optional(),
  evidenceIds: z.array(uuidSchema).default([]),
  derivedFrom: z.array(uuidSchema).optional(),
  source: z.string().max(500).nullable().optional(),
  authorityRank: sourceAuthorityRankSchema.optional(),
  verification: verificationMatrixSchema.optional(),
  observedAt: isoDateTimeSchema.nullable().optional(),
  verifiedAt: isoDateTimeSchema.nullable().optional(),
  expiresAt: isoDateTimeSchema.nullable().optional(),
  asOf: isoDateTimeSchema.optional(),
  version: z.string().max(120).nullable().optional(),
});

export type Claim = z.infer<typeof claimSchema>;
export type CreateClaim = z.infer<typeof createClaimSchema>;
export type VerificationMatrix = z.infer<typeof verificationMatrixSchema>;

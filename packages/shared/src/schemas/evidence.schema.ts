import { z } from "zod";
import {
  confidenceSchema,
  epistemicStateSchema,
  isoDateTimeSchema,
  uuidSchema,
} from "./common.schema.js";
import { sourceAuthorityRankSchema } from "./authority.schema.js";
import { DATA_CLASSIFICATIONS } from "../constants/epistemic.js";

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

export const verificationMatrixSchema = z.object({
  inCode: z.boolean().default(false),
  hasTest: z.boolean().default(false),
  liveVerified: z.boolean().default(false),
});

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
  classification: dataClassificationSchema.optional(),
  authorityRank: sourceAuthorityRankSchema.optional(),
  metadata: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional(),
});

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

export type EvidenceRecord = z.infer<typeof evidenceRecordSchema>;
export type CreateEvidenceRecord = z.infer<typeof createEvidenceRecordSchema>;
export type Claim = z.infer<typeof claimSchema>;
export type CreateClaim = z.infer<typeof createClaimSchema>;
export type VerificationMatrix = z.infer<typeof verificationMatrixSchema>;

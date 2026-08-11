import { z } from "zod";
import { AUTHORITY_TIERS } from "../constants/tools.js";
import {
  confidenceSchema,
  epistemicStateSchema,
  isoDateTimeSchema,
  uuidSchema,
} from "./common.schema.js";

export const authorityTierSchema = z.enum(AUTHORITY_TIERS);

export const sourceTypeSchema = z.enum([
  "OFFICIAL_DOCUMENTATION",
  "GOVERNMENT",
  "STANDARDS_BODY",
  "REGULATOR",
  "ACADEMIC",
  "PEER_REVIEWED",
  "TECHNICAL_ORG",
  "SECONDARY",
  "COMMUNITY",
  "FORUM",
  "BLOG",
  "SOCIAL",
]);

export const knowledgeSourceSchema = z.object({
  id: uuidSchema,
  domain: z.string().min(1).max(255),
  organization: z.string().min(1).max(255),
  sourceType: sourceTypeSchema,
  authorityLevel: authorityTierSchema,
  jurisdiction: z.string().max(120).nullable(),
  allowed: z.boolean(),
  verificationMethod: z.string().min(1).max(200),
  updateFrequency: z.string().max(120).nullable(),
  lastChecked: isoDateTimeSchema.nullable(),
  trustPolicy: z.string().max(2000).nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const knowledgeClaimSchema = z.object({
  id: uuidSchema,
  statement: z.string().min(1).max(4000),
  sourceId: uuidSchema,
  documentId: uuidSchema.nullable(),
  quote: z.string().max(4000).nullable(),
  retrievedAt: isoDateTimeSchema,
  publishedAt: isoDateTimeSchema.nullable(),
  updatedAt: isoDateTimeSchema.nullable(),
  sourceVersion: z.string().max(120).nullable(),
  apiVersion: z.string().max(120).nullable(),
  expiresAt: isoDateTimeSchema.nullable(),
  confidence: confidenceSchema,
  epistemicState: epistemicStateSchema,
  freshnessScore: z.number().min(0).max(1).nullable(),
  conflictingClaimIds: z.array(uuidSchema).default([]),
});

export const researchCitationSchema = z.object({
  claim: z.string().min(1).max(4000),
  source: z.string().min(1).max(500),
  sourceType: sourceTypeSchema,
  authorityLevel: authorityTierSchema,
  retrievedAt: isoDateTimeSchema,
  excerpt: z.string().max(4000).nullable(),
  confidence: confidenceSchema,
  epistemicState: epistemicStateSchema,
});

export const researchResultSchema = z.object({
  question: z.string().min(1).max(4000),
  answer: z.string().min(1).max(50000),
  citations: z.array(researchCitationSchema),
  conflicts: z.array(
    z.object({
      claimA: z.string(),
      claimB: z.string(),
      resolution: z.string().nullable(),
      epistemicState: z.literal("CONFLICTED"),
    }),
  ),
  epistemicState: epistemicStateSchema,
});

export type KnowledgeSource = z.infer<typeof knowledgeSourceSchema>;
export type KnowledgeClaim = z.infer<typeof knowledgeClaimSchema>;
export type ResearchResult = z.infer<typeof researchResultSchema>;
export type SourceType = z.infer<typeof sourceTypeSchema>;

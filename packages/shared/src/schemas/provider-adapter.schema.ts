import { z } from "zod";
import { sourceAuthorityRankSchema } from "./authority.schema.js";
import { dataClassificationSchema } from "./evidence.schema.js";
import { epistemicStateSchema, isoDateTimeSchema } from "./common.schema.js";

/**
 * Provider Adapter → Normalized Evidence (ADR-014 §9).
 * GitHub is the first adapter; others must emit this shape.
 */
export const providerAdapterIds = [
  "github",
  "local",
  "vercel",
  "supabase",
  "mongodb",
  "ci",
  "sentry",
  "stripe",
] as const;

export const providerAdapterIdSchema = z.enum(providerAdapterIds);

export const normalizedEvidenceDraftSchema = z.object({
  provider: providerAdapterIdSchema,
  source: z.string().min(1).max(500),
  sourceType: z.string().min(1).max(80),
  sourceId: z.string().max(500).nullable(),
  uri: z.string().max(2000).nullable(),
  version: z.string().max(200).nullable(),
  excerpt: z.string().max(4000).nullable(),
  observedAt: isoDateTimeSchema,
  epistemicState: epistemicStateSchema,
  confidence: z.number().min(0).max(1),
  authorityRank: sourceAuthorityRankSchema,
  classification: dataClassificationSchema.default("INTERNAL"),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type ProviderAdapterId = z.infer<typeof providerAdapterIdSchema>;
export type NormalizedEvidenceDraft = z.infer<
  typeof normalizedEvidenceDraftSchema
>;

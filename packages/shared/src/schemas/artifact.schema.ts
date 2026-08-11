import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "./common.schema.js";
import { expertIdSchema } from "./expert.schema.js";

export const artifactKindSchema = z.enum([
  "IMAGE",
  "PDF",
  "DOCUMENT",
  "MARKDOWN",
  "OTHER",
]);

export const createArtifactSchema = z.object({
  projectId: uuidSchema.nullable().optional(),
  filename: z.string().min(1).max(260),
  mimeType: z.string().min(3).max(120),
  contentBase64: z.string().min(1).max(8_000_000),
  kind: artifactKindSchema.optional(),
  note: z.string().max(1000).optional(),
});

export const artifactSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema.nullable(),
  filename: z.string(),
  mimeType: z.string(),
  kind: artifactKindSchema,
  byteSize: z.number().int().nonnegative(),
  sha256: z.string().min(16).max(128),
  storagePath: z.string(),
  evidenceId: uuidSchema,
  note: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});

export const assistProviderSchema = z.enum([
  "local-checklist",
  "gpt-4o-vision",
]);

export const createAssistRunSchema = z.object({
  projectId: uuidSchema.nullable().optional(),
  artifactIds: z.array(uuidSchema).min(1).max(10),
  expertId: expertIdSchema,
  provider: assistProviderSchema.optional(),
  userRequest: z.string().min(3).max(4000),
});

export const assistFindingSchema = z.object({
  id: uuidSchema,
  title: z.string().min(1).max(200),
  detail: z.string().min(1).max(2000),
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
  epistemicState: z.enum(["FACT", "INFERRED", "PROPOSED", "UNKNOWN"]),
});

export const assistRunSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema.nullable(),
  artifactIds: z.array(uuidSchema),
  expertId: expertIdSchema,
  provider: assistProviderSchema,
  userRequest: z.string(),
  summary: z.string(),
  findings: z.array(assistFindingSchema),
  creditsCharged: z.number().int().min(0),
  epistemicState: z.enum(["INFERRED", "PROPOSED", "UNKNOWN"]),
  createdAt: isoDateTimeSchema,
});

export const creditsBalanceSchema = z.object({
  balance: z.number().int(),
  lifetimeGranted: z.number().int(),
  lifetimeSpent: z.number().int(),
  freeGrant: z.number().int(),
  updatedAt: isoDateTimeSchema,
});

export const purchaseCreditsSchema = z.object({
  pack: z.enum(["starter", "growth", "scale"]),
});

export const conflictListItemSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  projectName: z.string(),
  sliceKey: z.string(),
  resolution: z.string().nullable(),
  detectedAt: isoDateTimeSchema,
  epistemicState: z.literal("CONFLICTED"),
  resolved: z.boolean(),
});

export const resolveConflictSchema = z.object({
  resolution: z.string().min(3).max(2000),
  /** Prefer claim by Source Authority (ADR-014) when set to "authority". */
  method: z.enum(["manual", "authority"]).default("manual"),
  winnerClaimId: uuidSchema.optional(),
});

export type Artifact = z.infer<typeof artifactSchema>;
export type CreateArtifact = z.infer<typeof createArtifactSchema>;
export type AssistRun = z.infer<typeof assistRunSchema>;
export type CreateAssistRun = z.infer<typeof createAssistRunSchema>;
export type CreditsBalance = z.infer<typeof creditsBalanceSchema>;
export type ConflictListItem = z.infer<typeof conflictListItemSchema>;

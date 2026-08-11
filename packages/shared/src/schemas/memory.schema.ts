import { z } from "zod";
import { MEMORY_STATUSES, MEMORY_TYPES, OBSERVATION_MODES } from "../constants/memory.js";
import {
  confidenceSchema,
  epistemicStateSchema,
  isoDateTimeSchema,
  knowledgeCategorySchema,
  uuidSchema,
} from "./common.schema.js";

export const memoryTypeSchema = z.enum(MEMORY_TYPES);
export const memoryStatusSchema = z.enum(MEMORY_STATUSES);
export const observationModeSchema = z.enum(OBSERVATION_MODES);

export const memorySourceTypeSchema = z.enum([
  "USER",
  "AGENT",
  "GITHUB",
  "DOCUMENT",
  "CONVERSATION",
  "INTEGRATION",
  "WEB_RESEARCH",
  "SYSTEM",
]);

export const memoryEvidenceSchema = z.object({
  id: uuidSchema,
  kind: z.string().min(1).max(64),
  reference: z.string().min(1).max(500),
  excerpt: z.string().max(4000).optional(),
});

export const memorySchema = z.object({
  id: uuidSchema,
  type: memoryTypeSchema,
  projectId: uuidSchema.nullable(),
  statement: z.string().min(1).max(4000),
  reason: z.array(z.string().min(1).max(500)).default([]),
  status: memoryStatusSchema,
  confidence: confidenceSchema,
  category: knowledgeCategorySchema,
  epistemicState: epistemicStateSchema,
  observationMode: observationModeSchema,
  source: z.string().min(1).max(200),
  sourceType: memorySourceTypeSchema,
  sourceId: z.string().min(1).max(200).nullable(),
  evidence: z.array(memoryEvidenceSchema).default([]),
  supersededBy: uuidSchema.nullable(),
  validFrom: isoDateTimeSchema.nullable(),
  validUntil: isoDateTimeSchema.nullable(),
  observedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  createdBy: z.string().min(1).max(200),
  scope: z.enum(["GLOBAL", "PROJECT", "REPOSITORY"]).default("PROJECT"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
});

export const createMemorySchema = z.object({
  type: memoryTypeSchema,
  projectId: uuidSchema.nullable().optional(),
  statement: z.string().min(1).max(4000),
  reason: z.array(z.string().min(1).max(500)).optional(),
  confidence: confidenceSchema.optional(),
  category: knowledgeCategorySchema,
  epistemicState: epistemicStateSchema,
  observationMode: observationModeSchema,
  source: z.string().min(1).max(200),
  sourceType: memorySourceTypeSchema,
  sourceId: z.string().min(1).max(200).nullable().optional(),
  evidence: z.array(memoryEvidenceSchema.omit({ id: true })).optional(),
  validFrom: isoDateTimeSchema.nullable().optional(),
  validUntil: isoDateTimeSchema.nullable().optional(),
  observedAt: isoDateTimeSchema.nullable().optional(),
  scope: z.enum(["GLOBAL", "PROJECT", "REPOSITORY"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
});

export type Memory = z.infer<typeof memorySchema>;
export type CreateMemory = z.infer<typeof createMemorySchema>;
export type MemoryEvidence = z.infer<typeof memoryEvidenceSchema>;

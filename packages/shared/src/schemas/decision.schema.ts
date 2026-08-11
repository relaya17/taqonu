import { z } from "zod";
import {
  confidenceSchema,
  epistemicStateSchema,
  isoDateTimeSchema,
  uuidSchema,
} from "./common.schema.js";

export const decisionStatusSchema = z.enum([
  "ACTIVE",
  "SUPERSEDED",
  "PROPOSED",
  "REJECTED",
]);

export const decisionSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema.nullable(),
  decision: z.string().min(1).max(2000),
  reason: z.array(z.string().min(1).max(500)).default([]),
  alternatives: z.array(z.string().min(1).max(500)).default([]),
  tradeOffs: z.array(z.string().min(1).max(500)).default([]),
  evidence: z.array(z.string().min(1).max(500)).default([]),
  status: decisionStatusSchema,
  confidence: confidenceSchema,
  epistemicState: epistemicStateSchema,
  supersededBy: uuidSchema.nullable(),
  adrPath: z.string().max(500).nullable(),
  decidedAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const createDecisionSchema = z.object({
  projectId: uuidSchema.nullable().optional(),
  decision: z.string().min(1).max(2000),
  reason: z.array(z.string().min(1).max(500)).optional(),
  alternatives: z.array(z.string().min(1).max(500)).optional(),
  tradeOffs: z.array(z.string().min(1).max(500)).optional(),
  evidence: z.array(z.string().min(1).max(500)).optional(),
  status: decisionStatusSchema.optional(),
  confidence: confidenceSchema.optional(),
  epistemicState: epistemicStateSchema.optional(),
  adrPath: z.string().max(500).nullable().optional(),
  decidedAt: isoDateTimeSchema.optional(),
});

export type Decision = z.infer<typeof decisionSchema>;
export type CreateDecision = z.infer<typeof createDecisionSchema>;
